FROM python:3.11-slim

# glibc malloc tuning — caps per-thread arenas to curb the RSS ratcheting that OOMs
# this app at 512MB (Koyeb has the same ceiling as Render). Belt-and-suspenders with
# the in-process mallopt already in the code.
ENV MALLOC_ARENA_MAX=2 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Koyeb injects $PORT; default 8000 for local `docker run`.
ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn V3_updates:app --host 0.0.0.0 --port ${PORT:-8000}"]
