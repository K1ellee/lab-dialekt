FROM python:3.11-slim

# ffmpeg нужен для конвертации входного аудио (mp3/ogg/..)->wav
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg wget unzip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Модель Vosk (ru small ~50MB)
RUN mkdir -p /app/models \
 && wget -O /tmp/model.zip https://alphacephei.com/vosk/models/vosk-model-small-ru-0.22.zip \
 && unzip /tmp/model.zip -d /app/models \
 && rm /tmp/model.zip

COPY backend/app.py /app/app.py
COPY backend/templates /app/templates
COPY backend/static /app/static

ENV VOSK_MODEL_PATH=/app/models/vosk-model-small-ru-0.22

# Render даёт PORT, мы его используем
CMD gunicorn -b 0.0.0.0:${PORT:-8000} --timeout 180 app:app

