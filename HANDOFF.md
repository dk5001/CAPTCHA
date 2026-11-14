# Evolving Portrait V2: handoff

Written 12 November 2026. For anyone (person or agent) picking this work up cold. `README.md` describes the project and how the blend works; this file covers what was asked for, why it was built this way, where it stands, and what is left.

## Latest rounds (read this first: it overrides anything older above that disagrees)

Requests from DJ after the first push of V2, and what was built:

- **Result screen is a before/after diagram.** The visitor's own capture on the left, the face they chose on the right, dotted pulsing lines flowing into a large centre face that keeps turning between before (the visitor) and after (the blend). On narrow screens the two sources sit on top and one line flows down. Built in `createReceiptInterface` in `index.html`; the loop is `reveal()` in `src/app.js`.
- **Copy.** Opening screen: "EVOLVING PORTRAIT keeps the digital artifact of your face". Result screen: "Thank you for contributing to EVOLVING PORTRAIT". The older privacy sentences were removed at DJ's request.
- **QR code opens `face.html?id=<session>`**: only that visitor's saved face, the thank-you line, number and date, and a link to DJ's project page (https://fl4me.mov/work/evolving-portrait/). It needs the site to be live on the production domain.
- **Archive wall is radial** (`archive.html`): the collective face in the middle, stored faces in rings around it, each a fixed-size square placed by pixels so nothing can be squashed. Rings run past the screen edges and are cropped there, on purpose. All faces the same size and brightness.
- **Opening face is larger**: its visible oval is about as wide as the "Want to see your face?" box.
- **The blend no longer squeezes the face.** In `blend()` (`src/face-engine.js`) the host's face outline stays where it is; only points inside it (eyes, brows, nose, lips) take the guest's shape and the exaggeration. `FEATURE_INSET` is how far in from the outline the guest takes full effect. `outlineShare` (0 to 1) brings the old whole-face behaviour back.
- **Debug panel (press D on the visitor page).** Sliders for Distortion (`strength`), Mix (`hostShare`), Head shape from chosen face (`outlineShare`) and Morph speed (`morphSpeed`), each with a round "i" explanation. On the result screen a slider change re-blends the last capture as a preview only; the saved face never changes. "Save as default" stores the values in that browser (`localStorage` key `ep-defaults`); "Reset" returns to them; "Original values" clears them. Defaults in code: 300%, visitor one third, outline 0, speed 100%.
- **One morph speed everywhere.** A turn from face to face takes 3.8 s at 100% on the opening screen, the result screen and the wall's centre face. The wall reads the saved `morphSpeed` from the same browser.

- **`face.html` morphs.** The saved face turns into each of the stored faces it was made from (its `parents`) and back; if none load, into a few archive faces. Tapping the face pauses it: it settles back on the saved face. A thin ring around the face breathes and ripples while morphing and is still and dim when paused.
- **The morph player is separate from the engine.** `createMorphPlayer` is exported from `src/face-engine.js` and needs no models, so `archive.html` and `face.html` no longer download MediaPipe.

Still not done: a test on a real phone or iPad, the items under "What is left", and removing leftover V1 code in `index.html`.

## Where things are

- **Working copy:** `~/VSCode/CAPTCHA`, branch `V2`, cut from `mobile-testing`. Nothing on `V2` is committed yet.
- **Do not use `~/CAPTCHA`.** It is an older clone on an outdated `main` with a stale `V2` branch from the first hours of this work. It can be deleted.
- **Live site:** evolvingportrait.me still serves V1.
- **Supabase project:** `evolving-portrait-archive`. Address and public key are in `config.js`.

## What DJ asked for

In the order the requests came:

1. **Run without ComfyUI**, ideally standalone on an iPad.
2. **Blend two people by their similarities**, with no ComfyUI in the loop.
3. **A single collective face** that represents the whole database. This had never been built.
4. **The typed answer no longer needs to change the image.** DJ agreed to give this up.
5. **Faces must blend every time a new visitor takes part, and the result must be a realistic face.** Not an overlay, not a blur, not one picture dimmed over another.
6. **The look: photorealistic but uncanny and unnerving.** The reference was a Threads post walking through a 2007 face-perception study: averaged faces whose difference from the average is pushed to 200% and then 600%.
7. **Learn from the repo `sirioberati/gradient-descent-for-a-face`** and apply what fits.
8. **Keep the work on a branch called `V2`**, with a README describing the project and what changed.
9. **Use the existing Supabase archive.** Build the collective face from the faces already in it, and save V2 results into the same table and bucket as V1.
10. **Exaggeration strength "something between" 200% and 400%.** Set to 300%.
11. **Adapt to faces that sit differently in their pictures.** DJ saw blends get squashed when the two faces had different offsets.
12. **The averaged collective face looked too smoothed.** DJ asked for a GIF-like morph that shuffles through many faces seamlessly, looks legitimate, and runs efficiently without loading the entire database.
13. **This handoff file.**
14. **Privacy is the point of the piece.** The database must hold digital artifacts that result from blended faces, never real people's faces. DJ approved storing only the face oval and cutting each visitor's share to a third.
15. **No question box.** The blend is fast, so the interaction should be quick.
16. **A public web version** that anyone in the world can contribute to, built to grow the database quickly and, eventually, to put more emphasis on the single collective face.
17. **The nine squares should show different combinations of the stored faces**, and the visitor still picks one.
18. **Keep all data. Never limit or delete anything without being asked.** The 250-row cap on `generations` (a trigger that deleted the oldest rows and pictures) was removed at DJ's instruction on 12 Nov 2026.
19. **One face, not three panels.** After the capture, a single face slowly morphs from the visitor into the blended face, and that is the final screen (it replaces the receipt).
20. **Faces float on black.** DJ likes the vignette. No borders or frames on any face, in the nine squares or on the archive wall; the captured face also has no background.

## The design, and why

### One representation for everything

Every face is reduced to two things: 478 points with depth (MediaPipe Face Landmarker) and its pixels. Blending two people, exaggerating a blend, averaging everyone and morphing between faces are all operations on those two things. No image-generating model is involved, which is what makes requests 1 and 2 possible on an iPad.

### Realistic, not an overlay (request 5)

- Both faces are warped onto a shared shape before any pixels are mixed, so eyes land on eyes and mouths on mouths.
- Hair, head and background come only from the visitor's photo. Mixing is limited to where both faces show skin (a hair/skin segmentation model), so fringes and long hair never ghost in.
- The chosen face's brightness and contrast are matched to the visitor's, and a little sharpening restores detail lost in averaging.

### Uncanny (requests 6 and 10)

The blended shape is compared with the collective mean shape and the difference is multiplied by 3. The pixels stay photographic while the proportions drift. About 800% tears the image, so 300% leaves headroom. There is a soft cap on how far any one point may move.

### Faces that sit differently (request 11)

Two separate causes, two fixes:

- **Framing.** Archive pictures are 1024-pixel scenes with small, off-centre faces and often several people. `analyze()` picks the largest face and re-crops around it.
- **Head angle.** Shapes are aligned in 3D, so a turned or tilted head is rotated to match the other before comparison. In 2D a turned head looks like a narrow face, and the exaggeration then tripled that error. This was the squash.

A third case appeared in testing: one mouth open, one shut. That is an expression, not a face shape, so the visitor's mouth position is kept.

### The collective face as a morph (requests 3 and 12)

- A plain average of 38 archive faces was recognisable but blurry, because the faces are small in their pictures.
- Instead, each face is flattened once into a tile on a fixed template shape. Because features line up across tiles, two tiles can be cross-faded without ghosting.
- The morph is one GPU draw per frame. About 40 faces are held in memory and one is swapped every 12 seconds, so it eventually passes through everyone.
- The mean shape of the faces in memory doubles as the reference for the exaggeration.

### What came from the gradient-descent repo (request 7)

That repo rebuilds one photo from tens of thousands of colour blobs trained for about an hour. It cannot invent or blend faces, so it is not the blending system. Ideas taken or parked:

- **Taken:** replaying a precomputed result cheaply in WebGL, which is the shape of the morph player.
- **Parked:** a reveal on the processing screen where the result assembles out of noise as blobs. It would be an animation of the finished blend, not real training, and should be described that way.
- **Parked:** a slow 3D turn or a gaze that follows the viewer. The face points already carry depth, so no extra depth model is needed.

### Privacy model (request 14)

- The camera photo is analysed in the browser and never uploaded.
- The visitor sees a full picture with their own hair and background. That picture is shown once on the receipt and is not saved, pooled or broadcast.
- What is saved is the artifact: the blended face inside a soft oval on black (`engine.ovalTile`), plus its points. Hair, clothes and background fall outside the oval.
- The face is one third the visitor's (`HOST_SHARE` in `src/app.js`) and two thirds the combination they chose, then pushed 300% away from the collective mean.
- Each artifact records the two stored faces behind the combination it came from (`parents` in its points file), which gives every face a lineage.
- Not yet done: a consent screen suitable for a worldwide launch, a way for someone to remove their artifact, and legal review. Face-geometry processing is regulated in some places even when it happens on the device.

### The quick flow (requests 15 and 17)

Tick the box, pick one of nine squares, three-second countdown with the camera, blend, receipt. The question step is gone; its markup and handler are still in `index.html` but nothing leads to them. Each square is a fresh combination of two stored faces (`makeCombos` in `src/app.js`, `engine.comboFace`), rebuilt on every shuffle.

## Supabase

State after the lock-down on 12 November 2026:

- **`faces` bucket (public).** Anyone with the public key can read, list and add new files. Overwriting and deleting are refused. Tested with the public key: a new upload works with and without the "overwrite if exists" flag that both the V1 and V2 pages send, an overwrite is refused, a delete is refused. Two tiny test files remain under `_lockdown_test/`.
- **`generations` table.** One row per result, public read and insert. Its 250-row cap was removed, so nothing is deleted any more. A few of the oldest V1 rows and pictures were deleted by that cap during early V2 test runs, before it was removed; they cannot be restored.
- **`face_index` table (new).** One row per stored face tile: `session_id`, `created_at`, `parents`, `hidden`, `engine_version`. Public read of rows that are not hidden; public insert of non-hidden rows whose id looks like `subject_<digits>`; no update or delete. Filled from the 239 tiles already in the bucket; 47 are marked hidden.
- **`random_faces(n)` function (new).** Returns up to `n` random visible face ids. The opening-screen morph, the nine squares and the archive wall all get their faces this way, so nothing lists the whole archive any more.
- **Hiding a face** is now a database change: set `hidden = true` on its row (only possible with admin access, for example the Supabase dashboard). `src/hidden-tiles.js` holds the same 47 ids as a second filter in the page.
- **Files per face:** `tiles/img/<session>.jpg` and `tiles/pts/<session>.json`, the latter as `{ v, size, points, parents }` with points as a flat list of x, y, z in tenths of a pixel, already turned to the template's angle.
- **Do not regenerate `src/face-template.js`.** Every saved tile is flattened onto that exact shape.
- **Still open to abuse:** anyone can add files and rows, at any rate. There is no rate limit and no check that an uploaded tile is really a face. Adding either needs a server-side step (a Supabase Edge Function in front of uploads).
- **Claude Code access:** the Supabase connector is registered for the `~/CAPTCHA` folder with write access, and `mcp__supabase__apply_migration` is on the allow list there.

## Current state

### Done and checked

- Face engine in the browser: about 45 to 50 ms per blend in Chrome on a Mac.
- Visitor page wired to the engine. A full run in headless Chrome with a fake camera went checkbox, grid, countdown, capture, question, blend, receipt.
- Morphing collective face on the opening screen, playing from saved tiles.
- Back-fill of the V1 archive.
- Offset test (a face shrunk, moved to a corner and tilted) gives the same blend as the centred original.
- Open-mouth test against the widest-open mouth in the 60 newest archive pictures gives a clean result.

### Not checked

- **Any real iPad or Safari.** Camera, speed, layout, WebGL limits and memory are all untested there.
- **A real save to the live archive from V2.** Test runs blocked every upload and insert on purpose. The first real visitor will be the first real write.
- **The morph in motion.** Only still frames were inspected.
- **Long sessions.** Tile swapping frees GPU textures, but hours of running have not been tried.

### Known rough edges

- **Result screen:** `EP.reveal()` in `src/app.js` plays the morph; `runV2Blend()` in `index.html` shows the closing text when it ends. V1's three-panel receipt code is still in `updateReceiptWithResults()` but is skipped. During the first second of the morph, a little of the visitor's hair and backdrop shows at the edge of the oval; a person cut-out would remove it completely.

- **47 poor V1 tiles are hidden** by `src/hidden-tiles.js` (double exposures, damaged, too dark, not faces, and one early full-frame test). They are skipped by the nine squares, the morph and the archive wall; nothing was deleted, and removing an id from the list brings a face back. The picks were Claude's judgment from contact sheets, so DJ may want to review them.

- The receipt still says "GENERATION RESULTS" and "Generated Image", and the processing screen is simply held for 2.5 seconds.
- If the chosen picture has no usable face, a random seed face is used silently.
- The grid still shows V1's scene-style pictures next to V2's portrait-style results.
- A tilted head that also fills the frame can pull in a flat-toned corner when rotated level.

## What is left

1. **Finish protecting the archive.** Upload-only rules and the `face_index` table are done. Rate limiting and a check that uploads are face tiles are not.
2. **Test on real phones** (Safari on iPhone, Chrome on Android). The page downloads about 30 MB of models on first load, which is too heavy for mobile data; the 16 MB hair/skin model is the first thing to shrink or replace. Offline use is no longer a goal.
2b. **Curate the V1 tiles** (see rough edges).
2c. **Consent, removal and legal review** (see the privacy model).
2d. **Archive wall: done in `archive.html`.** The collective face sits in a centre block, stored faces fill the grid around it, and the cell the centre is turning into lights up. New contributions are picked up every 30 seconds and shown in the centre next. It loads the whole face engine (about 30 MB of models) just to get the morph player; splitting the player into its own module would make the wall light.
3. **Processing-screen reveal** (see the parked ideas above).
4. **Clean out V1** once DJ accepts V2: `sketch.js`, `p5.comfyui-helper.js`, the workflow `.json` files, `prompt_server.py`, `test_server.py`, `libraries/`, the ComfyUI fallback inside `_doSync()` in `index.html`, and the ComfyUI settings in `config.js`. Check `display.html` and `archive.html` first; they were not changed.
5. **Commit, merge and deploy.** About 37 MB of MediaPipe library and models is included deliberately so the piece can run offline.
6. **Open questions for DJ:** tighten the storage policy? Show the visitor's result joining the morph on the receipt? Keep storing only the blended result (as now), or also the visitor's own face points?

## How to run and test

```bash
cd ~/VSCode/CAPTCHA
python3 -m http.server 5800
```

- `http://localhost:5800/` is the visitor page. **Completing a run there writes to the live archive.**
- `http://localhost:5800/lab.html` is the test page. It only reads.

The headless test scripts are in `_work/shot/` (gitignored, so they exist only on this Mac): `flow.mjs` drives the whole visitor flow with a fake camera and blocks archive writes, `shot.mjs` screenshots the lab page, and `run.mjs` evaluates a script in the page. They need `puppeteer-core` and the installed Google Chrome. The first Python proof of the blend is in `_work/proof/`.

## Map of the code

| File | Role |
|---|---|
| `src/face-engine.js` | `analyze` (find and re-frame a face), `blend`, `flatten` (make a tile), `createMorphPlayer`, `createCollective` (the plain average) |
| `src/archive.js` | Supabase reads and writes: generations, uploads, tiles |
| `src/app.js` | Exposes `window.EP` to `index.html`; loads the playlist and runs the morph |
| `src/face-template.js` | The fixed template shape |
| `index.html` | Visitor flow. The V2 entry point is `runV2Blend()` |
| `lab.html` | Test page |
| `vendor/mediapipe/`, `models/` | MediaPipe 0.10.14 and its two models, kept locally |
