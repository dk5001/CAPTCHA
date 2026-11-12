// Glue between the visitor page (index.html) and the V2 face engine.
// index.html is a classic script; it talks to this module through `window.EP`.

import { createFaceEngine, DEFAULT_STRENGTH } from './face-engine.js';
import { createArchive } from './archive.js';
import { FACE_TEMPLATE } from './face-template.js';
import { HIDDEN_TILES } from './hidden-tiles.js';

const PLAYLIST_SIZE = 40;        // faces held in memory for the morph at any one time
const ROTATE_EVERY_MS = 12000;   // how often one face in the playlist is swapped for another
const SEED_FACES = Array.from({ length: 9 }, (_, i) => `images/img0${i + 1}.png`);

// SUPABASE_URL and SUPABASE_KEY come from config.js.
const archive = createArchive({ url: SUPABASE_URL, key: SUPABASE_KEY });
const flats = []; // flattened faces currently in the morph playlist
let engine = null;
let player = null;

const ready = createFaceEngine().then((e) => { engine = e; return e; });
ready.catch((e) => console.error('Face engine failed to start:', e));

const loadImage = (src) => new Promise((ok, fail) => {
  const im = new Image();
  im.crossOrigin = 'anonymous';
  im.onload = () => ok(im);
  im.onerror = () => fail(new Error('could not load ' + src));
  im.src = src;
});

/** The collective shape: the mean of the faces in the playlist (the template until any load). */
function collectiveShape() {
  if (!flats.length) return FACE_TEMPLATE;
  const mean = new Float32Array(FACE_TEMPLATE.length);
  for (const f of flats) for (let i = 0; i < mean.length; i++) mean[i] += f.shape[i] / flats.length;
  return mean;
}

const HOST_SHARE = 1 / 3; // how much of a saved face is the visitor's own: a third
const combos = new Map(); // picture shown in the grid -> the combination behind it

/**
 * Pictures for the nine squares: each is a new combination of two stored faces.
 * Returns null until enough stored faces have loaded.
 */
function makeCombos(count) {
  if (!engine || flats.length < 2) return null;
  combos.clear();
  const urls = [];
  for (let n = 0; n < count; n++) {
    const a = flats[Math.floor(Math.random() * flats.length)];
    let b; do { b = flats[Math.floor(Math.random() * flats.length)]; } while (b === a);
    const face = engine.comboFace(a, b, 0.35 + Math.random() * 0.3, FACE_TEMPLATE);
    const url = face.canvas.toDataURL('image/jpeg', 0.9);
    combos.set(url, { face, parents: [a.sessionId, b.sessionId].filter(Boolean) });
    urls.push(url);
  }
  return urls;
}

/**
 * Blend the visitor's photo with the combination they chose. The visitor's photo is only ever
 * used here, in the browser. What comes back:
 *   dataUrl      the full picture, with the visitor's own hair and background. Shown to them, never saved.
 *   artifactUrl  the face inside an oval on black, a third theirs. This is what is kept.
 * Throws an Error with code 'NO_FACE' when no face is found in the visitor's photo.
 */
async function blend(capturedImage, selectedSrc, { strength = DEFAULT_STRENGTH } = {}) {
  await ready;
  const host = engine.analyze(capturedImage);
  if (!host) throw Object.assign(new Error('No face found in the photo'), { code: 'NO_FACE' });
  const combo = combos.get(selectedSrc);
  let guest = combo ? combo.face : null;
  if (!guest) {
    try { guest = engine.analyze(await loadImage(selectedSrc)); } catch (e) { console.warn(e.message); }
  }
  if (!guest) {
    // The chosen picture has no usable face: fall back to a seed face.
    guest = engine.analyze(await loadImage(SEED_FACES[Math.floor(Math.random() * SEED_FACES.length)]));
  }
  const out = engine.blend(host, guest, collectiveShape(), { strength, hostShare: HOST_SHARE });
  const flat = engine.ovalTile(engine.flatten({ canvas: out.canvas, p3: out.p3 }, FACE_TEMPLATE), FACE_TEMPLATE);
  return {
    hostFlat: engine.flatten(host, FACE_TEMPLATE), // the visitor's own face, for the reveal only; never saved
    dataUrl: out.canvas.toDataURL('image/png'),
    artifactUrl: flat.tile.toDataURL('image/png'),
    flat,
    parents: combo ? combo.parents : [],
  };
}

