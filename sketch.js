// CAPTCHA interface variables
let srcImg;
let gridSize = 3; // Number of rows and columns
let selectedTiles = []; // Array to store selected tiles
let tileImages = []; // Array to store the loaded images
let displayedImages = []; // Array to store 9 images displayed in the grid
let imageNames = []; // Array to store the names of images for weights lookup
let categories = ["Calm/Neutral", "Confident/Positive", "Chaotic/Negative"]; // Categories
let scores = { "Calm/Neutral": 0, "Confident/Positive": 0, "Chaotic/Negative": 0 }; // Scoring system
let weights; // Object to store the weights from JSON file

// Application state variables
let appState = "SELECTION"; // Can be "SELECTION", "RATIONAL_TEST" or "GENERATION"
let captchaTitle = "다음 중 가장 이성적인 상태를 고르시오";
let headerColor = [100, 100, 100]; // Initial gray color for header
let interactionsLocked = false; // Flag to lock interactions

// Selection tracking
let selectionTime = 0; // Time when the last selection was made
let selectedCol = -1; // Store the column of the selected tile
let selectedRow = -1; // Store the row of the selected tile
let selectionCount = 0; // Count how many tiles are selected
let selectedImage = null; // The currently selected image

// Webcam variables
let video; // Webcam capture
let faceMesh; // Face mesh detector
let faces = []; // Detected faces
let showingWebcam = false; // Flag to track if webcam is currently shown

let userSelectionData = {}; // Object to store user selections
let rationalTestStartTime = 0;  // When the RATIONAL_TEST state began
let faceCaptured = false;       // Flag to ensure we only capture once
let jsonFilename = "";          // Store filename to use for both JSON and image
let capturedImage = null;       // The captured face image

// Configuration object for easily adjusting the interface
const config = {
  // Canvas and layout
  canvasWidth: 800,          // Base canvas width
  canvasHeight: 900,         // Base canvas height
  headerHeight: 160,         // Height of the header
  gridSize: 3,               // Number of rows and columns
  
  // Spacing and sizing (all relative to canvas size)
  tileSizeRatio: 0.25,       // Tile size as ratio of canvas width
  gridSpacing: 10,           // Space between tiles
  buttonWidth: 200,          // Width of buttons
  buttonHeight: 50,          // Height of buttons
  buttonMargin: 60,          // Margin from bottom for buttons
  
  // Text sizing
  headerTextSize: 36,        // Size of header text
  countdownTextSize: 24,     // Size for countdown text
  buttonTextSize: 20,        // Size for button text
  processingTextSize: 30,    // Size for processing message
  
  // Colors
  selectionHeaderColor: [100, 100, 100],    // Gray for selection mode
  rationalTestHeaderColor: [255, 0, 0],     // Red for rational test mode
  selectionOverlayColor: [100, 0, 0, 100],  // Overlay for selected tiles
  gridLineColor: [255, 255, 255],           // Color of grid lines
  gridLineWeight: 3                         // Thickness of grid lines
};

// Add to your config object
config.receipt = {
  backgroundColor: 255,          // White background
  textColor: 0,                  // Black text
  headerSize: 32,                // Header text size
  subheaderSize: 20,             // Subheader text size
  bodyTextSize: 16,              // Body text size
  capturedImageWidth: 300,       // Width of captured image
  capturedImageHeight: 300,      // Height of captured image
  lineSpacing: 25,               // Vertical spacing between lines
  sideMargin: 60,                // Left margin
  tableWidth: 340,               // Width of table elements
  footerSize: 14                 // Footer text size
};

config.responsive = {
  minWidth: 320,                // Minimum supported width
  maxWidth: 1920,               // Maximum width to consider
  minHeight: 480,               // Minimum supported height
  maxHeight: 1080,              // Maximum height to consider
  scaleFactor: 0.9,             // Scale canvas to 90% of available space
  mobileBreakpoint: 768         // Width below which to use mobile layout
};

