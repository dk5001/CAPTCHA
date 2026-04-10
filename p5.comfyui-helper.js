/**
 * p5.comfyui-helper
 * (c) Gottfried Haider 2024
 * LGPL
 * https://github.com/gohai/p5.comfyui-helper
 *
 * Modified: completion detection via HTTP polling instead of WebSocket,
 * which is dropped by Cloudflare Tunnel before long generations finish.
 */

'use strict';

class ComfyUiP5Helper {
  constructor(base_url) {
    this.base_url = base_url.replace(/\/$/, "");
    this.sid = null;
    this.setup_websocket();
  }

  setup_websocket() {
    try {
      const ws_url = this.base_url.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://");
      this.ws = new WebSocket(ws_url + "/ws");
      this.ws.addEventListener("message", (event) => {
        if (typeof event.data !== "string") return;
        try {
          const data = JSON.parse(event.data);
          if (data.type === "status" && data.data.sid && !this.sid) {
            this.sid = data.data.sid;
            console.log("ComfyUI WebSocket connected, sid:", this.sid);
          }
        } catch (e) {}
      });
      this.ws.addEventListener("error", () => {
        console.warn("ComfyUI WebSocket unavailable — polling only");
      });
    } catch (e) {
      console.warn("Could not create WebSocket:", e);
    }
  }

  async run(workflow, callback) {
    this.callback = callback;
    const prompt_id = await this.prompt(workflow);
    return new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
      this.poll_for_result(prompt_id, 0);
    });
  }

  async poll_for_result(prompt_id, attempts) {
    const max_attempts = 120; // 120 × 2s = 4 minutes max
    const interval_ms = 2000;

    try {
      const res = await fetch(this.base_url + "/history/" + prompt_id);
      if (res.ok) {
        const history = await res.json();
        const entry = history[prompt_id];
        if (entry && entry.outputs && Object.keys(entry.outputs).length > 0) {
          await this.deliver_outputs(entry.outputs);
          return;
        }
      }
    } catch (e) {
      console.warn("Poll attempt", attempts, "error:", e.message);
    }

    if (attempts >= max_attempts) {
      const msg = "ComfyUI generation timed out after " + (max_attempts * interval_ms / 1000) + "s";
      console.warn(msg);
      if (this.callback) this.callback([], msg);
      this.reject(msg);
      return;
    }

    setTimeout(() => this.poll_for_result(prompt_id, attempts + 1), interval_ms);
  }

  async deliver_outputs(outputs) {
    const results = [];
    for (const node_id in outputs) {
      const node_out = outputs[node_id];
      if (node_out.images) {
        for (const img of node_out.images) {
          const url = this.base_url + "/view?filename=" +
            encodeURIComponent(img.filename) +
            "&subfolder=" + encodeURIComponent(img.subfolder || "") +
            "&type=" + encodeURIComponent(img.type || "output");
          results.push({ node: parseInt(node_id), src: url });
        }
      }
    }

    console.log("ComfyUI outputs received:", results);
    if (this.callback) this.callback(results);
    this.resolve(results);
  }

  async prompt(workflow) {
    console.log("=== COMFY HELPER SENDING ===");
    console.log("Node 6 being sent:", JSON.stringify(workflow["6"], null, 2));
    console.log("===========================");

    const options = {
      method: "POST",
      body: JSON.stringify({ prompt: workflow, client_id: this.sid }),
      headers: { "Content-Type": "application/json" },
      redirect: "follow",
    };

    try {
      const res = await fetch(this.base_url + "/prompt", options);
      const data = await res.json();
      if (res.status !== 200) {
        if (data.error) {
          throw data.error.type + ": " + data.error.message + " (" + data.error.details + ")";
        } else {
          throw "Status " + res.status;
        }
      }
      console.log("Prompt queued, id:", data.prompt_id);
      return data.prompt_id;
    } catch (e) {
      console.warn(e);
      throw e;
    }
  }

  image(img) {
    if (!img.loadPixels) throw "image() is currently only implemented for p5 images";
    img.loadPixels();
    const data_url = img.canvas.toDataURL();
    return {
      inputs: { image: data_url.split("base64,")[1] },
      class_type: "ETN_LoadImageBase64",
      _meta: { title: "Load Image (Base64)" },
    };
  }

  mask(img) {
    if (!img.loadPixels) throw "mask() is currently only implemented for p5 images";
    img.loadPixels();
    const data_url = img.canvas.toDataURL();
    return {
      inputs: { image: data_url.split("base64,")[1] },
      class_type: "ETN_LoadMaskBase64",
      _meta: { title: "Load Mask (Base64)" },
    };
  }
}
