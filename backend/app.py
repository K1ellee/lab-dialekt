import os
import re
import json
import uuid
import subprocess
import wave

from flask import Flask, request, jsonify
from flask_cors import CORS

import speech_recognition as sr
from vosk import Model, KaldiRecognizer
import gruut

APP_MAX_MB = 20
FFMPEG = os.environ.get("FFMPEG", "ffmpeg")
MODEL_PATH = os.environ.get("VOSK_MODEL_PATH", "/app/models/vosk-model-small-ru-0.22")

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = APP_MAX_MB * 1024 * 1024
CORS(app)

model = Model(MODEL_PATH)

def run_ffmpeg_to_wav16k_mono(src_path: str, dst_path: str):
    cmd = [FFMPEG, "-y", "-i", src_path, "-ac", "1", "-ar", "16000", "-vn", dst_path]
    p = subprocess.run(cmd, capture_output=True, text=True)
    return p.returncode, (p.stderr or "").strip()

def stt_google(wav_path: str) -> str:
    r = sr.Recognizer()
    with sr.AudioFile(wav_path) as source:
        audio = r.record(source)
    # это "бесплатный" веб-метод, без API key; может иногда не отвечать
    text = r.recognize_google(audio, language="ru-RU").strip()

    if text:
        text = text[0].upper() + text[1:]
        if text[-1] not in ".!?":
            text += "."
    return text if text else "[не распознано]"

def stt_vosk(wav_path: str) -> str:
    wf = wave.open(wav_path, "rb")
    rec = KaldiRecognizer(model, wf.getframerate())
    parts = []
    while True:
        data = wf.readframes(4000)
        if len(data) == 0:
            break
        if rec.AcceptWaveform(data):
            parts.append(json.loads(rec.Result()).get("text",""))
    parts.append(json.loads(rec.FinalResult()).get("text",""))
    text = " ".join([p for p in parts if p]).strip()

    if text:
        text = text[0].upper() + text[1:]
        if text[-1] not in ".!?":
            text += "."
    return text if text else "[не распознано]"

def stt_best(wav_path: str):
    try:
        return stt_google(wav_path), "Google Speech-to-Text (онлайн)"
    except Exception:
        return stt_vosk(wav_path), "Vosk (офлайн)"

def phonemes_by_words(text: str) -> str:
    t = (text or "").strip().lower()
    blocks = []
    for sent in gruut.sentences(t, lang="ru"):
        for w in sent:
            wt = getattr(w, "text", "") or ""
            ph = getattr(w, "phonemes", None)
            if not wt:
                continue
            if ph:
                blocks.append(f"{wt}(" + " ".join(ph) + ")")
            else:
                blocks.append(f"{wt}(?)")
        blocks.append("‖")
    while blocks and blocks[-1] == "‖":
        blocks.pop()
    return "[" + " ".join(blocks) + "]"

@app.get("/")
def home():
    return "OK. POST /api/process"

@app.post("/api/process")
def api_process():
    if "file" not in request.files:
        return jsonify({"ok": False, "error": "Файл не получен (field name=file)"}), 400

    f = request.files["file"]
    if not f.filename:
        return jsonify({"ok": False, "error": "Пустое имя файла"}), 400

    uid = str(uuid.uuid4())
    os.makedirs("/tmp/uploads", exist_ok=True)
    safe_name = re.sub(r"[^a-zA-Z0-9._-]+","_", f.filename)
    src_path = f"/tmp/uploads/{uid}_{safe_name}"
    wav_path = f"/tmp/uploads/{uid}.wav"

    f.save(src_path)

    code, err = run_ffmpeg_to_wav16k_mono(src_path, wav_path)
    if code != 0:
        return jsonify({"ok": False, "error": "ffmpeg не смог конвертировать аудио", "details": err}), 400

    text, engine = stt_best(wav_path)
    phon = phonemes_by_words(text)

    return jsonify({
        "ok": True,
        "orthography": text,
        "phonetics": phon,
        "stt_engine": engine,
        "note": "Границы слов: слово(фонемы). Пауза/граница фразы: ‖."
    })

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    app.run(host="0.0.0.0", port=port)
