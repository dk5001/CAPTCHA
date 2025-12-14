// CAPTCHA interface variables for ComfyUI generation
let workflow;
let comfy;
let srcImg;
let resImg;
let capturedImage = null;
let selectedImage = null;
let jsonFilename = "";
let displayChannel;

// Configuration object for essential settings
const config = {
  canvasWidth: 800,
  canvasHeight: 900,
  selectionHeaderColor: [100, 100, 100],
  rationalTestHeaderColor: [255, 0, 0]
};

function preload() {
  // Load ComfyUI workflow
  workflow = loadJSON("latent_face_morph_workflow_controlNet_API_v3.json");
}

function setup() {
  // Create a hidden canvas for ComfyUI operations
  createCanvas(config.canvasWidth, config.canvasHeight);
  canvas.style.display = 'none';
  
  // Initialize source graphics for image processing
  srcImg = createGraphics(config.canvasWidth, config.canvasHeight);
  
  // Initialize ComfyUI helper
  comfy = new ComfyUiP5Helper("http://127.0.0.1:8188/");
  console.log("workflow is", workflow);
  
  // Initialize BroadcastChannel for display window communication
  displayChannel = new BroadcastChannel('captcha_generation');
  
  // We don't need to draw anything in this sketch since the UI is handled by HTML
  noLoop();
}

// Function called from index.html to process images
function processImages(capturedImg, selectedImg) {
  console.log("Processing images in sketch.js");
  
  // Set the global references
  capturedImage = capturedImg;
  selectedImage = selectedImg;
  
  // Generate a unique filename
  jsonFilename = 'subject_' + Math.floor(100000 + Math.random() * 900000);
  
  // Request image generation
  requestImage();
  
  return jsonFilename;
}

function requestImage() {
  if (!capturedImage) {
    console.error("No captured image available");
    return;
  }
  
  // Prepare source image for generation
  srcImg.image(capturedImage, 0, 0, config.canvasWidth, config.canvasHeight);

  // replace the LoadImage node with our source image
  workflow[1] = comfy.image(srcImg);
  workflow[2] = comfy.image(selectedImage);
  workflow[6].inputs.seed = Math.floor(Math.random() * 1e15);
  console.log("seed: ", workflow[3].inputs.seed);

  console.log("Running ComfyUI workflow");
  comfy.run(workflow, gotImage);
}

function gotImage(results, err) {
  console.log("gotImage", results);

  if (err) {
    console.error("Error in ComfyUI generation:", err);
    // Notify index.html of error
    if (window.parent && window.parent.handleGenerationError) {
      window.parent.handleGenerationError(err);
    }
    return;
  }

  if (results && results.length > 0) {
    resImg = loadImage(results[0].src, () => {
      // Process the morphed images for next round
      updateGridImagesForNextRound(resImg);
      
      // Broadcast to display window
      if (displayChannel) {
        displayChannel.postMessage({
          type: 'new_image',
          url: results[0].src
        });
      }
      
      // Store in localStorage as backup
      localStorage.setItem('lastGeneratedImage', results[0].src);
      
      // After loading the result image, notify index.html
      if (window.parent && window.parent.handleGeneratedImage) {
        window.parent.handleGeneratedImage(results[0].src, jsonFilename);
      }
    });
  }
}

// New function to update grid images based on generated result
function updateGridImagesForNextRound(generatedImage) {
  // Get original images path from localStorage if available
  const originalPaths = JSON.parse(localStorage.getItem('originalImagePaths') || '[]');
  
  if (originalPaths.length === 0) {
    console.log("No original image paths found, skipping grid update");
    return;
  }
  
  console.log("Updating grid images for next round");
  
  // Create a smaller version of the workflow for image morphing
  const morphWorkflow = JSON.parse(JSON.stringify(workflow));
  
  // Queue for processing images sequentially
  const processingQueue = [];
  
  // For each original image, create a morphed version
  for (let i = 0; i < originalPaths.length; i++) {
    processingQueue.push({
      originalPath: originalPaths[i],
      index: i
    });
  }
  
  // Process images one by one
  processNextImageInQueue(processingQueue, generatedImage, morphWorkflow);
}

function processNextImageInQueue(queue, generatedImage, morphWorkflow) {
  if (queue.length === 0) {
    console.log("All grid images updated for next round");
    return;
  }
  
  const task = queue.shift();
  
  loadImage(task.originalPath, (origImg) => {
    console.log(`Processing image ${task.index}`);
    
    // Create a graphics buffer for this image
    const imgBuffer = createGraphics(origImg.width, origImg.height);
    
    // Draw the original image
    imgBuffer.image(origImg, 0, 0);
    
    // Blend with the generated image (simple approach)
    imgBuffer.blendMode(MULTIPLY);
    imgBuffer.tint(255, 50); // 20% opacity
    imgBuffer.image(generatedImage, 0, 0, origImg.width, origImg.height);
    imgBuffer.blendMode(BLEND);
    
    // Save the new image to localStorage
    const morphedImageData = imgBuffer.canvas.toDataURL('image/png');
    
    // Store in localStorage with index to preserve order
    localStorage.setItem(`morphedImage_${task.index}`, morphedImageData);
    
    // Continue with next image
    processNextImageInQueue(queue, generatedImage, morphWorkflow);
  });
}

// Called from index.html to get morphed images for next round
function getMorphedImagesForNextRound(count) {
  const morphedImages = [];
  
  for (let i = 0; i < count; i++) {
    const morphedImageData = localStorage.getItem(`morphedImage_${i}`);
    if (morphedImageData) {
      morphedImages.push(morphedImageData);
    }
  }
  
  return morphedImages;
}