config.buttons = {
  primary: {
    backgroundColor: '#0066cc',
    textColor: 'white',
    borderRadius: '5px',
    fontWeight: 'bold',
    border: 'none'
  },
  secondary: {
    backgroundColor: '#666666',
    textColor: 'white',
    borderRadius: '5px',
    fontWeight: 'normal',
    border: 'none'
  }
};

// Compute derived values
let tileSize;          // Will be calculated in setup()
let gridOffsetX;       // X position to center the grid
let gridOffsetY;       // Y position to place the grid below header

function preload() {
  // Load CAPTCHA weights and images
  weights = loadJSON('weights.json');

  // Load FaceMesh model
  faceMesh = ml5.faceMesh({ maxFaces: 1, flipped: true });

  // Dynamically load all images with two-digit padding in the folder
  for (let i = 1; i <= 15; i++) {
    // Adjust this number based on the total images in your folder
    let paddedIndex = String(i).padStart(2, "0"); // Ensure two-digit padding
    let imgPath = `images/img${paddedIndex}.png`;
    let imageName = `img${paddedIndex}.png`;
    imageNames.push(imageName);
    tileImages.push(loadImage(imgPath));
  }
}

function gotFaces(results) {
  faces = results;
}

// Initialize webcam with specific device ID
function setupWebcam(deviceId = null) {
  // If a specific deviceId is provided, use that camera
  const constraints = {
    // video: deviceId ? { deviceId: { exact: deviceId } } : true,
    // flipped: true
    video: {
      facingMode: "user", // Use front camera for face detection
      width: { ideal: 640 },
      height: { ideal: 480 }
    },
    audio: false // Explicitly disable audio/microphone
  };
  
  // Initialize webcam with constraints
  video = createCapture(constraints);
  
  video.size(tileSize, tileSize);
  video.hide(); // Hide the default video element

  // Start detecting faces
  // faceMesh.detectStart(video, gotFaces);
  
  // Start detecting faces after webcam is loaded
  video.elt.onloadedmetadata = function() {
    faceMesh.detectStart(video, gotFaces);
  };
}

function setup() {
  createCanvas(config.canvasWidth, config.canvasHeight);
  centerCanvas();

  // Set initial tile size and grid positioning
  updateLayoutDimensions();

  pixelDensity(1);  
  
  srcImg = createGraphics(config.canvasWidth, config.canvasHeight);

  // Initialize webcam
  // video = createCapture(VIDEO, { flipped: true });
  // video.size(tileSize, tileSize);
  // video.hide(); // Hide the default video element

  setupWebcam();

  // Start detecting faces
  faceMesh.detectStart(video, gotFaces);

  // Initialize image selection as before
  initializeImages();

  // Handle mobile orientation changes
  window.addEventListener('resize', function() {
    // Only recreate canvas if significant change in dimensions
    if (Math.abs(windowWidth - width) > 100 || Math.abs(windowHeight - height) > 100) {
      console.log("Significant window resize detected");
      
      // Get scale based on window size
      const scale = calculateResponsiveScale();
      
      // Calculate new canvas dimensions
      const newWidth = round(config.canvasWidth * scale);
      const newHeight = round(config.canvasHeight * scale);
      
      // Resize and recenter the canvas
      resizeCanvas(newWidth, newHeight);
      centerCanvas();
      
      // Update all the layout dimensions
      updateLayoutDimensions();

      centerResetButton(); 
    }
  });

  // window.addEventListener('resize', function() {
  //   centerCanvas();
  //   updateLayoutDimensions();
  //   centerResetButton(); // Make sure this is here
  // });

  // Prevent default touch behavior on the canvas
  document.querySelector('canvas').addEventListener('touchstart', function(e) {
    e.preventDefault();
  }, { passive: false });

  // Add window resize handler to keep canvas centered
  window.addEventListener('resize', function() {
    centerCanvas();
    updateLayoutDimensions();
  });
}

