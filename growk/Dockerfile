# Python agent for GrowK. Designed for Railway (or any container host).
# Runs the sensor poll loop + FastAPI HTTP API in one process on $PORT.

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# System packages — none required beyond Python stdlib + pip deps.
# tini gives clean signal handling for the long-running loop.
RUN apt-get update && apt-get install -y --no-install-recommends \
    tini \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

# Persistent SQLite path. On Railway, mount a volume at /app/db_data.
ENV DB_PATH=/app/db_data/growk.db \
    GROWK_API_HOST=0.0.0.0 \
    GROWK_API_PORT=8765 \
    LOG_LEVEL=INFO

RUN mkdir -p /app/db_data

# Railway provides $PORT; honor it if set, else fall back to 8765.
EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request,sys; \
    urllib.request.urlopen(f'http://127.0.0.1:{__import__('os').environ.get(\"PORT\",\"8765\")}/api/health', timeout=3); sys.exit(0)" \
  || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["python", "main.py"]
