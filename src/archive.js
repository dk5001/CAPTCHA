// Reads and writes the Supabase archive for Evolving Portrait V2.
//
// V1 already keeps one row per result in the `generations` table and the picture itself in the
// public `faces` storage bucket. V2 adds, per face, two small files in the same bucket:
//   tiles/img/<session>.jpg   the face flattened onto the fixed template (see face-template.js)
// and one row in the `face_index` table, which is how the site finds faces. The files are:
//   tiles/pts/<session>.json  its 478 points, already turned to the template's angle, and the
//                             session ids of the stored faces it was made from (its parents)
// The morphing collective face plays from these, so no picture has to be re-analysed on load.

const TILE_QUALITY = 0.85;

export function createArchive({ url, key, bucket = 'faces' }) {
  const auth = { apikey: key, Authorization: 'Bearer ' + key };
  const publicUrl = (path) => `${url}/storage/v1/object/public/${bucket}/${path}`;

  async function upload(path, body, contentType) {
    const res = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, {
      method: 'POST', headers: { ...auth, 'Content-Type': contentType, 'x-upsert': 'true' }, body,
    });
    if (!res.ok) throw new Error(`upload ${path} failed: ${res.status} ${await res.text()}`);
    return publicUrl(path);
  }

  const toBlob = (canvas, type, quality) => new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('could not encode image'))), type, quality));

  /**
   * A random handful of stored faces, from the `face_index` table. Hidden faces are left out
   * by the database. This is what the site uses; it stays fast however large the archive gets.
   */
  async function randomFaces(count = 40) {
    const res = await fetch(`${url}/rest/v1/rpc/random_faces`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ n: count }),
    });
    if (!res.ok) throw new Error('random_faces failed: ' + res.status);
    return res.json();
  }

  /** How many visible faces the archive holds. */
  async function countFaces() {
    const res = await fetch(`${url}/rest/v1/face_index?select=session_id`, { method: 'HEAD', headers: { ...auth, Prefer: 'count=exact' } });
    const total = (res.headers.get('content-range') || '').split('/')[1];
    return Number(total) || 0;
  }

  /** Visible faces added after a given time, oldest first. */
  async function facesSince(iso) {
    const res = await fetch(`${url}/rest/v1/face_index?select=session_id,created_at&created_at=gt.${encodeURIComponent(iso)}&order=created_at.asc&limit=50`, { headers: auth });
    if (!res.ok) throw new Error('face_index request failed: ' + res.status);
    return res.json();
  }

  /** Every tile file in the bucket, newest first, hidden or not. For maintenance pages only. */
  async function listTiles({ limit = 40, offset = 0 } = {}) {
    const res = await fetch(`${url}/storage/v1/object/list/${bucket}`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: 'tiles/pts/', limit, offset, sortBy: { column: 'created_at', order: 'desc' } }),
    });
    if (!res.ok) throw new Error('tile list failed: ' + res.status);
    return (await res.json()).filter((f) => f.name.endsWith('.json')).map((f) => f.name.slice(0, -5));
  }

  /** Load one saved face, ready for the morph player: { tile, shape }. */
  async function loadFlat(sessionId) {
    const meta = await fetch(publicUrl(`tiles/pts/${sessionId}.json`)).then((r) => { if (!r.ok) throw new Error('points ' + r.status); return r.json(); });
    const tile = new Image();
    tile.crossOrigin = 'anonymous';
    tile.src = publicUrl(`tiles/img/${sessionId}.jpg`);
    await tile.decode();
    return { sessionId, tile, shape: Float32Array.from(meta.points, (v) => v / 10), parents: meta.parents || [] };
  }

  /** Save a flattened face (from engine.flatten) so the morph can use it later. */
  async function saveTile(sessionId, flat, parents = []) {
    await upload(`tiles/img/${sessionId}.jpg`, await toBlob(flat.tile, 'image/jpeg', TILE_QUALITY), 'image/jpeg');
    const points = Array.from(flat.shape, (v) => Math.round(v * 10)); // tenths of a pixel
    await upload(`tiles/pts/${sessionId}.json`, JSON.stringify({ v: 2, size: flat.tile.width, points, parents }), 'application/json');
    const res = await fetch(`${url}/rest/v1/face_index`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ session_id: sessionId, parents }),
    });
    if (!res.ok) throw new Error('face_index row failed: ' + res.status);
  }

  /** Save a finished blend the way V1 saves its results: picture in the bucket, row in `generations`. */
  async function saveGeneration(sessionId, canvas, prompt) {
    const generatedUrl = await upload(`${sessionId}.png`, await toBlob(canvas, 'image/png'), 'image/png');
    const res = await fetch(`${url}/rest/v1/generations`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ generated_url: generatedUrl, prompt, session_id: sessionId }),
    });
    if (!res.ok) throw new Error('archive row failed: ' + res.status);
    return generatedUrl;
  }

  /** Rows of the `generations` table, newest first. */
  async function listGenerations({ limit = 1000 } = {}) {
    const res = await fetch(`${url}/rest/v1/generations?select=generated_url,session_id,created_at&order=created_at.desc&limit=${limit}`, { headers: auth });
    if (!res.ok) throw new Error('archive request failed: ' + res.status);
    return res.json();
  }

  return { randomFaces, countFaces, facesSince, listTiles, loadFlat, saveTile, saveGeneration, listGenerations, publicUrl };
}