function centerCanvas() {
  // Get current canvas element
  let canvas = document.querySelector('canvas');
  canvas.addEventListener('touchstart', function(e) {
    e.preventDefault();
  }, { passive: false });
  
  // Set CSS to center it
  canvas.style.position = 'absolute';
  canvas.style.left = '50%';
  canvas.style.top = '50%';
  canvas.style.transform = 'translate(-50%, -50%)';
  
  // Add a container div if needed
  if (!document.getElementById('canvasContainer')) {
    let container = document.createElement('div');
    container.id = 'canvasContainer';
    container.style.position = 'relative';
    container.style.width = '100vw';
    container.style.height = '100vh';
    
    // Move canvas into container
    document.body.appendChild(container);
    container.appendChild(canvas);
  }
}

function updateLayoutDimensions() {
  tileSize = min(width, height) * config.tileSizeRatio;
  let gridWidth = config.gridSize * tileSize + (config.gridSize - 1) * config.gridSpacing;
  let gridHeight = config.gridSize * tileSize + (config.gridSize - 1) * config.gridSpacing;
  gridOffsetX = (config.canvasWidth - gridWidth) / 2;
  gridOffsetY = config.headerHeight + (config.canvasHeight - config.headerHeight - gridHeight) / 2;

  // Update video size if it exists
  if (video) {
    video.size(tileSize, tileSize);
  }
}

function calculateResponsiveScale() {
  // Get window dimensions
  const windowWidth = windowWidth;
  const windowHeight = windowHeight;
  
  // Calculate scale factors for width and height
  const widthScale = windowWidth / config.canvasWidth;
  const heightScale = windowHeight / config.canvasHeight;
  
  // Use the smaller scale to ensure everything fits
  let scale = min(widthScale, heightScale) * config.responsive.scaleFactor;
  
  // Constrain scale to reasonable bounds
  scale = constrain(scale, 0.5, 1.5);
  
  return scale;
}

function touchEnableButton(button) {
  // Add multiple event listeners to ensure the button works
  ["touchend", "touchstart", "click"].forEach(function(eventType) {
    button.elt.addEventListener(eventType, function(e) {
      e.preventDefault();
      e.stopPropagation();
      console.log(`${eventType} detected on New session button`);
      // Call handleReset directly instead of relying on click propagation
      if (eventType === "touchend" || eventType === "click" || eventType === "touchstart") {
        handleReset();
      }
    });
  });
  console.log("Enhanced touch support added to button");
}

function initializeImages() {
  // Randomly select 9 images from the loaded images and track their names
  let shuffledIndices = shuffle([...Array(tileImages.length).keys()]);
  displayedImages = shuffledIndices.slice(0, config.gridSize * config.gridSize).map(i => tileImages[i]);
  
  // Keep track of the selected image names
  let displayedImageNames = shuffledIndices.slice(0, gridSize * gridSize).map(i => imageNames[i]);
  
  // Store the mapping between grid positions and image names
  imageNameGrid = [];
  for (let i = 0; i < config.gridSize * config.gridSize; i++) {
    imageNameGrid.push(displayedImageNames[i]);
  }
  
  // Initialize selectedTiles array
  for (let i = 0; i < gridSize; i++) {
    selectedTiles[i] = [];
    for (let j = 0; j < gridSize; j++) {
      selectedTiles[i][j] = false;
    }
  }
}

function draw() {
  background(0);

  // Only show CAPTCHA if we're not in GENERATION state
  if (appState !== "GENERATION") {
    // Draw header
    fill(headerColor[0], headerColor[1], headerColor[2]);
    rect(0, 0, config.canvasWidth, config.headerHeight);

    // Draw captcha instructions
    fill(255);
    textSize(config.headerTextSize);
    textAlign(CENTER, TOP);
    text(captchaTitle, config.canvasWidth / 2, 40);

    // Handle state transitions
    checkStateTransitions();

    // Draw grid based on current state
    drawGrid();
    
    // Draw skip button (only in selection state)
    if (appState === "SELECTION" && !interactionsLocked) {
      drawSkipButton();
    }

    // Display countdown timer if only one tile is selected
    drawCountdownTimer();
  } else {
    // In GENERATION state
    drawGenerationState();

    // If we've been in GENERATION state for more than 30 seconds
    if (window.generationStateStartTime && millis() - window.generationStateStartTime > 60000) {
      console.log("Failsafe reset triggered after 30 seconds");
      handleReset();
    }
  }
}

