FROM python:3.12-slim

WORKDIR /app

# Install deps first for layer caching
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copy full source
COPY . .

# Default: FastAPI web service.
# /bin/sh -c ensures $PORT is shell-expanded regardless of line endings or
# how Railway passes the command.
# Railway Celery worker service overrides this via its Custom Start Command:
#   celery -A backend.workers.celery_app.celery_app worker --loglevel=info --concurrency=2
CMD ["/bin/sh", "-c", "exec uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
