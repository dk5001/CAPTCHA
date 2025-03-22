// ComfyUI integration variables
let workflow;
let comfy;
let bg;
let ipAdapter;
let srcImg;
let resImg;
let ipSlider;

// CAPTCHA interface variables
let gridSize = 3; // Number of rows and columns
// let tileSize; // Size of each tile
let selectedTiles = []; // Array to store selected tiles
let tileImages = []; // Array to store the loaded images
let displayedImages = []; // Array to store 9 images displayed in the grid
let imageNames = []; // Array to store the names of images for weights lookup
let categories = ["Calm/Neutral", "Confident/Positive", "Chaotic/Negative"]; // Categories
let scores = { "Calm/Neutral": 0, "Confident/Positive": 0, "Chaotic/Negative": 0 }; // Scoring system
let weights; // Object to store the weights from JSON file

// Application state variables
let appState = "SELECTION"; // Can be "SELECTION", "RATIONAL_TEST" or "GENERATION"
let captchaTitle = "Choose the most rational state";
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

// Compute derived values
let tileSize;          // Will be calculated in setup()
let gridOffsetX;       // X position to center the grid
let gridOffsetY;       // Y position to place the grid below header

function preload() {
  // Load ComfyUI workflow
  workflow = loadJSON("character-sheet-ipadapter.json");
  
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

function setup() {
  createCanvas(config.canvasWidth, config.canvasHeight);
  tileSize = config.canvasWidth * config.tileSizeRatio;
  let gridWidth = config.gridSize * tileSize + (config.gridSize - 1) * config.gridSpacing;
  let gridHeight = config.gridSize * tileSize + (config.gridSize - 1) * config.gridSpacing;
  gridOffsetX = (config.canvasWidth - gridWidth) / 2;
  gridOffsetY = config.headerHeight + (config.canvasHeight - config.headerHeight - gridHeight) / 2;
  pixelDensity(1);    // ?
  
  srcImg = createGraphics(config.canvasWidth, config.canvasHeight);

  comfy = new ComfyUiP5Helper("http://127.0.0.1:8188/");  // for ComfyUI Web
  console.log("workflow is", workflow);

  // Initialize webcam
  video = createCapture(VIDEO, { flipped: true });
  video.size(tileSize, tileSize);
  video.hide(); // Hide the default video element

  // Start detecting faces
  faceMesh.detectStart(video, gotFaces);

  // Create generation button (initially hidden)
  let generateButton = createButton("Generate Image");
  generateButton.position(config.canvasWidth / 2 - config.buttonWidth / 2, 
                         config.canvasHeight - config.buttonMargin);
  generateButton.size(config.buttonWidth, config.buttonHeight);
  generateButton.style('font-size', config.buttonTextSize + 'px');
  generateButton.mousePressed(requestImage);
  generateButton.id("generateButton");
  generateButton.style("display", "none");

  // Create slider for IPAdapter strength (initially hidden)
  slider = createSlider(1, 3, 2, 1);
  slider.position(config.canvasWidth / 2 - config.buttonWidth / 2, config.canvasHeight - config.buttonMargin - config.buttonHeight - 20);
  slider.style('width', config.buttonWidth + 'px');
  slider.input(updateIpAdapter);
  slider.id("ipSlider");
  slider.style("display", "none");

  // Initialize image selection as before
  initializeImages();
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
  background(220);

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
  text("SHUFFLE", config.canvasWidth - config.buttonWidth / 2 - 20, 
    config.canvasHeight - config.buttonHeight / 2 - 35);
}

function drawCountdownTimer() {
  // Display countdown timer if only one tile is selected
  if (selectionCount === 1 && selectionTime > 0 && !showingWebcam) {
    let timeLeft = 3 - floor((millis() - selectionTime) / 1000);
    if (timeLeft >= 0) {
      fill(0);
      textAlign(CENTER, TOP);
      textSize(config.countdownTextSize);
      text(`Scanning in ${timeLeft}...`, config.canvasWidth / 2, config.canvasHeight - 450);
    }
  }
}

function drawGenerationState() {
  // In GENERATION state show the captured image and then the result
  if (capturedImage) {
    image(capturedImage, 0, 0, config.canvasWidth, config.canvasHeight);
  }
  
  // Show generation progress or result
  if (resImg) {
    image(resImg, 0, 0, config.canvasWidth, config.canvasHeight);
    
    // Add a reset button to restart CAPTCHA
    if (!window.resetButton) {
      window.resetButton = createButton("New session");
      window.resetButton.position(config.canvasWidth / 2 - config.buttonWidth / 2, config.canvasHeight - config.buttonMargin);
      window.resetButton.size(config.buttonWidth, config.buttonHeight);
      window.resetButton.style('font-size', config.buttonTextSize + 'px');
      window.resetButton.mousePressed(handleReset);
    }
  } else {
    // Show processing message
    fill(255);
    stroke(0);
    textSize(config.processingTextSize);
    textAlign(CENTER, CENTER);
    text("Processing your image...", config.canvasWidth / 2, config.canvasHeight / 2);
  }
}

function handleReset() {
  resetCaptcha();
  capturedImage = null;
  resImg = null;
  
  // Hide generation UI elements
  document.getElementById("generateButton").style.display = "none";
  document.getElementById("ipSlider").style.display = "none";
  
  if (window.resetButton) {
    window.resetButton.remove();
    window.resetButton = null;
  }
}

function checkStateTransitions() {
  // Check if we need to transition states
  if (appState === "SELECTION" && selectionCount === 1 && selectionTime > 0 && millis() - selectionTime > 3000) {
    transitionToRationalTest();
  }

  // Check if we should capture the webcam image (3 seconds after RATIONAL_TEST begins)
  if (appState === "RATIONAL_TEST" && !faceCaptured && 
      rationalTestStartTime > 0 && millis() - rationalTestStartTime > 3000) {
    captureUserFace();
    faceCaptured = true;
    
    // Show the generate button after capturing
    document.getElementById("generateButton").style.display = "block";
    document.getElementById("ipSlider").style.display = "block";
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
  captchaTitle = "ARE YOU RATIONAL?";
  headerColor = [255, 0, 0]; // Change to red
  interactionsLocked = true;
  rationalTestStartTime = millis(); // Record the start time
  faceCaptured = false; // Reset face capture flag
  console.log("Transitioning to rational test");

  // Create a unique filename base to use for both JSON and image
  jsonFilename = 'user_selection_' + Date.now();
  
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
  
  // Also set the bg for ComfyUI
  bg = capturedImage;

  // Save the captured image for later use in generation
  capturedImage.save(jsonFilename + '_captured.png'); // Save the captured face image
  
  // We don't save the raw capture directly, we'll save the generated image later
  console.log("User face captured and ready for generation");
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
  // If interactions are locked, ignore all mouse presses
  if (interactionsLocked) {
    return;
  }
  
  // Check if skip button was clicked
  if (
    mouseX > config.canvasWidth - config.buttonWidth - 20 && 
      mouseX < config.canvasWidth - 20 &&
      mouseY > config.canvasHeight - config.buttonHeight - 20 && 
      mouseY < config.canvasHeight - 20
  ) {
    console.log("Skip clicked");
    resetCaptcha();
    return;
  }

  // Calculate which tile was clicked by converting mouse position to grid coordinates
  for (let i = 0; i < config.gridSize; i++) {
    for (let j = 0; j < config.gridSize; j++) {
      let x = gridOffsetX + i * (tileSize + config.gridSpacing);
      let y = gridOffsetY + j * (tileSize + config.gridSpacing);
      
      if (mouseX > x && mouseX < x + tileSize && 
          mouseY > y && mouseY < y + tileSize) {
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

  // // Calculate grid position with offset for header
  // let col = floor(mouseX / tileSize);
  // let row = floor((mouseY - 80) / tileSize);

  // if (col >= 0 && col < gridSize && row >= 0 && row < gridSize) {
  //   // Toggle selection state
  //   selectedTiles[col][row] = !selectedTiles[col][row];

  //   // Update counts and tracking variables
  //   updateSelectionCount();
    
  //   // Reset webcam transition if multiple tiles are selected
  //   if (selectionCount !== 1) {
  //     selectionTime = 0;
  //     showingWebcam = false;
  //   } else {
  //     // Start timer for webcam transition if exactly one tile is selected
  //     selectionTime = millis();
  //     selectedCol = col;
  //     selectedRow = row;
  //   }

  //   // Update scores based on selection logic
  //   updateScores(col, row);
  // }
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

function updateIpAdapter() {
  let value = slider.value();
  ipAdapter = loadImage(`ipAdapter-${value}.png`);
}

function requestImage() {
  // Change to generation state
  appState = "GENERATION";
  
  // Hide the generate button during processing
  document.getElementById("generateButton").style.display = "none";
  document.getElementById("ipSlider").style.display = "none";
  
  if (!bg) {
    console.error("No background image available");
    return;
  }
  
  // Prepare source image for generation
  srcImg.image(capturedImage, 0, 0, config.canvasWidth, config.canvasHeight);
  
  // replace the LoadImage node with our source image
  workflow[10] = comfy.image(srcImg);

  // update the seed in KSampler  
  workflow[3].inputs.seed = Math.floor(Math.random() * 1e15);
  console.log("seed: ", workflow[3].inputs.seed);
  
  // reduce the number of steps (to make it faster)
  workflow[3].inputs.steps = 10;
  
  // replace ipAdapter with our own image
  workflow[28] = comfy.image(ipAdapter);

  comfy.run(workflow, gotImage);
}

function gotImage(results, err) {
  // data is an array of outputs from running the workflow
  console.log("gotImage", results);

  // you can load them like so
  if (results.length > 0) {
    resImg = loadImage(results[0].src, () => {
      // After loading the result image, save both the result and the JSON data
      saveGeneratedResults();
    });
  }
}

function saveGeneratedResults() {
  // Update JSON data with the filename
  userSelectionData.generatedImage = jsonFilename + '.png';
  
  // Save the JSON data
  saveJSON(userSelectionData, jsonFilename + '.json');
  
  // Save the generated image
  resImg.save(jsonFilename + '.png');
  
  console.log("Generation complete - saved image and data:", jsonFilename);
}

function resetCaptcha() {
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
  captchaTitle = "Choose the most rational state";
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