function drawGrid() {
  for (let i = 0; i < config.gridSize; i++) {
    for (let j = 0; j < config.gridSize; j++) {
      let x = gridOffsetX + i * (tileSize + config.gridSpacing);
      let y = gridOffsetY + j * (tileSize + config.gridSpacing);
      
      if (appState === "RATIONAL_TEST" && selectedTiles[i][j]) {
        // Draw webcam footage in selected tile
        drawWebcamTile(x, y);
      } else if (appState === "RATIONAL_TEST") {
        // Draw selected image in all non-selected tiles
        image(selectedImage, x, y, tileSize, tileSize);
      } else {
        // Normal display when no selection
        let imgIndex = i + j * config.gridSize;
        image(displayedImages[imgIndex], x, y, tileSize, tileSize);
      }

      // Draw selection overlay
      if (selectedTiles[i][j]) {
        if (appState === "RATIONAL_TEST") {
            let alpha = 100 + 50 * sin(millis() / 500); // Calculate alpha using sine wave
            fill(255, 0, 0, alpha); // Red for rational test state with blinking effect
        } else {
          fill(config.selectionOverlayColor); // Darker red for selection state
        }
        rect(x, y, tileSize, tileSize);
      }

       // Draw grid lines
       stroke(config.gridLineColor);
       strokeWeight(config.gridLineWeight);
       noFill();
       rect(x, y, tileSize, tileSize);
    }
  }
}

function drawWebcamTile(x, y) {
  // Apply the black and white effect
  applyBlackAndWhiteEffect(video);
  
  // Draw mirrored webcam
  let zoomedTileSize = tileSize / 2;
  push();
  translate(x + tileSize, y);
  scale(-1, 1);
  image(video, 0, 0, tileSize, tileSize, 
        video.width / 2 - zoomedTileSize / 2, 
        video.height / 2 - zoomedTileSize / 2, 
        zoomedTileSize, zoomedTileSize);
  pop();
}

function applyBlackAndWhiteEffect(img) {
  img.loadPixels();
  for (let k = 0; k < img.pixels.length; k += 4) {
    let r = img.pixels[k];
    let g = img.pixels[k + 1];
    let b = img.pixels[k + 2];
    let gray = (r + g + b) / 3;
    
    // Posterize effect - reduce to 3-4 levels
    // gray = Math.floor(gray / 64) * 64;
    
    img.pixels[k] = gray;
    img.pixels[k + 1] = gray;
    img.pixels[k + 2] = gray;
  }
  img.updatePixels();
}

function drawSkipButton() {
  fill(10, 10, 10, 150); // Semi-transparent black for button
  rect(config.canvasWidth - config.buttonWidth - 20, 
    config.canvasHeight - config.buttonHeight - 20, 
    config.buttonWidth, config.buttonHeight, 10);
  fill(255);
  textAlign(config.buttonTextSize);
  text("건너뛰기", config.canvasWidth - config.buttonWidth / 2 - 20, 
    config.canvasHeight - config.buttonHeight / 2 - 35);
}

function drawCountdownTimer() {
  // Display countdown timer if only one tile is selected
  if (selectionCount === 1 && selectionTime > 0 && !showingWebcam) {
    let timeLeft = 5 - floor((millis() - selectionTime) / 1000);
    if (timeLeft >= 0) {
      fill(0);
      textAlign(CENTER, CENTER);
      textSize(config.countdownTextSize);
      text(`${timeLeft}초 후에 넘어갑니다`, config.canvasWidth / 2, config.canvasHeight - 780);  
    }
  }
}

