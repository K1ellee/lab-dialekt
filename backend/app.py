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

SHEET_APPEND_URL = (os.environ.get("SHEET_APPEND_URL") or "").strip()
SHEET_APPEND_TOKEN = (os.environ.get("SHEET_APPEND_TOKEN") or "").strip()

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

def _http_get_json(url: str, timeout_s: int = 20):
    req = Request(url, headers={
        "User-Agent": "lab-dialekt/1.0 (Render Flask demo)",
        "Accept-Language": "ru"
    })
    raw = urlopen(req, timeout=timeout_s).read().decode("utf-8", errors="replace")
    return json.loads(raw)

def _http_post_json(url: str, payload: dict, timeout_s: int = 25):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "User-Agent": "lab-dialekt/1.0 (Render Flask demo)"
        },
        method="POST",
    )
    raw = urlopen(req, timeout=timeout_s).read().decode("utf-8", errors="replace")
    try:
        return json.loads(raw)
    except Exception:
        return {"ok": False, "error": "Apps Script returned non-JSON", "raw": raw[:500]}

def _extract_district(address: dict) -> str:
    if not isinstance(address, dict):
        return ""
    for k in ("county", "state_district", "municipality", "city_district"):
        v = address.get(k)
        if v and str(v).strip():
            return str(v).strip()
    return ""

def _normalize_settlement_name(name: str) -> list[str]:
    """
    Возвращает несколько вариантов названия населённого пункта:
    - как есть
    - без служебных слов
    - с сокращениями/вариантами
    """
    src = (name or "").strip()
    if not src:
        return []

    variants = [src]

    x = src
    # убираем тип населённого пункта в начале
    x = re.sub(r"^(деревня|д\.|село|пос[её]лок|п\.|пгт|город|г\.)\s+", "", x, flags=re.I).strip()
    if x and x not in variants:
        variants.append(x)

    return variants

def _search_nominatim_query(q: str):
    params = {
        "format": "json",
        "limit": "5",
        "q": q,
        "addressdetails": "1",
        "accept-language": "ru"
    }
    url = "https://nominatim.openstreetmap.org/search?" + urlencode(params)
    return _http_get_json(url, timeout_s=15)

def _score_result(item: dict, wanted_region: str = "", wanted_district: str = "") -> int:
    """
    Небольшое ранжирование:
    - совпал регион -> +3
    - совпал район -> +2
    """
    score = 0
    addr = item.get("address") or {}
    display = (item.get("display_name") or "").lower()

    wr = (wanted_region or "").strip().lower()
    wd = (wanted_district or "").strip().lower()

    if wr:
        if wr in display or wr in " ".join(str(v).lower() for v in addr.values()):
            score += 3

    if wd:
        if wd in display or wd in " ".join(str(v).lower() for v in addr.values()):
            score += 2

    return score

def _find_best_geocode(settlement: str, district: str, region: str):
    """
    Ищем в несколько попыток:
    1) settlement, district, region, Россия
    2) settlement, region, Россия
    3) settlement, Россия
    Для settlement используем несколько вариантов названия.
    """
    variants = _normalize_settlement_name(settlement)
    queries = []

    for s in variants:
        if district and region:
            queries.append(", ".join([s, district, region, "Россия"]))
        if region:
            queries.append(", ".join([s, region, "Россия"]))
        queries.append(", ".join([s, "Россия"]))

    # убрать дубли, сохраняя порядок
    seen = set()
    uniq_queries = []
    for q in queries:
        if q not in seen:
            seen.add(q)
            uniq_queries.append(q)

    best_item = None
    best_query = None
    best_score = -10**9

    for q in uniq_queries:
        try:
            data = _search_nominatim_query(q)
        except Exception:
            continue

        if not data:
            continue

        for item in data:
            score = _score_result(item, wanted_region=region, wanted_district=district)
            # бонус за наличие house/road не даём, нас интересуют населённые пункты
            if score > best_score:
                best_score = score
                best_item = item
                best_query = q

        # если нашли хороший результат с совпадением региона — можно не перебирать слишком долго
        if best_score >= 3 and best_item is not None:
            break

    return best_item, best_query

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

    # Пытаемся вытащить settlement/district/region из строки, которую шлёт фронт:
    # "settlement, district, region, Россия" или подобное
    parts = [p.strip() for p in q.split(",") if p.strip()]
    settlement = parts[0] if len(parts) >= 1 else ""
    district = parts[1] if len(parts) >= 3 else ""   # если формат: settl, district, region, Россия
    region = parts[2] if len(parts) >= 3 else (parts[1] if len(parts) >= 2 else "")

    cache_key = f"{settlement}|{district}|{region}"
    if cache_key in _GEOCODE_CACHE:
        return jsonify(_GEOCODE_CACHE[cache_key])

    try:
        item, used_query = _find_best_geocode(settlement, district, region)
    except Exception as e:
        resp = {"ok": False, "error": "Ошибка геокодирования", "details": str(e)}
        _GEOCODE_CACHE[cache_key] = resp
        return jsonify(resp), 502

    if not item:
        name = settlement or q.split(",")[0].strip()
        wiki = "https://ru.wikipedia.org/wiki/" + quote(name.replace(" ", "_"))
        resp = {"ok": False, "error": "Координаты не найдены", "wiki": wiki}
        _GEOCODE_CACHE[cache_key] = resp
        return jsonify(resp)

    address = item.get("address") or {}
    district_found = _extract_district(address)

    resp = {
        "ok": True,
        "lat": float(item["lat"]),
        "lon": float(item["lon"]),
        "display_name": item.get("display_name", ""),
        "district": district_found,
        "used_query": used_query or q
    }
    _GEOCODE_CACHE[cache_key] = resp
    return jsonify(resp)

@app.post("/api/sheet_append")
def api_sheet_append():
    if not SHEET_APPEND_URL:
        return jsonify({
            "ok": False,
            "error": "SHEET_APPEND_URL not configured on server (Render Environment)."
        }), 500

    payload = request.get_json(silent=True) or {}

    required = ["region", "settlement", "question", "unit1", "lat", "lon"]
    missing = [k for k in required if not str(payload.get(k, "")).strip()]
    if missing:
        return jsonify({"ok": False, "error": "Missing fields: " + ", ".join(missing)}), 400

    payload["comment"] = ""

    if SHEET_APPEND_TOKEN:
        payload["token"] = SHEET_APPEND_TOKEN

    try:
        resp = _http_post_json(SHEET_APPEND_URL, payload, timeout_s=25)
        return jsonify(resp)
    except Exception as e:
        return jsonify({"ok": False, "error": "Failed to call Apps Script", "details": str(e)}), 502

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
