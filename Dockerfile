FROM python:3.12-slim

# Build tools needed if any package lacks a pre-built wheel for this arch
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ libffi-dev libssl-dev && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Upgrade pip + wheel so binary wheel lookup succeeds
RUN pip install --no-cache-dir --upgrade pip wheel setuptools

# Deps layer — copied before source so Docker caches this when only code changes
COPY backend/requirements.txt ./backend/requirements.txt

# --prefer-binary: use pre-built wheels instead of compiling from source.
# This is the key flag that stops numpy/pandas from taking 40+ minutes to build.
RUN pip install --no-cache-dir --prefer-binary -r backend/requirements.txt

# Copy full source
COPY . .

# Run as non-root to suppress Celery superuser warning and follow least-privilege
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

# Default: FastAPI web service.
# Railway Celery worker service overrides this via its Custom Start Command:
#   celery -A backend.workers.celery_app.celery_app worker --beat --loglevel=info --concurrency=2 -Q celery,scanner
# The worker also starts a health HTTP server on $PORT (backend/workers/health_server.py)
# so Railway web-service health checks pass. Set Healthcheck Path to /health in Railway.
CMD ["/bin/sh", "-c", "exec uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