function drawGenerationState() {
  // Set up the receipt background
  background(255); // White background for receipt
  
  // Add receipt header with decorative elements
  fill(0);
  textSize(32);
  textAlign(CENTER, TOP);
  text("검사 결과", config.canvasWidth/2, 40);
  
  // Add decorative line
  stroke(0);
  strokeWeight(2);
  line(50, 85, config.canvasWidth - 50, 85);
  
  // Show date and time
  textSize(20);
  textAlign(LEFT, TOP);
  noStroke();
  let currentDate = new Date();
  text(`날짜: ${currentDate.toLocaleDateString()}`, 60, 110);
  text(`시간: ${currentDate.toLocaleTimeString()}`, 60, 140);
  
  // Show subject ID aligned to the right
  textSize(40);
  textAlign(RIGHT, TOP);
  noStroke();
  text(`사용자 ID: ${jsonFilename.replace('subject_', '')}`, config.canvasWidth - 60, 115);
  
  // Add another decorative line
  stroke(0);
  strokeWeight(1);
  line(50, 190, config.canvasWidth - 50, 190);
  
  // // Image comparison section - show both images side by side
  // noStroke();
  // fill(0);
  // textSize(18);
  // textAlign(LEFT, TOP);
  // text("Image Comparison:", 60, 210);
  
  // Image sizing and positioning
  let imgWidth = 240;
  let imgHeight = 240;
  let leftImgX = 140;
  let rightImgX = config.canvasWidth - leftImgX - imgWidth;
  let imgY = 245;
  
  textSize(20);
  textAlign(LEFT, TOP);
  noStroke();

  // Display the selected image on the left
  if (selectedImage) {
    text("선택한 이미지:", leftImgX, 225);
    image(selectedImage, leftImgX, imgY, imgWidth, imgHeight);
  }
  
  // Display the captured image on the right
  if (capturedImage) {
    text("사용자 정보:", rightImgX, 225);
    image(capturedImage, rightImgX, imgY, imgWidth, imgHeight);
  }
  
  // Add arrow between images to indicate comparison
  // stroke(0);
  // strokeWeight(2);
  // let arrowX1 = leftImgX + imgWidth + 20;
  // let arrowX2 = rightImgX - 20;
  // let arrowY = imgY + imgHeight/2;
  // line(arrowX1, arrowY, arrowX2, arrowY); // Horizontal line
  // line(arrowX2 - 15, arrowY - 15, arrowX2, arrowY); // Arrow head top
  // line(arrowX2 - 15, arrowY + 15, arrowX2, arrowY); // Arrow head bottom
  
  // Show selection data
  // fill(0);
  // noStroke();
  // textSize(18);
  // textAlign(LEFT, TOP);
  // text("Selection Data:", 60, imgY + imgHeight + 30);
  
  // // Show selected image name
  // textSize(16);
  // text(`Selected Image: ${userSelectionData.selectedImage || "None"}`, 60, imgY + imgHeight + 60);
  
  // Show category weights in a table format
  // text("카테고리별 수치:", config.canvasWidth / 2, imgY + imgHeight + 90);
  
  // Draw table of weights
  let tableWidth = 450; // Increase table width by 1.5 times
  let tableX = (config.canvasWidth - tableWidth) / 2; // Center table horizontally
  let yOffset = imgY + imgHeight + 90; // Pull everything up by 30 on the y-axis
  
  // Table headers
  textSize(20); // Increase text size to 20
  textStyle(BOLD);
  textAlign(LEFT, TOP);
  text("카테고리", tableX, yOffset);
  text("수치", tableX + tableWidth - 150, yOffset); // Adjust for increased table width
  yOffset += 37.5; // Increase spacing by 1.5 times
  
  // Table divider
  stroke(0);
  line(tableX, yOffset - 7.5, tableX + tableWidth, yOffset - 7.5); // Adjust for increased spacing
  
  // Table rows
  noStroke();
  textStyle(NORMAL);
  for (let category in scores) {
    text(category, tableX, yOffset);
    text(scores[category].toFixed(2), tableX + tableWidth - 150, yOffset); // Adjust for increased table width
    yOffset += 37.5; // Increase spacing by 1.5 times
  }
  
  // Bottom table line
  stroke(0);
  let tableLineX1 = (config.canvasWidth - tableWidth) / 2; // Center align the line
  let tableLineX2 = tableLineX1 + tableWidth;
  line(tableLineX1, yOffset - 7.5, tableLineX2, yOffset - 7.5); // Adjust for increased spacing
  
  // Receipt footer with dotted line
  stroke(0);
  strokeWeight(1);
  drawingContext.setLineDash([5, 5]); // Create dotted line
  line(50, config.canvasHeight - 120, config.canvasWidth - 50, config.canvasHeight - 120);
  drawingContext.setLineDash([]); // Reset to solid line
  
  // Footer text
  noStroke();
  textAlign(CENTER, TOP);
  textSize(14);
  text("CAPTCHA 테스트를 진행하시느라 수고 많으셨습니다", config.canvasWidth/2, config.canvasHeight - 100);
  text("이 문서는 이성 진단에 대한 증명서로써 작용합니다", config.canvasWidth/2, config.canvasHeight - 80);
  
  // Add a reset button to restart CAPTCHA
  if (!window.resetButton) {
    window.resetButton = createButton("처음으로");
  
    // Center the button relative to the canvas width
    window.resetButton.position(
      width/2 - config.buttonWidth/2 + 100,  // Center horizontally on canvas
      height - config.buttonMargin + 250     // Position from bottom of canvas
    );
  
  window.resetButton.size(config.buttonWidth, config.buttonHeight);
  window.resetButton.style('font-size', config.buttonTextSize + 'px');
  window.resetButton.style('background-color', config.buttons.primary.backgroundColor);
  window.resetButton.style('color', config.buttons.primary.textColor);
  window.resetButton.style('border', config.buttons.primary.border);
  window.resetButton.style('border-radius', config.buttons.primary.borderRadius);
  window.resetButton.style('font-weight', config.buttons.primary.fontWeight);
  window.resetButton.mousePressed(handleReset);

  // Enable touch support for this button
  touchEnableButton(window.resetButton);
  
  // Add resize handler to keep button centered when window resizes
  window.addEventListener('resize', centerResetButton);
  }
}

