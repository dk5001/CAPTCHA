// ─── Remote endpoint configuration ───────────────────────────────────────────
// Replace the placeholder values below with your Cloudflare Tunnel URLs once
// the tunnels are live on your Windows machine.
//
// ComfyUI tunnel:     cloudflared tunnel --url http://localhost:8188
// Prompt server tunnel: cloudflared tunnel --url http://localhost:8088
//
// Both tunnels give you an https://*.trycloudflare.com URL — paste them here.
// ─────────────────────────────────────────────────────────────────────────────

const COMFY_URL = "https://remark-calculation-choice-alleged.trycloudflare.com";
const PROMPT_SERVER_URL = null; // disabled — Ollama prompt enhancer not in use
