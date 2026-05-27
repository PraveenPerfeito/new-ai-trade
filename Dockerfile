FROM python:3.12-slim

WORKDIR /app

# Install deps first for layer caching
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copy full source
COPY . .

# Default: FastAPI web service.
# Railway Celery worker service overrides this via its Start Command setting:
#   celery -A backend.workers.celery_app worker --loglevel=info --concurrency=2
CMD ["/bin/sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