function handleReset() {
  console.log("handleReset function called");
  resetCaptcha();
  capturedImage = null;
  
  // Hide generation UI elements
  // document.getElementById("captureButton").style.display = "block";
  
  if (window.resetButton) {
    console.log("Removing reset button");
    window.resetButton.remove();
    window.resetButton = null;
  }
}

function centerResetButton() {
  // if (window.resetButton && appState === "GENERATION") {
  //   window.resetButton.position(
  //     width/2 - config.buttonWidth/2,  // Center horizontally on canvas
  //     height - config.buttonMargin     // Position from bottom of canvas
  //   );
  // }
  if (window.resetButton && appState === "GENERATION") {
    console.log("Centering reset button to:", width/2 - config.buttonWidth/2 + 100, height - config.buttonMargin + 250);
    window.resetButton.position(
      width/2 - config.buttonWidth/2 + 100,
      height - config.buttonMargin + 250
    );
  }
}

function checkStateTransitions() {
  // Check if we need to transition states
  if (appState === "SELECTION" && selectionCount === 1 && selectionTime > 0 && millis() - selectionTime > 5000) {
    transitionToRationalTest();
  }

  // Check if we should capture the webcam image (3 seconds after RATIONAL_TEST begins)
  if (appState === "RATIONAL_TEST" && !faceCaptured && 
      rationalTestStartTime > 0 && millis() - rationalTestStartTime > 3000) {
    captureUserFace();
    faceCaptured = true;
    
    // Show the generate button after capturing
    // document.getElementById("captureButton").style.display = "block";
  }

  // Get the selected image (if any)
  if (selectionCount === 1 && selectedCol >= 0 && selectedRow >= 0) {
    let selectedImgIndex = selectedCol + selectedRow * config.gridSize;
    selectedImage = displayedImages[selectedImgIndex];
  }
}

