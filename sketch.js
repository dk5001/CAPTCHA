let workflow;
let comfy;
let bg;
let ipAdapter;
let srcImg;
let resImg;
let ipSlider;

function preload() { workflow = loadJSON("character-sheet-ipadapter.json");
  bg = loadImage("Brain.png");
  ipAdapter = loadImage("ipAdapter-2.png");
}

function setup() {
  bg.loadPixels();
  createCanvas(bg.width, bg.height);
  pixelDensity(1);
  srcImg = createGraphics(width, height);

  // http://127.0.0.1:8188 (if you're using the standard ComfyUI)
  // http://127.0.0.1:8000 (if you're using ComfyUI Desktop)
  comfy = new ComfyUiP5Helper("http://127.0.0.1:8000/");
  console.log("workflow is", workflow);

  let button = createButton("start generating");
  button.mousePressed(requestImage);

  slider = createSlider(1, 3, 2, 1);
  slider.input(updateIpAdapter);

  let uploadButton = createFileInput(handleFile);
  uploadButton.position(10, 10);
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
  srcImg.image(bg, 0, 0);

  //if we have an image, put it onto the canvas
  if (resImg) {
    image(resImg, 0, 0, width, height);
    // console.log("result image drawn");
  }
}