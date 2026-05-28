"""
Minimal HTTP health server for the Celery worker.

Railway web services expect a process listening on $PORT for health checks.
Celery has no HTTP server, so Railway marks deployments as failed.
This module starts a tiny background HTTP server so Railway health checks pass.

Start it once via start_health_server() inside the worker_ready signal.
"""
from __future__ import annotations

import os
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from backend.logging.setup import get_logger

log = get_logger(__name__)


class _HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        body = b'{"status":"ok","service":"celery-worker"}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args) -> None:
        pass  # suppress per-request access logs


def start_health_server() -> None:
    """Start the HTTP health server in a daemon thread."""
    port = int(os.environ.get("PORT", 8000))
    try:
        server = HTTPServer(("0.0.0.0", port), _HealthHandler)
        t = threading.Thread(target=server.serve_forever, daemon=True)
        t.start()
        log.info("worker_health_server_started", port=port)
    except Exception as exc:
        log.warning("worker_health_server_failed", error=str(exc))