function transitionToRationalTest() {
  appState = "RATIONAL_TEST";
  showingWebcam = true;
  captchaTitle = "당신은 이성적입니까?";
  headerColor = [255, 0, 0]; // Change to red
  interactionsLocked = true;
  rationalTestStartTime = millis(); // Record the start time
  faceCaptured = false; // Reset face capture flag
  console.log("Transitioning to rational test");

  // Create a unique filename base to use for both JSON and image
  jsonFilename = 'subject_' + Math.floor(100000 + Math.random() * 900000);
  
  // Save the JSON data immediately
  saveUserSelectionData();
}

function captureUserFace() {
  // Create a copy of the current webcam frame
  capturedImage = video.get();
  capturedImage.loadPixels();
  
  // Apply black & white posterization to the captured image
  for (let k = 0; k < capturedImage.pixels.length; k += 4) {
    let r = capturedImage.pixels[k];
    let g = capturedImage.pixels[k + 1];
    let b = capturedImage.pixels[k + 2];
    let gray = (r + g + b) / 3;
    
    // Posterize effect - reduce to 3-4 levels
    // gray = Math.floor(gray / 64) * 64;
    
    capturedImage.pixels[k] = gray;
    capturedImage.pixels[k + 1] = gray;
    capturedImage.pixels[k + 2] = gray;
  }
  capturedImage.updatePixels();

  // Save the captured image for later use in generation
  // capturedImage.save(jsonFilename + '_captured.png'); // Save the captured face image
  // console.log("user face data saving disabled");
  
  // We don't save the raw capture directly, we'll save the generated image later
  // console.log("User face captured and ready for generation");

  // Transition to GENERATION state to display the captured image
  appState = "GENERATION";
  window.generationStateStartTime = millis();

  // Save results
  // saveGeneratedResults();
  // console.log("user data saving disabled");

  // console.log("User face captured and saved");

  // Generate receipt data
  prepareReceiptData();
  
  console.log("User face captured and receipt generated");
}

function prepareReceiptData() {
  // Add receipt-specific data to userSelectionData
  userSelectionData.receiptGenerated = Date.now();
  // userSelectionData.receiptId = "RC-" + Math.floor(Math.random() * 100000);
  
  // Format category data for receipt
  let categoryData = [];
  for (let category in scores) {
    categoryData.push({
      name: category,
      score: scores[category].toFixed(2)
    });
  }
  userSelectionData.categoryData = categoryData;
  
  // Calculate dominant category
  let maxScore = -1;
  let dominantCategory = "None";
  for (let category in scores) {
    if (scores[category] > maxScore) {
      maxScore = scores[category];
      dominantCategory = category;
    }
  }
  userSelectionData.dominantCategory = dominantCategory;
  
  // Save the JSON data with receipt information
  // saveJSON(userSelectionData, jsonFilename + '.json');
}

function saveUserSelectionData() {
  // Create an object to store the data
  userSelectionData = {
    timestamp: Date.now(),
    selectedImage: "",
    weights: {},
    scores: {}
  };
  
  // Get the image name for the selected tile
  if (selectedRow >= 0 && selectedCol >= 0) {
    let imgIndex = selectedCol + selectedRow * gridSize;
    let imageName = imageNameGrid[imgIndex];
    userSelectionData.selectedImage = imageName;
    
    // Store the weights of the selected image
    if (weights[imageName]) {
      userSelectionData.weights = weights[imageName];
    }
  }
  
  // Store current scores
  userSelectionData.scores = JSON.parse(JSON.stringify(scores));
}

function mousePressed() {
  // Call shared handler with mouse coordinates
  handleInteraction(mouseX, mouseY);
}

function touchStarted() {
  // Check if there are any touches
  if (touches.length > 0) {
    // Use the first touch point's coordinates
    handleInteraction(touches[0].x, touches[0].y);
  }
  // Prevent default behavior (scrolling, zooming)
  return false;
}

