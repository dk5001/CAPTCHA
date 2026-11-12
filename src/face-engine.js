// Face engine for Evolving Portrait V2.
// Finds the same 478 points on every face, warps faces onto a shared shape with WebGL,
// and mixes them inside a hair-aware skin mask. No server, no image-generating model.
//
// Faces arrive at any size, position and angle. Two things keep that from distorting a blend:
//   1. analyze() re-frames every photo so the eyes sit level at one fixed place and size.
//   2. Shapes are compared in 3D, so a turned or tilted head is rotated to match the other
//      head first and is never mistaken for a narrower or shorter face.

import { FilesetResolver, FaceLandmarker, ImageSegmenter } from '../vendor/mediapipe/vision_bundle.mjs';

export const DEFAULT_STRENGTH = 3; // 300%: how far a blend is pushed away from the collective face

const N = 478;
const R_EYE = 468, L_EYE = 473, FOREHEAD = 10, CHIN = 152;
const FACE_SKIN = 3;      // class index in the selfie multiclass segmenter
const EYE_DIST = 0.25;    // distance between the eyes, as a share of the frame
const EYE_Y = 0.44;       // height of the eye line, as a share of the frame
const MAX_UPSCALE = 5;    // faces that would need more enlarging than this are too small to use
const MAX_LEVEL_ROLL = 0.14; // radians (8 degrees): heads tilted less than this are not rotated
const LIP_TOP = 13, LIP_BOTTOM = 14; // inner edge of the upper and lower lip
const MOUTH_MISMATCH = 0.05; // difference in mouth opening (share of eye distance) that counts as open vs shut
const MAX_PUSH = 0.12;    // cap on how far exaggeration may move one point, as a share of eye distance

// ---------- geometry: shapes are Float32Array of x,y,z per point, in pixels ----------

function xy(p3) {
  const out = new Float32Array((p3.length / 3) * 2);
  for (let i = 0, j = 0; i < p3.length; i += 3, j += 2) { out[j] = p3[i]; out[j + 1] = p3[i + 1]; }
  return out;
}

function mix(a, b, t) {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] + (b[i] - a[i]) * t;
  return out;
}

/** Best rotation + uniform scale + shift taking src onto dst, in 3D (Horn's quaternion method). */
export function align3(src, dst) {
  const n = src.length / 3;
  const cs = [0, 0, 0], cd = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { cs[k] += src[3 * i + k] / n; cd[k] += dst[3 * i + k] / n; }
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  let norm = 0;
  for (let i = 0; i < n; i++) {
    const p = [src[3 * i] - cs[0], src[3 * i + 1] - cs[1], src[3 * i + 2] - cs[2]];
    const q = [dst[3 * i] - cd[0], dst[3 * i + 1] - cd[1], dst[3 * i + 2] - cd[2]];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) S[a][b] += p[a] * q[b];
    norm += p[0] * p[0] + p[1] * p[1] + p[2] * p[2];
  }
  const [[xx, xy_, xz], [yx, yy, yz], [zx, zy, zz]] = S;
  const M = [
    [xx + yy + zz, yz - zy, zx - xz, xy_ - yx],
    [yz - zy, xx - yy - zz, xy_ + yx, zx + xz],
    [zx - xz, xy_ + yx, -xx + yy - zz, yz + zy],
    [xy_ - yx, zx + xz, yz + zy, -xx - yy + zz],
  ];
  let shift = 0;
  for (const row of M) for (const v of row) shift += Math.abs(v);
  let q = [1, 0, 0, 0];
  for (let it = 0; it < 200; it++) { // power iteration for the dominant eigenvector
    const r = [0, 0, 0, 0];
    for (let a = 0; a < 4; a++) { for (let b = 0; b < 4; b++) r[a] += M[a][b] * q[b]; r[a] += shift * q[a]; }
    const len = Math.hypot(...r);
    q = r.map((v) => v / len);
  }
  const [w, x, y, z] = q;
  const R = [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
  ];
  let dot = 0;
  for (let i = 0; i < n; i++) {
    const p = [src[3 * i] - cs[0], src[3 * i + 1] - cs[1], src[3 * i + 2] - cs[2]];
    for (let a = 0; a < 3; a++) dot += (dst[3 * i + a] - cd[a]) * (R[a][0] * p[0] + R[a][1] * p[1] + R[a][2] * p[2]);
  }
  const s = dot / norm;
  const t = [0, 1, 2].map((a) => cd[a] - s * (R[a][0] * cs[0] + R[a][1] * cs[1] + R[a][2] * cs[2]));
  return { s, R, t };
}

