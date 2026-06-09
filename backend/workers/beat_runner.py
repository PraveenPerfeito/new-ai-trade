"""
Beat runner — starts a Railway-compatible health server before launching Beat.

Railway health-checks all services at $PORT/health. Celery Beat has no HTTP
server; this wrapper starts the same minimal health server used by the worker,
then runs Beat so both live in the same container process.

Start command in Railway:
    python -m backend.workers.beat_runner
"""
from __future__ import annotations

import subprocess
import sys

from backend.workers.health_server import start_health_server


def main() -> None:
    start_health_server()

    cmd = [
        sys.executable, "-m", "celery",
        "-A", "backend.workers.celery_app",
        "beat",
        "--loglevel=info",
    ]
    proc = subprocess.run(cmd)
    sys.exit(proc.returncode)


if __name__ == "__main__":
    main()
