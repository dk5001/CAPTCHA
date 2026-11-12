# CAPTCHA 2.0 / Evolving Portrait

Live site: [evolvingportrait.me](https://evolvingportrait.me)

An interactive portrait piece dressed up as a CAPTCHA. The aim is one collective face, built from real people's faces without keeping any real person's face. A visitor ticks "Want to see your face?" and picks one face from a 3×3 grid that resonates with them. The camera takes their picture, their face is blended with the face they chose, and only the blended artifact is kept. It joins the pool that the next visitor's choices are made from, so over time the faces stop being anyone in particular and become a record of everyone who took part.

In V1 the visitor also completed the sentence "I imagine myself as a ___"; V2 drops that step.

Every result is saved to a Supabase project, `evolving-portrait-archive`: the picture goes into the `faces` storage bucket, and a row with its link, the typed answer and the time goes into the `generations` table. `archive.html` shows that archive as a wall of faces.

## Branches

| Branch | What it is |
|---|---|
| `main`, `mobile-testing` | Version 1. The page sends both faces to a ComfyUI server (Stable Diffusion) reached through a Cloudflare tunnel, set in `config.js`. |
| `V2` | Version 2, in progress, branched from `mobile-testing`. The blend runs in the browser with no ComfyUI, aimed at a standalone iPad. |

## What changes in V2

**Status: working on a Mac, not yet tried on an iPad, not yet deployed.** The visitor page (`index.html`) now blends with the new face engine and no longer calls ComfyUI. The whole flow has been run in headless Chrome with a fake camera; archive writes were blocked during that test, so no V2 result has been saved to the live archive yet. See `HANDOFF.md` for the full context and what is left.

| | V1 | V2 (this branch) |
|---|---|---|
| Where the blend runs | A ComfyUI server with Stable Diffusion, reached over a tunnel | The browser alone; target is an iPad |
| How two faces are blended | Both images are mixed 50/50 inside Stable Diffusion and redrawn | Both faces are aligned feature to feature (eyes on eyes, mouth on mouth), warped to a shared shape, and then mixed |
| The typed answer | Used as the prompt that redraws the image | Removed; the flow is tick, choose, look |
| The nine squares | Recent results and seed faces | Fresh combinations of two stored faces each |
| What is kept | The whole generated picture | Only the blended face inside an oval, a third of it the visitor's; the camera photo never leaves the device |
| The look | A newly painted scene | A photographic face that belongs to nobody, with its proportions pushed past normal so it reads as real but wrong |
| Hair and background | Redrawn | Taken from the visitor's own photo, so there is no double-exposure ghosting |
| Collective face | Not built | A continuous morph through the faces in the archive, shown on the opening screen |
| Wait time | Up to two minutes per visitor | About 50 ms per blend on a Mac (iPad not yet measured) |
| Archive | Supabase | The same Supabase table and bucket, plus a small face tile per face for the morph |

### How the V2 blend works

1. **Find the face.** A face tracker (MediaPipe Face Landmarker, 478 points with depth) finds the same points on every face. If a picture has several people, the largest face is used.
2. **Re-frame it.** Faces arrive at any size, position and tilt, and archive pictures are crowded scenes. Each picture is re-cropped around the face, with the eyes at a fixed place and size where the photo allows, and a tilted head is rotated level. The crop stays inside the photo, so no empty border appears. Faces too small to enlarge cleanly are skipped.
3. **Match the head angle.** The chosen face's points are rotated in 3D to the visitor's head angle before the two shapes are compared, so a turned or tilted head is not mistaken for a narrower or shorter face. Steps 2 and 3 are what stop a blend from being squashed when the two faces sit differently in their pictures.
4. **Warp and mix.** Both faces are warped onto one shared shape using the tracker's own triangle mesh, and mixed only where both show skin, so fringes and hairstyles don't bleed across.
5. **Keep expressions out of it.** If one mouth is open and the other shut, the visitor's own mouth position is kept, so a laugh is not blended in as a face shape.
6. **Exaggerate.** The blended shape is compared with the collective average face, and the difference is multiplied. 100% is the plain blend, 200% to 400% is uncanny, and around 800% the image starts to tear. The default is 300% (`DEFAULT_STRENGTH` in `src/face-engine.js`), with a soft cap on how far any single point can be pushed.

The idea of exaggerating the difference from an average comes from face-perception research on averaged faces (Journal of Experimental Psychology: Human Perception and Performance, 33(6), 2007).

### The collective face

A plain average of every face looks smoothed out, so the collective face is shown as a continuous morph through individual faces instead.

- Each face is flattened once into a "tile": a picture in which everyone's features sit on the same pixels, on a fixed template shape (`src/face-template.js`). Its 478 points are saved alongside.
- A morph is one GPU draw per frame: the mesh slides from one face's shape to the next while their two tiles cross-fade. Only two faces are on screen at a time, so it stays sharp.
- The page keeps about 40 faces in memory and swaps one for another every 12 seconds, so over time it passes through the whole archive without loading it all.
- Tiles live in the `faces` bucket under `tiles/img/` and `tiles/pts/`. The 250 V1 pictures were processed once: 236 gave a usable face and have tiles; 14 had no usable face.
- The mean shape of the faces in memory is the reference that the 300% exaggeration pushes away from.

The plain averaged face is still available in `lab.html` for comparison.

### Still to build

- Try it on a real iPad: camera, speed, layout.
- Offline use and install-to-home-screen. The page still needs the network for the archive and for the QR code image on the receipt.
- A reveal animation on the processing screen. The blend is nearly instant, so the screen is currently just held for 2.5 seconds.
- Remove the leftover V1 files and code once V2 is accepted (see `HANDOFF.md`).
- Merge and deploy. The live site still serves V1.

## Trying the V2 engine

The page loads its code as modules, so it needs a web server; opening the file directly will not work.

```bash
python3 -m http.server 5800
```

Then open `http://localhost:5800/` for the visitor page, or `http://localhost:5800/lab.html` for the test page. It blends pairs of seed faces, including one deliberately small, off-centre and tilted face and one face from the archive, and builds the collective face from the 60 newest archive pictures. Add `?n=250` to the address to use more of the archive. The slider sets the exaggeration strength.

| Path | What it is |
|---|---|
| `src/face-engine.js` | The V2 face engine: face tracking, re-framing, WebGL warp, hair-aware blend, collective face |
| `src/archive.js` | Reads and writes the Supabase archive, including face tiles |
| `src/app.js` | Connects the visitor page to the engine and runs the morphing collective face |
| `src/face-template.js` | The fixed template shape that saved tiles depend on. Do not regenerate. |
| `lab.html` | Test page for the engine |
| `HANDOFF.md` | What was asked for in V2, the design, the current state and what is left |
| `vendor/mediapipe/` | Google's MediaPipe vision library (0.10.14), kept in the repo so the piece runs offline |
| `models/` | The face tracker and hair/skin segmentation models |
| `index.html` | The visitor page, now using the V2 engine |
| `sketch.js`, `p5.comfyui-helper.js`, `*.json` workflows, `prompt_server.py` | V1 leftovers, no longer loaded by the page |
| `archive.html` | The archive wall: the collective face in the centre, stored faces around it |
| `display.html` | V1's latest-face display, unchanged |
| `src/hidden-tiles.js` | Stored faces left out of the squares, the morph and the wall |
| `config.js` | ComfyUI tunnel address and the Supabase address and public key |
