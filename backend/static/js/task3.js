(function () {
  const CFG = window.APP_CONFIG || {};
  const $ = (id) => document.getElementById(id);

  const els = {
    sheetLinks: $("sheetLinks"),
    status: $("status"),
    list: $("list"),

    q: $("q"),
    unit1: $("unit1"),
    unit2: $("unit2"),
    region: $("region"),
    district: $("district"),
    settlement: $("settlement"),

    apply: $("apply"),
    reset: $("reset"),

    add_region: $("add_region"),
    add_district: $("add_district"),
    add_settlement: $("add_settlement"),
    add_question: $("add_question"),
    add_unit1: $("add_unit1"),
    add_unit2: $("add_unit2"),
    add_prepare: $("add_prepare"),
    add_send: $("add_send"),
    add_status: $("add_status"),
    add_result: $("add_result"),

    dlRegions: $("dlRegions"),
    dlDistricts: $("dlDistricts"),
    dlSettlements: $("dlSettlements"),
    dlQuestions: $("dlQuestions"),
    dlUnit1: $("dlUnit1"),
    dlUnit2: $("dlUnit2"),
  };

  const map = L.map("map", { scrollWheelZoom: true }).setView([56.85, 53.20], 7);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  const markersLayer = L.layerGroup().addTo(map);
  let boundaryLayer = null;

  let ALL = [];
  let LAST_ADD_ROW = null; // подготовленная запись

  function setStatus(s) { els.status.textContent = s || ""; }
  function setAddStatus(s) { els.add_status.textContent = s || ""; }

  function esc(s) {
    return (s ?? "").toString()
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function uniq(arr) {
    const set = new Set();
    for (const v of arr) {
      const t = (v ?? "").toString().trim();
      if (t) set.add(t);
    }
    return Array.from(set).sort((a,b)=>a.localeCompare(b, "ru"));
  }

  function fillSelect(sel, values, emptyLabel) {
    sel.innerHTML = "";
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = emptyLabel || "— все —";
    sel.appendChild(opt0);

    for (const v of values) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = v;
      sel.appendChild(o);
    }
  }

  function fillDatalist(dl, values) {
    dl.innerHTML = values.map(v => `<option value="${esc(v)}"></option>`).join("");
  }

  function normalizeRow(r) {
    const region = (r.region ?? "").toString().trim();
    const district = (r.district ?? "").toString().trim();
    const settlement = (r.settlement ?? "").toString().trim();
    const question = (r.question ?? "").toString().trim();
    const unit1 = (r.unit1 ?? "").toString().trim();
    const unit2 = (r.unit2 ?? "").toString().trim();
    const comment = (r.comment ?? "").toString().trim();

    const lat = parseFloat((r.lat ?? "").toString().replace(",", "."));
    const lon = parseFloat((r.lon ?? "").toString().replace(",", "."));

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { region, district, settlement, question, unit1, unit2, comment, lat, lon };
  }

  async function loadBoundary() {
    const url = CFG.UDM_BOUNDARY_URL || "/static/data/udmurtia.geojson";
    try {
      const r = await fetch(url);
      if (!r.ok) return;
      const gj = await r.json();

      if (boundaryLayer) boundaryLayer.remove();
      boundaryLayer = L.geoJSON(gj, {
        style: { color: "#c00", weight: 2, fill: false, opacity: 0.9 }
      }).addTo(map);
    } catch (e) {
      // граница — опционально
      console.warn("Boundary load failed:", e);
    }
  }

  async function loadData() {
    setStatus("Загружаю данные...");

    if (CFG.SHEET_EDIT_URL) {
      const edit = esc(CFG.SHEET_EDIT_URL);
      const pub = esc(CFG.SHEET_CSV_URL || "");
      els.sheetLinks.innerHTML =
        `Таблица: <a target="_blank" href="${edit}">открыть для редактирования</a>` +
        (pub ? ` · CSV: <a target="_blank" href="${pub}">открыть</a>` : "");
    }

    try {
      if (CFG.SHEET_CSV_URL) {
        const resp = await fetch(CFG.SHEET_CSV_URL, { cache: "no-store" });
        const csvText = await resp.text();

        // Нормальный CSV-парсер (поддерживает запятые/кавычки)
        let rows = [];
        if (window.Papa) {
          const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
          rows = parsed.data || [];
        } else {
          // fallback (на всякий случай)
          const lines = csvText.split(/\r?\n/).filter(Boolean);
          const head = (lines.shift() || "").split(",");
          for (const line of lines) {
            const cols = line.split(",");
            const obj = {};
            head.forEach((h, i) => obj[h.trim()] = (cols[i] ?? "").trim());
            rows.push(obj);
          }
        }

        const out = [];
        for (const r of rows) {
          const n = normalizeRow(r);
          if (n) out.push(n);
        }
        ALL = out;
      } else {
        const r = await fetch("/static/data/sample_points.json");
        const j = await r.json();
        ALL = (Array.isArray(j) ? j : (j.points || []))
          .map(normalizeRow)
          .filter(Boolean);
      }

      setStatus(`Загружено точек: ${ALL.length}`);
      initControlsFromData();
      render();
    } catch (e) {
      setStatus("Ошибка загрузки данных");
      console.error(e);
      alert("Не удалось загрузить данные карты.\n\n" + e);
    }
  }

  function initControlsFromData() {
    // Фильтры
    fillSelect(els.q, uniq(ALL.map(x => x.question)), "Все вопросы");
    fillSelect(els.region, uniq(ALL.map(x => x.region)), "Все регионы");
    fillSelect(els.district, [], "Все районы");
    fillSelect(els.settlement, [], "Все населённые пункты");
    fillSelect(els.unit1, [], "Все unit1");
    fillSelect(els.unit2, [], "Все unit2");

    // Datalist для формы добавления (можно выбрать из выпадающего, но можно и ввести новое)
    fillDatalist(els.dlRegions, uniq(ALL.map(x => x.region)));
    fillDatalist(els.dlDistricts, uniq(ALL.map(x => x.district)));
    fillDatalist(els.dlSettlements, uniq(ALL.map(x => x.settlement)));
    fillDatalist(els.dlQuestions, uniq(ALL.map(x => x.question)));
    fillDatalist(els.dlUnit1, uniq(ALL.map(x => x.unit1)));
    fillDatalist(els.dlUnit2, uniq(ALL.map(x => x.unit2)));

    // Зависимые списки
    els.region.addEventListener("change", () => {
      const r = els.region.value;
      const districts = uniq(ALL.filter(x => !r || x.region === r).map(x => x.district));
      fillSelect(els.district, districts, "Все районы");
      els.district.value = "";

      const settlements = uniq(ALL.filter(x => (!r || x.region === r)).map(x => x.settlement));
      fillSelect(els.settlement, settlements, "Все населённые пункты");
      els.settlement.value = "";
    });

    els.district.addEventListener("change", () => {
      const r = els.region.value;
      const d = els.district.value;
      const settlements = uniq(ALL.filter(x =>
        (!r || x.region === r) && (!d || x.district === d)
      ).map(x => x.settlement));
      fillSelect(els.settlement, settlements, "Все населённые пункты");
      els.settlement.value = "";
    });

    els.q.addEventListener("change", () => {
      const q = els.q.value;
      const unit1 = uniq(ALL.filter(x => !q || x.question === q).map(x => x.unit1));
      const unit2 = uniq(ALL.filter(x => !q || x.question === q).map(x => x.unit2));
      fillSelect(els.unit1, unit1, "Все unit1");
      fillSelect(els.unit2, unit2, "Все unit2");
      els.unit1.value = "";
      els.unit2.value = "";
    });

    // кнопки
    els.apply.onclick = () => render();
    els.reset.onclick = () => {
      els.q.value = "";
      els.unit1.value = "";
      els.unit2.value = "";
      els.region.value = "";
      fillSelect(els.district, [], "Все районы"); els.district.value = "";
      fillSelect(els.settlement, [], "Все населённые пункты"); els.settlement.value = "";
      render();
    };

    // стартовые зависимые значения
    els.q.dispatchEvent(new Event("change"));
    els.region.dispatchEvent(new Event("change"));
  }

  function getFiltered() {
    const q = els.q.value;
    const u1 = els.unit1.value;
    const u2 = els.unit2.value;
    const r = els.region.value;
    const d = els.district.value;
    const s = els.settlement.value;

    return ALL.filter(x => {
      if (q && x.question !== q) return false;
      if (u1 && x.unit1 !== u1) return false;
      if (u2 && x.unit2 !== u2) return false;
      if (r && x.region !== r) return false;
      if (d && x.district !== d) return false;
      if (s && x.settlement !== s) return false;
      return true;
    });
  }

  function popupHtml(x) {
    return `
      <div style="min-width:240px">
        <div><b>${esc(x.settlement || "(без названия)")}</b></div>
        <div class="small">${esc(x.region)}${x.district ? (", " + esc(x.district)) : ""}</div>
        <hr>
        <div><b>Вопрос:</b> ${esc(x.question)}</div>
        <div><b>unit1:</b> ${esc(x.unit1)}</div>
        <div><b>unit2:</b> ${esc(x.unit2)}</div>
        ${x.comment ? `<div><b>Комментарий:</b> ${esc(x.comment)}</div>` : ""}
        <div class="small" style="margin-top:6px;">${x.lat.toFixed(5)}, ${x.lon.toFixed(5)}</div>
      </div>
    `;
  }

  function render() {
    const items = getFiltered();
    setStatus(`Показано: ${items.length} из ${ALL.length}`);

    markersLayer.clearLayers();
    els.list.innerHTML = "";

    if (!items.length) {
      els.list.innerHTML = '<div class="small">Нет результатов.</div>';
      return;
    }

    const bounds = [];
    for (const x of items) {
      const m = L.marker([x.lat, x.lon]).addTo(markersLayer);
      m.bindPopup(popupHtml(x));
      bounds.push([x.lat, x.lon]);
    }

    // список
    els.list.innerHTML = items.map((x, i) => `
      <div class="row" data-i="${i}">
        <div><b>${esc(x.settlement || "(без названия)")}</b> — ${esc(x.question)}</div>
        <div class="small">${esc(x.region)}${x.district ? (", " + esc(x.district)) : ""} · unit1=${esc(x.unit1)} · unit2=${esc(x.unit2)}</div>
      </div>
    `).join("");

    els.list.querySelectorAll(".row").forEach((rowEl) => {
      rowEl.addEventListener("click", () => {
        const i = parseInt(rowEl.getAttribute("data-i"), 10);
        const x = items[i];
        map.setView([x.lat, x.lon], 11);
        // открываем popup ближайшего маркера (просто откроем по совпадению координат)
        markersLayer.eachLayer((layer) => {
          const ll = layer.getLatLng();
          if (Math.abs(ll.lat - x.lat) < 1e-9 && Math.abs(ll.lng - x.lon) < 1e-9) {
            layer.openPopup();
          }
        });
      });
    });

    // fit bounds (мягко)
    if (bounds.length >= 2) map.fitBounds(bounds, { padding: [20, 20] });
    else map.setView(bounds[0], 11);
  }

  function buildWikiLink(name) {
    const t = (name || "").trim().replaceAll(" ", "_");
    return "https://ru.wikipedia.org/wiki/" + encodeURIComponent(t);
  }

  function buildQueryForGeocode(region, district, settlement) {
    // Формируем запрос так, чтобы Nominatim лучше находил.
    // Можно добавлять "Россия" в конец.
    const parts = [];
    if (settlement) parts.push(settlement);
    if (district) parts.push(district);
    if (region) parts.push(region);
    parts.push("Россия");
    return parts.filter(Boolean).join(", ");
  }

  async function prepareAdd() {
    setAddStatus("Ищу координаты...");
    els.add_result.innerHTML = "";
    els.add_send.disabled = true;
    LAST_ADD_ROW = null;

    const region = els.add_region.value.trim();
    const district = els.add_district.value.trim();
    const settlement = els.add_settlement.value.trim();
    const question = els.add_question.value.trim();
    const unit1 = els.add_unit1.value.trim();
    const unit2 = els.add_unit2.value.trim();

    if (!region || !settlement || !question || !unit1 || !unit2) {
      setAddStatus("Заполни: регион, нас.пункт, вопрос, unit1, unit2");
      return;
    }

    const q = buildQueryForGeocode(region, district, settlement);

    try {
      const r = await fetch("/api/geocode?q=" + encodeURIComponent(q));
      const j = await r.json();

      if (!j.ok) {
        const wiki = j.wiki || buildWikiLink(settlement);
        setAddStatus("Координаты не найдены");
        els.add_result.innerHTML =
          `Не нашёл координаты по запросу: <code>${esc(q)}</code><br>` +
          `Открой Википедию и возьми координаты: <a target="_blank" href="${esc(wiki)}">${esc(wiki)}</a>`;
        return;
      }

      const lat = j.lat, lon = j.lon;
      const comment = ""; // по требованию: без комментариев

      LAST_ADD_ROW = { region, district, settlement, lat, lon, question, unit1, unit2, comment };
      setAddStatus("Готово: координаты найдены");
      els.add_send.disabled = false;

      els.add_result.innerHTML =
        `Найдено: <b>${esc(j.display_name || "")}</b><br>` +
        `Координаты: <code>${lat.toFixed(6)}, ${lon.toFixed(6)}</code>`;

      // небольшая визуализация на карте
      const tmp = L.circleMarker([lat, lon], { radius: 7, color: "#0a0", fillOpacity: 0.5 }).addTo(map);
      setTimeout(() => { try { tmp.remove(); } catch(e){} }, 8000);
      map.setView([lat, lon], 11);

    } catch (e) {
      setAddStatus("Ошибка геокодирования");
      els.add_result.textContent = String(e);
    }
  }

  async function sendAdd() {
    if (!LAST_ADD_ROW) return;

    setAddStatus("Добавляю...");
    const row = LAST_ADD_ROW;

    // Если настроен Apps Script URL — отправляем туда.
    if (CFG.SHEET_APPEND_URL) {
      try {
        const r = await fetch(CFG.SHEET_APPEND_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(row)
        });
        const j = await r.json().catch(() => ({}));
        if (j && j.ok) {
          setAddStatus("Добавлено в таблицу");
          els.add_result.innerHTML = "Запись добавлена.";
          return;
        }
        setAddStatus("Не удалось добавить автоматически");
        els.add_result.textContent = "Ответ сервера: " + JSON.stringify(j);
      } catch (e) {
        setAddStatus("Ошибка отправки");
        els.add_result.textContent = String(e);
      }
      return;
    }

    // Иначе: копируем строку и открываем таблицу
    const values = [
      row.region, row.district, row.settlement,
      row.lat, row.lon, row.question, row.unit1, row.unit2, row.comment
    ];

    // CSV-строка с экранированием
    const csv = values.map(v => {
      const s = (v ?? "").toString();
      if (s.includes('"') || s.includes(",") || s.includes("\n")) {
        return '"' + s.replaceAll('"', '""') + '"';
      }
      return s;
    }).join(",");

    try {
      await navigator.clipboard.writeText(csv);
      setAddStatus("Скопировано");
      els.add_result.innerHTML =
        `Скопировал строку CSV в буфер обмена.<br>` +
        `Открой таблицу и вставь новой строкой:<br>` +
        `<a target="_blank" href="${esc(CFG.SHEET_EDIT_URL || "#")}">${esc(CFG.SHEET_EDIT_URL || "")}</a><br>` +
        `<div class="mono" style="margin-top:8px;white-space:pre-wrap;">${esc(csv)}</div>`;
      if (CFG.SHEET_EDIT_URL) window.open(CFG.SHEET_EDIT_URL, "_blank");
    } catch (e) {
      setAddStatus("Не удалось скопировать автоматически");
      els.add_result.innerHTML =
        `Скопируй вручную и вставь в таблицу:<br>` +
        `<div class="mono" style="margin-top:8px;white-space:pre-wrap;">${esc(csv)}</div>`;
    }
  }

  els.add_prepare.onclick = prepareAdd;
  els.add_send.onclick = sendAdd;

  // старт
  loadBoundary();
  loadData();
})();
