import os
import re
import json
import uuid
import subprocess
import wave
from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen

from flask import Flask, request, jsonify, render_template
from flask_cors import CORS

from vosk import Model, KaldiRecognizer
import gruut

APP_MAX_MB = 20
FFMPEG = os.environ.get("FFMPEG", "ffmpeg")
MODEL_PATH = os.environ.get("VOSK_MODEL_PATH", "/app/models/vosk-model-small-ru-0.22")

app = Flask(__name__, static_folder="static", template_folder="templates")
CORS(app)

app.config["MAX_CONTENT_LENGTH"] = APP_MAX_MB * 1024 * 1024

model = Model(MODEL_PATH)

_GEOCODE_CACHE = {}

def run_ffmpeg_to_wav16k_mono(src_path: str, dst_path: str):
    cmd = [FFMPEG, "-y", "-i", src_path, "-ac", "1", "-ar", "16000", "-vn", dst_path]
    p = subprocess.run(cmd, capture_output=True, text=True)
    return p.returncode, (p.stderr or "").strip()

def stt_vosk(wav_path: str) -> str:
    parts = []
    with wave.open(wav_path, "rb") as wf:
        rec = KaldiRecognizer(model, wf.getframerate())
        while True:
            data = wf.readframes(4000)
            if len(data) == 0:
                break
            if rec.AcceptWaveform(data):
                parts.append(json.loads(rec.Result()).get("text", ""))
        parts.append(json.loads(rec.FinalResult()).get("text", ""))

    text = " ".join([p for p in parts if p]).strip()
    if text:
        text = text[0].upper() + text[1:]
        if text[-1] not in ".!?":
            text += "."
    return text if text else "[не распознано]"

def _ipa_token_to_rus(tok: str) -> str:
    t = (tok or "").strip()
    if not t:
        return ""
    t = t.replace("ˈ", "").replace("ˌ", "")

    long_ = t.endswith("ː")
    if long_:
        t = t[:-1]

    pal = "ʲ" in t
    t = t.replace("ʲ", "")
    t = t.replace("ɡ", "g")

    base = {
        "t͡s": "ц",
        "t͡ɕ": "ч",
        "ɕː": "щː",
        "ɕ": "щ",
        "ʂ": "ш",
        "ʐ": "ж",
        "x": "х",
        "j": "й",

        "a": "а",
        "o": "о",
        "u": "у",
        "i": "и",
        "e": "э",
        "ɨ": "ы",
        "ɐ": "а",
        "ə": "а",

        "p": "п",
        "b": "б",
        "v": "в",
        "f": "ф",
        "m": "м",
        "n": "н",
        "l": "л",
        "r": "р",
        "k": "к",
        "g": "г",
        "d": "д",
        "t": "т",
        "s": "с",
        "z": "з",
    }

    ch = base.get(t, t)
    if pal and ch and ch.isalpha():
        ch = ch + "'"
    if long_:
        ch = ch + "ː"
    return ch

def phonetics_two_lines(text: str):
    t = (text or "").strip().lower()

    ipa_blocks = []
    rus_blocks = []

    for sent in gruut.sentences(t, lang="ru"):
        for w in sent:
            ph = getattr(w, "phonemes", None)
            if ph:
                ipa_word = "".join(p for p in ph if p).strip()
                rus_word = "".join(_ipa_token_to_rus(p) for p in ph if p).strip()
                ipa_blocks.append(ipa_word if ipa_word else "?")
                rus_blocks.append(rus_word if rus_word else "?")
            else:
                ipa_blocks.append("?")
                rus_blocks.append("?")

        ipa_blocks.append("‖")
        rus_blocks.append("‖")

    while ipa_blocks and ipa_blocks[-1] == "‖":
        ipa_blocks.pop()
    while rus_blocks and rus_blocks[-1] == "‖":
        rus_blocks.pop()

    ipa = "[" + " ".join(ipa_blocks) + "]"
    rus = "[" + " ".join(rus_blocks) + "]"
    return ipa, rus

@app.get("/")
def page_index():
    return render_template("index.html")

@app.get("/task1")
def page_task1():
    return render_template("task1.html")

@app.get("/task3")
def page_task3():
    return render_template("task3.html")

@app.get("/api/geocode")
def api_geocode():
    q = (request.args.get("q") or "").strip()
    if not q:
        return jsonify({"ok": False, "error": "Параметр q пустой"}), 400

    if q in _GEOCODE_CACHE:
        return jsonify(_GEOCODE_CACHE[q])

    params = {
        "format": "json",
        "limit": "1",
        "q": q
    }
    url = "https://nominatim.openstreetmap.org/search?" + urlencode(params)

    try:
        req = Request(url, headers={
            # Важно для Nominatim: нужен User-Agent
            "User-Agent": "lab-dialekt/1.0 (Render Flask demo)"
        })
        raw = urlopen(req, timeout=12).read().decode("utf-8", errors="replace")
        data = json.loads(raw)
    except Exception as e:
        resp = {"ok": False, "error": "Ошибка геокодирования", "details": str(e)}
        _GEOCODE_CACHE[q] = resp
        return jsonify(resp), 502

    if not data:
        # Дадим ссылку на Википедию (обычно координаты есть в карточке справа)
        name = q.split(",")[0].strip()
        wiki = "https://ru.wikipedia.org/wiki/" + quote(name.replace(" ", "_"))
        resp = {"ok": False, "error": "Координаты не найдены", "wiki": wiki}
        _GEOCODE_CACHE[q] = resp
        return jsonify(resp)

    item = data[0]
    resp = {
        "ok": True,
        "lat": float(item["lat"]),
        "lon": float(item["lon"]),
        "display_name": item.get("display_name", "")
    }
    _GEOCODE_CACHE[q] = resp
    return jsonify(resp)

@app.post("/api/process")
def api_process():
    if "file" not in request.files:
        return jsonify({"ok": False, "error": "Файл не получен (field name=file)"}), 400

    f = request.files["file"]
    if not f.filename:
        return jsonify({"ok": False, "error": "Пустое имя файла"}), 400

    uid = str(uuid.uuid4())
    os.makedirs("/tmp/uploads", exist_ok=True)
    safe_name = re.sub(r"[^a-zA-Z0-9._-]+", "_", f.filename)
    src_path = f"/tmp/uploads/{uid}_{safe_name}"
    wav_path = f"/tmp/uploads/{uid}.wav"

    f.save(src_path)

    code, err = run_ffmpeg_to_wav16k_mono(src_path, wav_path)
    if code != 0:
        return jsonify({"ok": False, "error": "ffmpeg не смог конвертировать аудио", "details": err}), 400

    text = stt_vosk(wav_path)
    ipa, rus = phonetics_two_lines(text)

    return jsonify({
        "ok": True,
        "orthography": text,
        "phonetics_ipa": ipa,
        "phonetics_rus": rus,
        "note": "Пробелы только между словами; внутри слова фонемы слитно (пример: т'от'а). Пауза/граница фразы: ‖."
    })

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    app.run(host="0.0.0.0", port=port)
