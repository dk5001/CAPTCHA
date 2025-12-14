# prompt_server.py
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
import requests

OLLAMA_URL = "http://localhost:11434/api/generate"  # Ollama default [web:18][web:61]

SYSTEM_INSTRUCTION = (
    "You rewrite user input into a single, vivid prompt describing a human face "
    "for a Stable Diffusion / ComfyUI workflow. "
    "Output ONLY the prompt text, no explanations, no quotation marks. "
    "Mention age, gender presentation, key facial features, emotion, camera framing, "
    "lighting, and visual style. Max 60 words."
)

def call_ollama(user_text: str) -> str:
    payload = {
        "model": "gpt-oss",  # or gpt-oss:120b if you have it [web:80][web:88][web:90]
        "prompt": f"{SYSTEM_INSTRUCTION}\n\nUser input:\n{user_text}",
        "stream": False,
    }
    r = requests.post(OLLAMA_URL, json=payload)
    r.raise_for_status()
    data = r.json()
    return data["response"].strip()

class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        print("Received OPTIONS request")
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        print("Received POST request")
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            try:
                data = json.loads(body.decode("utf-8"))
            except json.JSONDecodeError:
                self.send_response(400)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(b"Invalid JSON")
                return

            user_text = data.get("text", "")
            print(f"Processing text: {user_text}")
            
            try:
                prompt = call_ollama(user_text)
                print(f"Generated prompt: {prompt}")
            except Exception as e:
                print(f"Ollama error: {e}")
                # Fallback to user text if Ollama fails
                prompt = user_text

            resp = json.dumps({"prompt": prompt}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
        except Exception as e:
            print(f"Server error: {e}")
            self.send_response(500)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()

class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True

if __name__ == "__main__":
    # Allow address reuse to avoid "Address already in use" errors on restart
    ThreadingHTTPServer.allow_reuse_address = True
    server = ThreadingHTTPServer(("127.0.0.1", 8088), Handler)
    print("Prompt server running on http://127.0.0.1:8088")
    server.serve_forever()