export function move3({ s, R, t }, pts) {
  const out = new Float32Array(pts.length);
  for (let i = 0; i < pts.length; i += 3) {
    const x = pts[i], y = pts[i + 1], z = pts[i + 2];
    out[i] = s * (R[0][0] * x + R[0][1] * y + R[0][2] * z) + t[0];
    out[i + 1] = s * (R[1][0] * x + R[1][1] * y + R[1][2] * z) + t[1];
    out[i + 2] = s * (R[2][0] * x + R[2][1] * y + R[2][2] * z) + t[2];
  }
  return out;
}

/** Turn a shape to face the camera squarely and seat it at the standard eye position. */
function seatFrontal(p3, size) {
  const at = (i) => [p3[3 * i], p3[3 * i + 1], p3[3 * i + 2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const unit = (v) => { const l = Math.hypot(...v); return v.map((c) => c / l); };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const ex = unit(sub(at(L_EYE), at(R_EYE)));
  let ey = sub(at(CHIN), at(FOREHEAD));
  const k = dot(ey, ex);
  ey = unit([ey[0] - k * ex[0], ey[1] - k * ex[1], ey[2] - k * ex[2]]);
  const ez = [ex[1] * ey[2] - ex[2] * ey[1], ex[2] * ey[0] - ex[0] * ey[2], ex[0] * ey[1] - ex[1] * ey[0]];
  const turned = move3({ s: 1, R: [ex, ey, ez], t: [0, 0, 0] }, p3);
  const r = [turned[3 * R_EYE], turned[3 * R_EYE + 1]], l = [turned[3 * L_EYE], turned[3 * L_EYE + 1]];
  const s = (EYE_DIST * size) / Math.hypot(l[0] - r[0], l[1] - r[1]);
  const mid = [(r[0] + l[0]) / 2, (r[1] + l[1]) / 2, (turned[3 * R_EYE + 2] + turned[3 * L_EYE + 2]) / 2];
  const I = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  return move3({ s, R: I, t: [size / 2 - s * mid[0], EYE_Y * size - s * mid[1], -s * mid[2]] }, turned);
}

/** Mean shape of many faces: differences in position, size and head angle are removed first. */
export function meanShape(shapes, size) {
  let ref = seatFrontal(shapes[0], size);
  for (let pass = 0; pass < 3; pass++) {
    const acc = new Float32Array(ref.length);
    for (const s of shapes) {
      const al = move3(align3(s, ref), s);
      for (let i = 0; i < acc.length; i++) acc[i] += al[i] / shapes.length;
    }
    ref = seatFrontal(acc, size);
  }
  return ref;
}

/** Triangles of MediaPipe's own face mesh, plus fills for the eye and mouth openings. */
function buildMesh() {
  const adj = new Map();
  const link = (a, b) => { if (!adj.has(a)) adj.set(a, new Set()); adj.get(a).add(b); };
  for (const { start, end } of FaceLandmarker.FACE_LANDMARKS_TESSELATION) { link(start, end); link(end, start); }
  const tris = [];
  for (const [a, na] of adj) for (const b of na) if (b > a) for (const c of adj.get(b)) if (c > b && na.has(c)) tris.push([a, b, c]);

  // Edges used by exactly one triangle are the open rims: the face outline, two eyes, the mouth.
  const count = new Map();
  const key = (a, b) => (a < b ? a * 1000 + b : b * 1000 + a);
  for (const [a, b, c] of tris) for (const [u, v] of [[a, b], [b, c], [c, a]]) count.set(key(u, v), (count.get(key(u, v)) || 0) + 1);
  const rim = new Map();
  for (const [k, c] of count) if (c === 1) {
    const u = Math.floor(k / 1000), v = k % 1000;
    if (!rim.has(u)) rim.set(u, []); if (!rim.has(v)) rim.set(v, []);
    rim.get(u).push(v); rim.get(v).push(u);
  }
  const loops = [], seen = new Set();
  for (const startV of rim.keys()) {
    if (seen.has(startV)) continue;
    const loop = [startV]; seen.add(startV);
    let prev = -1, cur = startV;
    for (;;) {
      const next = rim.get(cur).find((v) => v !== prev && !seen.has(v));
      if (next === undefined) break;
      loop.push(next); seen.add(next); prev = cur; cur = next;
    }
    loops.push(loop);
  }
  const outline = loops.find((l) => l.includes(FOREHEAD)) || loops[0];
  for (const loop of loops) {
    if (loop === outline) continue;
    for (let i = 1; i + 1 < loop.length; i++) tris.push([loop[0], loop[i], loop[i + 1]]);
  }
  return { tris, outline };
}

function borderPoints(size, perSide = 4) {
  const pts = [];
  for (let i = 0; i < perSide; i++) pts.push((i / perSide) * size, 0);
  for (let i = 0; i < perSide; i++) pts.push(size, (i / perSide) * size);
  for (let i = 0; i < perSide; i++) pts.push(size - (i / perSide) * size, size);
  for (let i = 0; i < perSide; i++) pts.push(0, size - (i / perSide) * size);
  return new Float32Array(pts);
}

/** Stitch the band between the face outline and the image border into triangles. */
function ringTriangles(shape, outline, border) {
  let cx = 0, cy = 0;
  for (const i of outline) { cx += shape[2 * i]; cy += shape[2 * i + 1]; }
  cx /= outline.length; cy /= outline.length;
  const inner = outline.map((i) => ({ i, t: Math.atan2(shape[2 * i + 1] - cy, shape[2 * i] - cx) })).sort((p, q) => p.t - q.t);
  const outer = [];
  for (let j = 0; j < border.length / 2; j++) outer.push({ i: N + j, t: Math.atan2(border[2 * j + 1] - cy, border[2 * j] - cx) });
  outer.sort((p, q) => p.t - q.t);
  const n = inner.length, m = outer.length;
  const ang = (list, k) => list[k % list.length].t + Math.floor(k / list.length) * 2 * Math.PI;
  let i = 0, j = 0;
  while (j < m && outer[j].t < inner[0].t) j++; // start the border walk beside the first outline point
  const j0 = j;
  const tris = [];
  while (i < n || j - j0 < m) {
    const stepInner = j - j0 >= m || (i < n && ang(inner, i + 1) <= ang(outer, j + 1));
    if (stepInner) { tris.push([inner[i % n].i, inner[(i + 1) % n].i, outer[j % m].i]); i++; }
    else { tris.push([inner[i % n].i, outer[(j + 1) % m].i, outer[j % m].i]); j++; }
  }
  return tris;
}

// ---------- pixel helpers ----------

function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  const pass = (a, b, len, stride, lines, lineStride) => {
    for (let l = 0; l < lines; l++) {
      const o = l * lineStride;
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += a[o + Math.min(len - 1, Math.max(0, k)) * stride];
      for (let x = 0; x < len; x++) {
        b[o + x * stride] = sum / (2 * r + 1);
        sum += a[o + Math.min(len - 1, x + r + 1) * stride] - a[o + Math.max(0, x - r) * stride];
      }
    }
  };
  pass(src, tmp, w, 1, h, w);
  pass(tmp, out, h, w, w, 1);
  return out;
}

/** Near-Gaussian blur of a single-channel float image (three box passes). */
function blur(src, w, h, sigma) {
  const r = Math.max(1, Math.round(Math.sqrt((12 * sigma * sigma) / 3 + 1) / 2));
  return boxBlur(boxBlur(boxBlur(src, w, h, r), w, h, r), w, h, r);
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (lo, hi, x) => { const t = clamp01((x - lo) / (hi - lo)); return t * t * (3 - 2 * t); };

function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// ---------- WebGL warp ----------

class Warper {
  constructor(size) {
    this.size = size;
    this.canvas = makeCanvas(size);
    const gl = (this.gl = this.canvas.getContext('webgl', { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false }));
    if (!gl) throw new Error('WebGL is not available');
    const compile = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, 'attribute vec2 p;attribute vec2 t;varying vec2 v;void main(){v=t;gl_Position=vec4(p,0.,1.);}'));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, 'precision mediump float;varying vec2 v;uniform sampler2D s;void main(){gl_FragColor=texture2D(s,v);}'));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('Warp shader failed: ' + gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    this.aPos = gl.getAttribLocation(prog, 'p');
    this.aTex = gl.getAttribLocation(prog, 't');
    this.posBuf = gl.createBuffer();
    this.texBuf = gl.createBuffer();
    this.idxBuf = gl.createBuffer();
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    gl.viewport(0, 0, size, size);
  }

  /** Draw `source` so that its `src` points land on the `dst` points. Returns RGBA bytes, top row first. */
  warp(source, src, dst, tris) {
    const { gl, size } = this;
    const n = src.length / 2;
    const pos = new Float32Array(n * 2), uv = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      pos[2 * i] = (dst[2 * i] / size) * 2 - 1;
      pos[2 * i + 1] = (dst[2 * i + 1] / size) * 2 - 1; // drawn upside down so readPixels comes back top-first
      uv[2 * i] = src[2 * i] / size;
      uv[2 * i + 1] = src[2 * i + 1] / size;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.aPos); gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.texBuf); gl.bufferData(gl.ARRAY_BUFFER, uv, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.aTex); gl.vertexAttribPointer(this.aTex, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, tris, gl.DYNAMIC_DRAW);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawElements(gl.TRIANGLES, tris.length, gl.UNSIGNED_SHORT, 0);
    const out = new Uint8Array(size * size * 4);
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return out;
  }
}

