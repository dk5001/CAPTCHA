// ─── Remote endpoint configuration ───────────────────────────────────────────
// Replace the placeholder values below with your Cloudflare Tunnel URLs once
// the tunnels are live on your Windows machine.
//
// ComfyUI tunnel:     cloudflared tunnel --url http://localhost:8188
// Prompt server tunnel: cloudflared tunnel --url http://localhost:8088
//
// Both tunnels give you an https://*.trycloudflare.com URL — paste them here.
// ─────────────────────────────────────────────────────────────────────────────

let COMFY_URL = "https://pursuit-fields-purchase-grounds.trycloudflare.com";
let PROMPT_SERVER_URL = null; // disabled — Ollama prompt enhancer not in use

const SUPABASE_URL = "https://tqbujuswtscrjglxpryn.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRxYnVqdXN3dHNjcmpnbHhwcnluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwNDc4MjAsImV4cCI6MjA5MTYyMzgyMH0.Js4y7tyOjwXCsNnoEIHmjm3cyDn8r6ZOP324wwCCXx0";

// Allow ?comfy=https://... URL param to override COMFY_URL without a push.
// Useful when the tunnel URL changes: share evolvingportrait.me?comfy=<new-url>
// and all devices use the new URL immediately.
(function () {
  const p = new URLSearchParams(window.location.search);
  if (p.get('comfy')) COMFY_URL = p.get('comfy');
})();
