#!/usr/bin/env python3
"""
Whisper transcription HTTP service.

Loads a faster-whisper model once into memory and exposes:
  GET  /health     -> {"status":"ok","model":...}
  POST /transcribe -> body=raw audio bytes, header X-Audio-Ext (default "webm")
                      returns {"text", "duration", "elapsed", "language"}

Binds to 127.0.0.1 only — Node.js backend proxies to it.

Env:
  WHISPER_MODEL=small            # tiny|base|small|medium|large-v3
  WHISPER_PORT=5001
  WHISPER_MODEL_DIR=/opt/whisper-service/models
"""
import os
import sys
import json
import time
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from faster_whisper import WhisperModel

MODEL_SIZE = os.environ.get("WHISPER_MODEL", "small")
MODEL_DIR = os.environ.get("WHISPER_MODEL_DIR", "/opt/whisper-service/models")
PORT = int(os.environ.get("WHISPER_PORT", "5001"))
MAX_BYTES = 50 * 1024 * 1024  # 50 MB hard cap

print(f"[whisper] loading model={MODEL_SIZE} device=cpu compute=int8 dir={MODEL_DIR}", flush=True)
t0 = time.time()
model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8", download_root=MODEL_DIR)
print(f"[whisper] model ready in {round(time.time() - t0, 1)}s", flush=True)


class Handler(BaseHTTPRequestHandler):
    def _json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            return self._json(200, {"status": "ok", "model": MODEL_SIZE})
        return self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/transcribe":
            return self._json(404, {"error": "not found"})
        try:
            length = int(self.headers.get("Content-Length", 0))
            if length <= 0:
                return self._json(400, {"error": "empty body"})
            if length > MAX_BYTES:
                return self._json(413, {"error": "audio too large"})
            data = self.rfile.read(length)
            ext = self.headers.get("X-Audio-Ext", "webm").lstrip(".")
            if not ext.isalnum() or len(ext) > 5:
                ext = "webm"

            with tempfile.NamedTemporaryFile(suffix="." + ext, delete=False) as f:
                f.write(data)
                tmp_path = f.name

            try:
                t = time.time()
                segments, info = model.transcribe(
                    tmp_path,
                    language="bg",
                    beam_size=1,
                    vad_filter=True,
                    vad_parameters={"min_silence_duration_ms": 500},
                )
                text = " ".join(s.text.strip() for s in segments).strip()
                elapsed = round(time.time() - t, 2)
                return self._json(200, {
                    "text": text,
                    "duration": round(info.duration, 2),
                    "elapsed": elapsed,
                    "language": info.language,
                })
            finally:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
        except Exception as e:
            print(f"[whisper] error: {e}", file=sys.stderr, flush=True)
            return self._json(500, {"error": str(e)})

    def log_message(self, fmt, *args):
        sys.stderr.write("[whisper] " + (fmt % args) + "\n")


if __name__ == "__main__":
    print(f"[whisper] listening on 127.0.0.1:{PORT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
