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
// Blend settings, changed from the debug panel (press D). Moving a slider changes them until the
// page is reloaded; "Save as default" keeps them in this browser as the values it starts with.
const MORPH_SECONDS = 3.8; // one turn from face to face at normal speed: the same on the opening screen, the result screen and the archive wall
const DEFAULT_SETTINGS = { strength: DEFAULT_STRENGTH, hostShare: HOST_SHARE, outlineShare: 0, morphSpeed: 1 };
function savedDefaults() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('ep-defaults') || '{}') }; } catch (e) { return { ...DEFAULT_SETTINGS }; }
}
const settings = savedDefaults();
function setSettings(changes) { Object.assign(settings, changes); }
/** Keep the current settings as this browser's defaults. Returns false if the browser refuses. */
function saveDefaults() {
  try { localStorage.setItem('ep-defaults', JSON.stringify(settings)); return true; } catch (e) { return false; }
}
/** Forget this browser's saved defaults and go back to the original values. */
function clearDefaults() {
  try { localStorage.removeItem('ep-defaults'); } catch (e) { /* no storage */ }
  Object.assign(settings, DEFAULT_SETTINGS);
}
let last = null;      // the last visitor and chosen face, so the debug panel can re-blend them
let showing = null;   // the faces the reveal is drawing right now

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
    const k = 0.35 + Math.random() * 0.3;
    const face = engine.comboFace(a, b, k, FACE_TEMPLATE);
    const url = face.canvas.toDataURL('image/jpeg', 0.9);
    combos.set(url, { face, parents: [a.sessionId, b.sessionId].filter(Boolean), mix: k });
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
async function blend(capturedImage, selectedSrc) {
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
  last = { host, guest, hostFlat: engine.flatten(host, FACE_TEMPLATE), parents: combo ? combo.parents : [], mix: combo ? combo.mix : undefined };
  return mixLast();
}

/** Blend the last visitor with the last chosen face, using the current settings. */
function mixLast() {
  const { host, guest, hostFlat, parents, mix } = last;
  const out = engine.blend(host, guest, collectiveShape(), settings);
  const flat = engine.ovalTile(engine.flatten({ canvas: out.canvas, p3: out.p3 }, FACE_TEMPLATE), FACE_TEMPLATE);
  return {
    hostFlat, // the visitor's own face, for the reveal only; never saved
    dataUrl: out.canvas.toDataURL('image/png'),
    artifactUrl: flat.tile.toDataURL('image/png'),
    flat,
    parents,
    mix,                       // how the two parents were combined into the chosen face
    settings: { ...settings }, // the blend settings this face was made with
  };
}

/** Debug only: blend the last capture again with the current settings and show it. Nothing is saved. */
function preview() {
  if (!last || !showing) return false;
  const old = showing.to;
  showing.to = mixLast().flat;
  showing.holdUntil = performance.now() + 4000; // stay on the new result for a moment
  if (revealPlayer) revealPlayer.release(old);
  return true;
}

// One canvas and one morph player are reused for every reveal.
let revealCanvas = null, revealPlayer = null;

/**
 * Show one face in `container`. It fades up as the visitor's own face, turns into the blended
 * face, and then keeps moving slowly between the two (before and after) for as long as it is on
 * screen. Resolves when the first turn has finished.
 */
function reveal(container, result, { seconds = MORPH_SECONDS, hold = 1.4, rest = 2.4 } = {}) {
  if (!revealCanvas) {
    revealCanvas = document.createElement('canvas');
    revealCanvas.width = revealCanvas.height = 512;
    revealCanvas.id = 'reveal-face';
    revealPlayer = engine.createMorphPlayer(revealCanvas, FACE_TEMPLATE);
  }
  revealPlayer.clear();
  revealCanvas.classList.remove('shown');
  container.append(revealCanvas);
  const faces = showing = { from: result.hostFlat, to: result.flat };
  revealPlayer.draw(faces.from, faces.to, 0);
  // Fade the face up out of black before it starts to change.
  requestAnimationFrame(() => requestAnimationFrame(() => revealCanvas.classList.add('shown')));
  const ease = (k) => k * k * (3 - 2 * k);
  const canvas = revealCanvas;
  return new Promise((done) => {
    // The reveal runs on its own clock, so the morph speed setting can change while it plays.
    let clock = -hold, lastNow = performance.now();  // rest on the visitor's own face for a moment first
    const cycle = 2 * (seconds + rest);            // after -> hold -> before -> hold -> after ...
    let finishedFirst = false;
    const frame = (now) => {
      if (!canvas.isConnected || revealCanvas !== canvas) return;
      clock += (Math.min(now - lastNow, 100) / 1000) * settings.morphSpeed; lastNow = now;
      const t = Math.max(0, clock);
      let k;
      if (t < seconds) k = ease(t / seconds);                 // first turn: before -> after
      else {
        if (!finishedFirst) { finishedFirst = true; done(); }
        const u = (t - seconds) % cycle;
        if (u < rest) k = 1;                                  // rest on after
        else if (u < rest + seconds) k = 1 - ease((u - rest) / seconds); // back to before
        else if (u < 2 * rest + seconds) k = 0;               // rest on before
        else k = ease((u - 2 * rest - seconds) / seconds);    // forward to after again
      }
      revealPlayer.draw(faces.from, faces.to, now < (faces.holdUntil || 0) ? 1 : k);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

/** Save the artifact's tile to the archive and add it to the morph straight away. */
async function saveTile(sessionId, result) {
  flats.push({ sessionId, ...result.flat });
  await archive.saveTile(sessionId, result.flat, result.parents, { mix: result.mix, settings: result.settings });
}

/** Start the morphing collective face on a canvas, fed from the archive. */
async function startMorph(canvas) {
  await ready;
  player = engine.createMorphPlayer(canvas, FACE_TEMPLATE);
  player.play(flats, { seconds: () => MORPH_SECONDS / settings.morphSpeed });
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

window.EP = { ready, blend, reveal, saveTile, startMorph, makeCombos, archive, settings, setSettings, preview, savedDefaults, saveDefaults, clearDefaults };

// The opening screen shows the collective face as soon as the page loads.
const collectiveCanvas = document.getElementById('collective-face');
if (collectiveCanvas) startMorph(collectiveCanvas).catch((e) => console.error('Collective face failed to start:', e));
