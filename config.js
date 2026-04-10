// ─── Remote endpoint configuration ───────────────────────────────────────────
// Replace the placeholder values below with your Cloudflare Tunnel URLs once
// the tunnels are live on your Windows machine.
//
// ComfyUI tunnel:     cloudflared tunnel --url http://localhost:8188
// Prompt server tunnel: cloudflared tunnel --url http://localhost:8088
//
// Both tunnels give you an https://*.trycloudflare.com URL — paste them here.
// ─────────────────────────────────────────────────────────────────────────────

let COMFY_URL = "https://remark-calculation-choice-alleged.trycloudflare.com";
let PROMPT_SERVER_URL = null; // disabled — Ollama prompt enhancer not in use

// Allow ?comfy=https://... URL param to override COMFY_URL without a push.
// Useful when the tunnel URL changes: share evolvingportrait.me?comfy=<new-url>
// and all devices use the new URL immediately.
(function () {
  const p = new URLSearchParams(window.location.search);
  if (p.get('comfy')) COMFY_URL = p.get('comfy');
})();