// One canvas and one morph player are reused for every reveal.
let revealCanvas = null, revealPlayer = null;

/**
 * Show one face in `container`: it starts as the visitor's own face and slowly turns into the
 * blended face, then stays there. Resolves when the morph has finished.
 */
function reveal(container, result, { seconds = 6, hold = 2.2 } = {}) {
  if (!revealCanvas) {
    revealCanvas = document.createElement('canvas');
    revealCanvas.width = revealCanvas.height = 512;
    revealCanvas.id = 'reveal-face';
    revealPlayer = engine.createMorphPlayer(revealCanvas, FACE_TEMPLATE);
  }
  revealCanvas.classList.remove('shown');
  container.append(revealCanvas);
  const from = result.hostFlat, to = result.flat;
  revealPlayer.draw(from, to, 0);
  // Fade the face up out of black before it starts to change.
  requestAnimationFrame(() => requestAnimationFrame(() => revealCanvas.classList.add('shown')));
  return new Promise((done) => {
    const start = performance.now() + hold * 1000; // rest on the visitor's own face for a moment first
    const frame = (now) => {
      const k = Math.min(1, Math.max(0, (now - start) / (seconds * 1000)));
      revealPlayer.draw(from, to, k * k * (3 - 2 * k));
      if (k < 1 && revealCanvas.isConnected) requestAnimationFrame(frame);
      else { revealPlayer.clear(); done(); } // the last frame stays on the canvas
    };
    requestAnimationFrame(frame);
  });
}

/** Save the artifact's tile to the archive and add it to the morph straight away. */
async function saveTile(sessionId, result) {
  flats.push({ sessionId, ...result.flat });
  await archive.saveTile(sessionId, result.flat, result.parents);
}

/** Start the morphing collective face on a canvas, fed from the archive. */
async function startMorph(canvas) {
  await ready;
  player = engine.createMorphPlayer(canvas, FACE_TEMPLATE);
  player.play(flats);
  // Faces come from the database a random batch at a time, so this works at any archive size.
  let queue = [];
  const next = async () => {
    if (!queue.length) queue = (await archive.randomFaces(PLAYLIST_SIZE)).filter((id) => !HIDDEN_TILES.has(id));
    const id = queue.shift();
    if (!id) return null;
    try { return await archive.loadFlat(id); } catch (e) { return null; }
  };
  const total = await archive.countFaces();
  const target = Math.min(PLAYLIST_SIZE, total);
  for (let tries = 0; flats.length < target && tries < target * 3; tries++) {
    const flat = await next();
    if (flat && !flats.some((f) => f.sessionId === flat.sessionId)) flats.push(flat);
    // Tell the page as soon as there are enough faces to fill the grid with combinations.
    if (flats.length === 9 || flats.length === target) window.dispatchEvent(new Event('ep-faces-ready'));
  }
  // Keep swapping faces in and out, so over time the morph passes through the whole archive.
  if (total > PLAYLIST_SIZE) {
    setInterval(async () => {
      const flat = await next();
      if (!flat || flats.length < 3) return;
      const old = flats.splice(Math.floor(Math.random() * flats.length), 1, flat)[0];
      setTimeout(() => player.release(old), 10000); // after any morph still using it has finished
    }, ROTATE_EVERY_MS);
  }
}

window.EP = { ready, blend, reveal, saveTile, startMorph, makeCombos, archive };

// The opening screen shows the collective face as soon as the page loads.
const collectiveCanvas = document.getElementById('collective-face');
if (collectiveCanvas) startMorph(collectiveCanvas).catch((e) => console.error('Collective face failed to start:', e));