// ---------- engine ----------

export async function createFaceEngine({ size = 512, wasm = 'vendor/mediapipe/wasm', models = 'models' } = {}) {
  const files = await FilesetResolver.forVisionTasks(wasm);
  const landmarker = await FaceLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: `${models}/face_landmarker.task`, delegate: 'CPU' },
    runningMode: 'IMAGE', numFaces: 5,
  });
  const segmenter = await ImageSegmenter.createFromOptions(files, {
    baseOptions: { modelAssetPath: `${models}/selfie_multiclass_256x256.tflite`, delegate: 'CPU' },
    runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false,
  });
  const warper = new Warper(size);
  const mesh = buildMesh();
  const border = borderPoints(size);
  const lips = [...new Set(FaceLandmarker.FACE_LANDMARKS_LIPS.flatMap((c) => [c.start, c.end]))];

  const withBorder = (pts2) => { const out = new Float32Array(pts2.length + border.length); out.set(pts2); out.set(border, pts2.length); return out; };
  const triangulate = (shape2) => new Uint16Array([...mesh.tris, ...ringTriangles(shape2, mesh.outline, border)].flat());

  /** Landmarks of the largest face on a canvas, as x,y,z pixels. Null when there is none. */
  function detect(canvas) {
    const found = landmarker.detect(canvas);
    let best = null, bestD = 0;
    for (const lm of found.faceLandmarks || []) {
      const d = Math.hypot((lm[L_EYE].x - lm[R_EYE].x) * canvas.width, (lm[L_EYE].y - lm[R_EYE].y) * canvas.height);
      if (d > bestD) { bestD = d; best = lm; }
    }
    if (!best) return null;
    const p3 = new Float32Array(N * 3);
    best.forEach((p, i) => { p3[3 * i] = p.x * canvas.width; p3[3 * i + 1] = p.y * canvas.height; p3[3 * i + 2] = p.z * canvas.width; });
    return p3;
  }

  /**
   * Find the main face in an image, video frame or canvas and re-frame it: eyes level, at a
   * fixed place and size. Returns null when there is no face or it is too small to use.
   */
  function analyze(source) {
    const sw = source.videoWidth || source.naturalWidth || source.width;
    const sh = source.videoHeight || source.naturalHeight || source.height;
    const f = Math.min(1, 1024 / Math.max(sw, sh));
    const look = makeCanvas(Math.round(sw * f), Math.round(sh * f));
    look.getContext('2d').drawImage(source, 0, 0, look.width, look.height);
    const first = detect(look);
    if (!first) return null;

    // Where the eyes are in the original picture, and how big and tilted the face is.
    const r = [first[3 * R_EYE] / f, first[3 * R_EYE + 1] / f, first[3 * R_EYE + 2] / f];
    const l = [first[3 * L_EYE] / f, first[3 * L_EYE + 1] / f, first[3 * L_EYE + 2] / f];
    const eyeDist = Math.hypot(l[0] - r[0], l[1] - r[1], l[2] - r[2]); // 3D, so a turned head isn't read as a small one
    let scale = (EYE_DIST * size) / eyeDist;
    if (scale > MAX_UPSCALE) return null;
    const roll = Math.atan2(l[1] - r[1], l[0] - r[0]);
    const mx = (r[0] + l[0]) / 2, my = (r[1] + l[1]) / 2;

    const canvas = makeCanvas(size);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    if (Math.abs(roll) < MAX_LEVEL_ROLL) {
      // Nearly level head: take a plain square crop, kept inside the photo so no empty border
      // appears. A face that fills the photo simply stays large; the 3D alignment in blend()
      // copes with the size difference.
      const side = Math.min(size / scale, sw, sh);
      const x0 = Math.min(Math.max(mx - side / 2, 0), sw - side);
      const y0 = Math.min(Math.max(my - EYE_Y * side, 0), sh - side);
      ctx.drawImage(source, x0, y0, side, side, 0, 0, size, size);
    } else {
      // Tilted head: rotate it level. Corners pulled in from beyond the photo get its average tone.
      scale = Math.max(scale, size / Math.min(sw, sh));
      const tiny = makeCanvas(1);
      tiny.getContext('2d').drawImage(look, 0, 0, 1, 1);
      const [ar, ag, ab] = tiny.getContext('2d').getImageData(0, 0, 1, 1).data;
      ctx.fillStyle = `rgb(${ar},${ag},${ab})`;
      ctx.fillRect(0, 0, size, size);
      ctx.translate(size / 2, EYE_Y * size);
      ctx.rotate(-roll);
      ctx.scale(scale, scale);
      ctx.translate(-mx, -my);
      ctx.drawImage(source, 0, 0, sw, sh);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    const p3 = detect(canvas);
    if (!p3) return null;

    // Face-skin probability, stored as a grey image so it can be warped like a photo.
    const seg = segmenter.segment(canvas);
    const m = seg.confidenceMasks[FACE_SKIN];
    const prob = m.getAsFloat32Array();
    const small = makeCanvas(m.width, m.height);
    const id = new ImageData(m.width, m.height);
    for (let i = 0; i < prob.length; i++) { const v = prob[i] * 255; id.data[4 * i] = id.data[4 * i + 1] = id.data[4 * i + 2] = v; id.data[4 * i + 3] = 255; }
    small.getContext('2d').putImageData(id, 0, 0);
    seg.close();
    const skin = makeCanvas(size);
    skin.getContext('2d').drawImage(small, 0, 0, size, size);
    return { canvas, p3, skin };
  }

  /** Soft mask over the face outline, pulled in from the edge. */
  function outlineMask(shape2) {
    const c = makeCanvas(size), ctx = c.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#fff'; ctx.beginPath();
    mesh.outline.forEach((i, k) => (k ? ctx.lineTo(shape2[2 * i], shape2[2 * i + 1]) : ctx.moveTo(shape2[2 * i], shape2[2 * i + 1])));
    ctx.closePath(); ctx.fill();
    const d = ctx.getImageData(0, 0, size, size).data;
    const m = new Float32Array(size * size);
    for (let i = 0; i < m.length; i++) m[i] = d[4 * i] / 255;
    const soft = blur(m, size, size, size * 0.035);
    for (let i = 0; i < soft.length; i++) soft[i] = smoothstep(0.55, 1.0, soft[i]);
    return soft;
  }

  /**
   * Blend two analysed faces. The host keeps its hair, head, background and head angle; the face
   * is a mix of both. `strength` pushes the mixed shape away from the collective mean
   * (1 = plain mix). `hostShare` is how much of the face is the host's (0.5 = half).
   * The guest and the mean are turned in 3D to the host's head angle first.
   */
  function blend(host, guest, collectiveShape, { strength = DEFAULT_STRENGTH, hostShare = 0.5 } = {}) {
    const guestShare = 1 - hostShare;
    const a = host.p3;
    const b = move3(align3(guest.p3, a), guest.p3);
    const mid = mix(a, b, guestShare);
    // An open mouth is an expression, not a face shape. When one mouth is open and the other
    // shut, keep the host's mouth position and ease back to the normal 50/50 mix around it.
    const eye = Math.hypot(a[3 * L_EYE] - a[3 * R_EYE], a[3 * L_EYE + 1] - a[3 * R_EYE + 1], a[3 * L_EYE + 2] - a[3 * R_EYE + 2]);
    const gap = (p) => Math.hypot(p[3 * LIP_TOP] - p[3 * LIP_BOTTOM], p[3 * LIP_TOP + 1] - p[3 * LIP_BOTTOM + 1]) / eye;
    if (Math.abs(gap(a) - gap(b)) > MOUTH_MISMATCH) {
      const reach = 0.3 * eye;
      for (let i = 0; i < N; i++) {
        let near = Infinity;
        for (const j of lips) near = Math.min(near, Math.hypot(a[3 * i] - a[3 * j], a[3 * i + 1] - a[3 * j + 1]));
        const w = guestShare * smoothstep(0, reach, near); // share taken from the guest: 0 at the lips
        for (let c = 0; c < 3; c++) mid[3 * i + c] = a[3 * i + c] + (b[3 * i + c] - a[3 * i + c]) * w;
      }
    }
    let shape = mid;
    if (collectiveShape && strength !== 1) {
      const mean = move3(align3(collectiveShape, mid), collectiveShape);
      shape = mix(mean, mid, strength);
      // Soft cap on how far any one point is pushed. Identity differences are small and pass
      // through; a big difference in expression (one mouth open, one shut) would otherwise be
      // tripled and tear the mouth.
      const cap = MAX_PUSH * Math.hypot(a[3 * L_EYE] - a[3 * R_EYE], a[3 * L_EYE + 1] - a[3 * R_EYE + 1], a[3 * L_EYE + 2] - a[3 * R_EYE + 2]);
      for (let i = 0; i < shape.length; i += 3) {
        const dx = shape[i] - mid[i], dy = shape[i + 1] - mid[i + 1], dz = shape[i + 2] - mid[i + 2];
        const d = Math.hypot(dx, dy, dz);
        if (d > 1e-6) {
          const k = (cap * Math.tanh(d / cap)) / d;
          shape[i] = mid[i] + dx * k; shape[i + 1] = mid[i + 1] + dy * k; shape[i + 2] = mid[i + 2] + dz * k;
        }
      }
    }
    const shape2 = xy(shape);
    const tris = triangulate(xy(mid));
    const dst = withBorder(shape2);
    const srcA = withBorder(xy(a)), srcB = withBorder(xy(guest.p3));
    const wa = warper.warp(host.canvas, srcA, dst, tris);
    const wb = warper.warp(guest.canvas, srcB, dst, tris);
    const sa = warper.warp(host.skin, srcA, dst, tris);
    const sb = warper.warp(guest.skin, srcB, dst, tris);

    const px = size * size;
    // Mix only where BOTH faces show skin, so a fringe or long hair is never blended in.
    let both = new Float32Array(px);
    for (let i = 0; i < px; i++) both[i] = Math.min(sa[4 * i], sb[4 * i]) / 255;
    both = blur(both, size, size, 3);
    for (let i = 0; i < px; i++) both[i] = clamp01((both[i] - 0.7) * 4 + 0.5);
    both = blur(both, size, size, 5);
    const mask = outlineMask(shape2);
    for (let i = 0; i < px; i++) mask[i] *= both[i];

    const out = new ImageData(size, size);
    const chan = new Float32Array(px);
    let wsum = 0;
    for (let i = 0; i < px; i++) wsum += mask[i];
    wsum = Math.max(wsum, 1e-6);
    for (let c = 0; c < 3; c++) {
      // Match the guest's brightness and contrast to the host's inside the mask.
      let ma = 0, mb = 0;
      for (let i = 0; i < px; i++) { ma += wa[4 * i + c] * mask[i]; mb += wb[4 * i + c] * mask[i]; }
      ma /= wsum; mb /= wsum;
      let va = 0, vb = 0;
      for (let i = 0; i < px; i++) { va += (wa[4 * i + c] - ma) ** 2 * mask[i]; vb += (wb[4 * i + c] - mb) ** 2 * mask[i]; }
      const gain = Math.sqrt(va / wsum) / (Math.sqrt(vb / wsum) + 1e-6);
      for (let i = 0; i < px; i++) chan[i] = wa[4 * i + c] * hostShare + ((wb[4 * i + c] - mb) * gain + ma) * guestShare;
      // Averaging two faces softens fine detail; put some of it back.
      const soft = blur(chan, size, size, 1.2);
      for (let i = 0; i < px; i++) {
        const face = chan[i] + 0.6 * (chan[i] - soft[i]);
        out.data[4 * i + c] = wa[4 * i + c] * (1 - mask[i]) + face * mask[i];
      }
    }
    for (let i = 0; i < px; i++) out.data[4 * i + 3] = 255;
    const canvas = makeCanvas(size);
    canvas.getContext('2d').putImageData(out, 0, 0);
    return { canvas, p3: shape };
  }

  /**
   * A running average of many faces. Each face is flattened onto one fixed template shape,
   * so adding a face is a single step and the faces themselves need not be kept.
   */
  function createCollective(template) {
    const template2 = withBorder(xy(template));
    const tris = triangulate(xy(template));
    const shapeSum = new Float32Array(template.length);
    const texSum = new Float32Array(size * size * 3);
    let count = 0;
    return {
      get count() { return count; },
      add(face) {
        const al = move3(align3(face.p3, template), face.p3);
        for (let i = 0; i < al.length; i++) shapeSum[i] += al[i];
        const w = warper.warp(face.canvas, withBorder(xy(face.p3)), template2, tris);
        for (let i = 0, j = 0; i < w.length; i += 4, j += 3) { texSum[j] += w[i]; texSum[j + 1] += w[i + 1]; texSum[j + 2] += w[i + 2]; }
        count++;
      },
      /** The average shape so far (the template until a face has been added). */
      shape() {
        if (!count) return template;
        const s = new Float32Array(shapeSum.length);
        for (let i = 0; i < s.length; i++) s[i] = shapeSum[i] / count;
        return s;
      },
      /** The collective face as a picture. */
      render() {
        const flat = makeCanvas(size);
        const id = new ImageData(size, size);
        const n = Math.max(count, 1);
        for (let i = 0, j = 0; i < id.data.length; i += 4, j += 3) { id.data[i] = texSum[j] / n; id.data[i + 1] = texSum[j + 1] / n; id.data[i + 2] = texSum[j + 2] / n; id.data[i + 3] = 255; }
        flat.getContext('2d').putImageData(id, 0, 0);
        const out = makeCanvas(size);
        const w = warper.warp(flat, template2, withBorder(xy(this.shape())), tris);
        out.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(w.buffer), size, size), 0, 0);
        return out;
      },
    };
  }

  /**
   * Flatten a face onto the template: a "tile" picture in which every face's features sit on
   * the same pixels, plus the face's own shape turned to the template's angle. Two tiles can be
   * cross-faded without ghosting, which is what makes a cheap, clean morph possible.
   */
  function flatten(face, template) {
    const w = warper.warp(face.canvas, withBorder(xy(face.p3)), withBorder(xy(template)), triangulate(xy(template)));
    const tile = makeCanvas(size);
    tile.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(w.buffer), size, size), 0, 0);
    return { tile, shape: move3(align3(face.p3, template), face.p3) };
  }

  /**
   * Draws a continuous morph between flattened faces on `canvas`. Each frame is one GPU draw:
   * the mesh slides from one face's shape to the next while the two tiles cross-fade.
   */
  function createMorphPlayer(canvas, template, { vignette = true } = {}) {
    const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, antialias: true });
    if (!gl) throw new Error('WebGL is not available');
    const compile = (type, src) => { const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh); return sh; };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER,
      'precision mediump float;attribute vec2 a;attribute vec2 b;attribute vec2 t;uniform float k;varying vec2 v;' +
      'void main(){v=t;vec2 p=mix(a,b,k);gl_Position=vec4(p.x*2.-1.,1.-p.y*2.,0.,1.);}'));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER,
      'precision mediump float;varying vec2 v;uniform sampler2D A;uniform sampler2D B;uniform float k;uniform vec4 oval;uniform float vig;' +
      'void main(){vec3 c=mix(texture2D(A,v).rgb,texture2D(B,v).rgb,k);float d=length((v-oval.xy)/oval.zw);' +
      'gl_FragColor=vec4(c*(1.-vig*smoothstep(0.92,1.3,d)),1.);}'));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('Morph shader failed: ' + gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const loc = (n) => gl.getAttribLocation(prog, n), uni = (n) => gl.getUniformLocation(prog, n);
    const norm = (pts2) => pts2.map((v) => v / size);
    const template2 = withBorder(xy(template));
    const tris = triangulate(xy(template));
    const buffer = (name, data) => {
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(loc(name)); gl.vertexAttribPointer(loc(name), 2, gl.FLOAT, false, 0, 0);
      return buf;
    };
    buffer('t', norm(template2));
    const bufA = buffer('a', norm(template2)), bufB = buffer('b', norm(template2));
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, tris, gl.STATIC_DRAW);
    // Soft oval around the head so hair and background fall away to black.
    let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
    for (const i of mesh.outline) { const x = template[3 * i] / size, y = template[3 * i + 1] / size; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    gl.uniform4f(uni('oval'), (x0 + x1) / 2, (y0 + y1) / 2 - 0.03, (x1 - x0) * 0.62, (y1 - y0) * 0.62);
    gl.uniform1f(uni('vig'), vignette ? 1 : 0);
    gl.uniform1i(uni('A'), 0); gl.uniform1i(uni('B'), 1);
    const textures = new Map(); // one GPU texture per flattened face, made on first use
    const textureFor = (flat) => {
      if (!textures.has(flat)) {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        for (const [key, val] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, key, val);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, flat.tile);
        textures.set(flat, tex);
      }
      return textures.get(flat);
    };
    let bound = [null, null];
    /** Draw the face that is `k` of the way from flattened face `from` to `to` (0..1). */
    function draw(from, to, k) {
      if (bound[0] !== from || bound[1] !== to) {
        gl.bindBuffer(gl.ARRAY_BUFFER, bufA); gl.bufferData(gl.ARRAY_BUFFER, norm(withBorder(xy(from.shape))), gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, bufB); gl.bufferData(gl.ARRAY_BUFFER, norm(withBorder(xy(to.shape))), gl.DYNAMIC_DRAW);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, textureFor(from));
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, textureFor(to));
        bound = [from, to];
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform1f(uni('k'), k);
      gl.drawElements(gl.TRIANGLES, tris.length, gl.UNSIGNED_SHORT, 0);
    }
    /** Morph endlessly through `faces` (an array that may keep growing), in random order. */
    function play(faces, { seconds = 1.8 } = {}) {
      let from = null, to = null, start = 0, running = true;
      const pick = () => { let f; do { f = faces[Math.floor(Math.random() * faces.length)]; } while (faces.length > 1 && f === to); return f; };
      const frame = (now) => {
        if (!running) return;
        if (faces.length) {
          if (!to) { from = pick(); to = pick(); start = now; }
          let k = (now - start) / (seconds * 1000);
          if (k >= 1) { from = to; to = pick(); start = now; k = 0; }
          draw(from, to, k * k * (3 - 2 * k)); // ease in and out, never resting on one face for long
        }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      return () => { running = false; };
    }
    /** Free the GPU texture of a face that has left the playlist. */
    function release(flat) {
      const tex = textures.get(flat);
      if (tex && bound[0] !== flat && bound[1] !== flat) { gl.deleteTexture(tex); textures.delete(flat); }
    }
    /** Free every GPU texture (used after one-off frames). */
    function clear() {
      for (const tex of textures.values()) gl.deleteTexture(tex);
      textures.clear(); bound = [null, null];
    }
    return { canvas, draw, play, release, clear };
  }

  // Off-screen morph players used to render single frames (grid combinations, saved artifacts).
  const offscreen = new Map();
  function frame(template, from, to, k) {
    if (!offscreen.has(template)) offscreen.set(template, createMorphPlayer(makeCanvas(size), template, { vignette: true }));
    const player = offscreen.get(template);
    player.draw(from, to, k);
    const out = makeCanvas(size);
    out.getContext('2d').drawImage(player.canvas, 0, 0);
    player.clear();
    return out;
  }

  /**
   * A new face made from two stored faces, `k` of the way from one to the other, ready to be
   * used as the guest in blend(). Its shape is known exactly, so nothing has to be re-detected.
   */
  function comboFace(flatA, flatB, k, template) {
    const p3 = mix(flatA.shape, flatB.shape, k);
    const skin = makeCanvas(size), ctx = skin.getContext('2d');
    const s2 = xy(p3);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#fff'; ctx.beginPath();
    mesh.outline.forEach((i, n) => (n ? ctx.lineTo(s2[2 * i], s2[2 * i + 1]) : ctx.moveTo(s2[2 * i], s2[2 * i + 1])));
    ctx.closePath(); ctx.fill();
    return { canvas: frame(template, flatA, flatB, k), p3, skin };
  }

  /**
   * The artifact that is kept: the flattened face inside a soft oval on black. Hair, clothes
   * and background from the original photo fall outside the oval and are not in the picture.
   */
  function ovalTile(flat, template) {
    const still = { tile: flat.tile, shape: template };
    return { tile: frame(template, still, still, 0), shape: flat.shape };
  }

  /** Template shape for a collective: the mean of some starting faces, facing the camera. */
  const templateFrom = (faces) => meanShape(faces.map((f) => f.p3), size);

  return { size, analyze, blend, createCollective, templateFrom, flatten, createMorphPlayer, comboFace, ovalTile };
}