function handleInteraction(x, y) {
  // If interactions are locked, ignore all input
  if (interactionsLocked) {
    return;
  }
  
  // Check if skip button was clicked
  if (
    x > config.canvasWidth - config.buttonWidth - 20 && 
    x < config.canvasWidth - 20 &&
    y > config.canvasHeight - config.buttonHeight - 20 && 
    y < config.canvasHeight - 20
  ) {
    console.log("Reset clicked");
    resetCaptcha();
    return;
  }

  // Calculate which tile was clicked by converting position to grid coordinates
  for (let i = 0; i < config.gridSize; i++) {
    for (let j = 0; j < config.gridSize; j++) {
      let tileX = gridOffsetX + i * (tileSize + config.gridSpacing);
      let tileY = gridOffsetY + j * (tileSize + config.gridSpacing);
      
      if (x > tileX && x < tileX + tileSize && 
          y > tileY && y < tileY + tileSize) {
        // Toggle selection state
        selectedTiles[i][j] = !selectedTiles[i][j];
        
        // Update counts and tracking variables
        updateSelectionCount();
        
        // Reset webcam transition if multiple tiles are selected
        if (selectionCount !== 1) {
          selectionTime = 0;
          showingWebcam = false;
        } else {
          // Start timer for webcam transition if exactly one tile is selected
          selectionTime = millis();
          selectedCol = i;
          selectedRow = j;
        }
        
        // Update scores based on selection logic
        updateScores(i, j);
        return;
      }
    }
  }
}

function updateSelectionCount() {
  selectionCount = 0;
  selectedCol = -1;
  selectedRow = -1;
  
  for (let i = 0; i < gridSize; i++) {
    for (let j = 0; j < gridSize; j++) {
      if (selectedTiles[i][j]) {
        selectionCount++;
        selectedCol = i;
        selectedRow = j;
      }
    }
  }
}

function updateScores(col, row) {
  // Get the image name for the selected tile
  let imgIndex = col + row * gridSize;
  let imageName = imageNameGrid[imgIndex];
  
  if (selectedTiles[col][row]) {
    // Add weights from the selected image
    if (weights[imageName]) {
      for (let category in weights[imageName]) {
        scores[category] += weights[imageName][category];
      }
    }
  } else {
    // Subtract weights if deselected
    if (weights[imageName]) {
      for (let category in weights[imageName]) {
        scores[category] = Math.max(0, scores[category] - weights[imageName][category]);
      }
    }
  }
}

function saveGeneratedResults() {
  // Update JSON data with the filename
  userSelectionData.generatedImage = jsonFilename + '.png';
  
  // Save the JSON data
  saveJSON(userSelectionData, jsonFilename + '.json');
  
  // Save the generated image
  // resImg.save(jsonFilename + '.png');
  
  console.log("Save complete - saved image and data:", jsonFilename);
}

function resetCaptcha() {
  console.log("resetCaptcha function called");

  // Reset to initial state
  appState = "SELECTION";
  
  // Reset selections
  for (let i = 0; i < gridSize; i++) {
    for (let j = 0; j < gridSize; j++) {
      selectedTiles[i][j] = false;
    }
  }

  // Reset scores
  for (let category in scores) {
    scores[category] = 0;
  }
  
  // Reset all tracking variables
  selectionTime = 0;
  showingWebcam = false;
  rationalTestStartTime = 0;
  faceCaptured = false;
  selectionCount = 0;
  selectedCol = -1;
  selectedRow = -1;
  selectedImage = null;

  // Reset UI elements
  captchaTitle = "다음 중 가장 이성적인 상태를 고르시오";
  headerColor = [100, 100, 100]; // Reset to grey
  interactionsLocked = false;

  // Reshuffle images for new CAPTCHA
  let shuffledIndices = shuffle([...Array(tileImages.length).keys()]);
  displayedImages = shuffledIndices.slice(0, gridSize * gridSize).map(i => tileImages[i]);
  
  let displayedImageNames = shuffledIndices.slice(0, gridSize * gridSize).map(i => imageNames[i]);
  imageNameGrid = [];
  for (let i = 0; i < gridSize * gridSize; i++) {
    imageNameGrid.push(displayedImageNames[i]);
  }
}