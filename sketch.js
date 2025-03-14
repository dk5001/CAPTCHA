// comfy related 
let workflow;
let comfy;
let bg;
let ipAdapter;
let srcImg;
let resImg;
let ipSlider;

// webcam related
let video;
let faceMesh;
let faces = [];
let offsetX = 0;
let offsetY = 0;
let isBoxInEllipse = false;
let captureTimer = 0;
let captureReady = false;
let lastCaptureTime = 0;
let cooldownPeriod = 3000; // 3 seconds cooldown between captures
let capturedImage = null;

function preload() { workflow = loadJSON("character-sheet-ipadapter.json");
  bg = loadImage("Brain.png");
  ipAdapter = loadImage("ipAdapter-2.png");

  // Load FaceMesh model
  faceMesh = ml5.faceMesh({ maxFaces: 1, flipped: true });
}

function mousePressed() {
  console.log(faces);
}

function gotFaces(results) {
  faces = results;
}

function setup() {
  bg.loadPixels();
  createCanvas(bg.width, bg.height);
  pixelDensity(1);
  srcImg = createGraphics(width, height);

  comfy = new ComfyUiP5Helper("http://127.0.0.1:8188/");  // for ComfyUI Web
  // comfy = new ComfyUiP5Helper("http://127.0.0.1:8000/"); // for ComfyUI Desktop
  console.log("workflow is", workflow);

  let button = createButton("start generating");
  button.mousePressed(requestImage);

  slider = createSlider(1, 3, 2, 1);
  slider.input(updateIpAdapter);

  // let uploadButton = createFileInput(handleFile);
  // uploadButton.position(10, 10);

  // load webcam footage
  video = createCapture(VIDEO, { flipped: true });
  video.hide();

  // Start detecting faces
  faceMesh.detectStart(video, gotFaces);
}

function handleFile(file) {
  if (file.type === 'image') {
    bg = loadImage(file.data, () => {
      bg.loadPixels();
      resizeCanvas(bg.width, bg.height);
      srcImg = createGraphics(width, height);
    });
  } else {
    console.log('Not an image file!');
  }
}

function updateIpAdapter() {
  let value = slider.value();
  ipAdapter = loadImage(`ipAdapter-${value}.png`);
}

function requestImage() {
  if (!bg) {
    console.error("No background image available");
    return;
  }
  
  // replace the LoadImage node with our source image
  workflow[10] = comfy.image(srcImg);

  // update the seed in KSampler  
  // workflow[3].inputs.seed = workflow[3].inputs.seed + 1;
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
    resImg = loadImage(results[0].src);
  }
}

function draw() {
  // draw a scene into the source image to use for generation
  // srcImg.image(bg, 0, 0);
  srcImg.clear();

  // Display webcam or captured image
  if (capturedImage) {
    // If we have a captured image, show it on both canvas and source image
    image(capturedImage, 0, 0);
    srcImg.image(capturedImage, 0, 0);
  } else {
    // Otherwise, show the webcam feed
    if (faces.length > 0) {
      let face = faces[0];
      let box = face.box;
  
      let videoCenterX = video.width / 2;
      let videoCenterY = video.height / 2;
      let rectSize = 100;
      let ellipseWidth = rectSize * 2;
      let ellipseHeight = rectSize * 2.5;
      let faceCenterX = box.xMin + (box.width / 2);
      let faceCenterY = box.yMin + (box.height / 2);
  
      image(video, 0, 0);
  
      // Draw a bounding box around the detected face
      stroke(255, 255, 0);
      strokeWeight(4);
      noFill();
      let faceEllipseWidth = box.width * 1.2;
      let faceEllipseHeight = box.height * 1.2;
      ellipse(faceCenterX, faceCenterY, faceEllipseWidth, faceEllipseHeight);
      // rect(box.xMin, box.yMin, box.width, box.height);
      
      // Draw a small dot at the center of the face
      fill(255, 255, 0);
      noStroke();
      ellipse(faceCenterX, faceCenterY, 5, 5);
      
      // capture image when the bounding box(yellow) reaches the target(red)
      stroke(255, 0, 0);
      strokeWeight(4);
      noFill();
      ellipse(videoCenterX, videoCenterY, ellipseWidth, ellipseHeight);
      // rect(videoCenterX - rectSize/2, videoCenterY - rectSize/2, rectSize, rectSize);
  
      // Check if face center is within the red ellipse
      // Calculate normalized coordinates within the ellipse (ellipse equation: (x/a)² + (y/b)² <= 1)
      let normalizedX = (faceCenterX - videoCenterX) / (ellipseWidth / 2);
      let normalizedY = (faceCenterY - videoCenterY) / (ellipseHeight / 2);
      let inEllipse = (normalizedX * normalizedX + normalizedY * normalizedY) <= 1;
  
      // Display status text
      fill(50, 50, 255); // Blue text for status
      noStroke();
      textSize(16);
      
      if (inEllipse) {
        if (!isBoxInEllipse) {
          // Face just entered the ellipse
          isBoxInEllipse = true;
          captureTimer = millis();
          captureReady = false;
        }
        
        // Calculate time remaining until capture
        let timeElapsed = millis() - captureTimer;
        let timeRemaining = 1000 - timeElapsed; // 1000ms = 1s
        
        if (timeRemaining > 0) {
          console.log("Capturing in: " + Math.ceil(timeRemaining/100));
        } else if (!captureReady) {
          // Time's up, capture the image
          captureReady = true;
          captureFaceImage();
        }
      } else {
        isBoxInEllipse = false;
        console.log("Position face inside red ellipse");
      }
    }
  }
  // Finally, draw the result image on top of everything if available
  // This ensures it's always displayed as the final layer
  if (resImg) {
    image(resImg, 0, 0, width, height);
    
    // Add a reset button to allow capturing a new image
    if (!window.resetButton) {
      window.resetButton = createButton("New Capture");
      window.resetButton.position(180, 10);
      window.resetButton.mousePressed(() => {
        capturedImage = null;
        resImg = null;
        if (window.resetButton) {
          window.resetButton.remove();
          window.resetButton = null;
        }
      });
    }
  }

  // Add status text when captured but not yet generated
  if (capturedImage && !resImg) {
    fill(50, 50, 255); // Blue text for status
    noStroke();
    textSize(20);
    console.log("Image captured! Press 'start generating' button");
  }
}

function captureFaceImage() {
  // Check if cooldown period has elapsed
  let currentTime = millis();
  if (currentTime - lastCaptureTime < cooldownPeriod) {
    return; // Skip if in cooldown period
  }
  
  // Capture the current video frame
  capturedImage = video.get();
  bg = video.get(); // Set the background to the captured image
  bg.loadPixels();

  lastCaptureTime = currentTime;
  console.log("Face captured and set as background");
  
  // Uncomment to auto-generate after capture:
  // requestImage();
}