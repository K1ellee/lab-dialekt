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

  const DEFAULT_VIEW = { center: [56.85, 53.20], zoom: 7 };

  const map = L.map("map", { scrollWheelZoom: true }).setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  const markersLayer = L.layerGroup().addTo(map);
  let boundaryLayer = null;

  let ALL = [];
  let LAST_ADD_ROW = null;

  function setStatus(s) { els.status.textContent = s || ""; }
  function setAddStatus(s) { els.add_status.textContent = s || ""; }

  function esc(s) {
    return (s ?? "").toString()
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
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
    const url = CFG.UDM_BOUNDARY_URL || "/api/boundary/udmurtia";
    try {
      const r = await fetch(url);
      if (!r.ok) return;
      const gj = await r.json();
      if (boundaryLayer) boundaryLayer.remove();
      boundaryLayer = L.geoJSON(gj, {
        style: { color: "#c00", weight: 2, fill: false, opacity: 0.8 }
      }).addTo(map);
    } catch (e) {
      console.warn("Boundary load failed:", e);
    }
  }

  async function loadData() {
    setStatus("Загружаю данные...");
    if (CFG.SHEET_EDIT_URL) {
      const edit = esc(CFG.SHEET_EDIT_URL);
      els.sheetLinks.innerHTML = `Таблица: <a target="_blank" href="${edit}">открыть для редактирования</a>`;
    }

    try {
      if (CFG.SHEET_CSV_URL) {
        const resp = await fetch(CFG.SHEET_CSV_URL, { cache: "no-store" });
        const csvText = await resp.text();
        const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
        ALL = (parsed.data || []).map(normalizeRow).filter(Boolean);
      } else {
        const r = await fetch("/static/data/sample_points.json");
        const j = await r.json();
        ALL = (Array.isArray(j) ? j : (j.points || [])).map(normalizeRow).filter(Boolean);
      }
      setStatus(`Загружено записей: ${ALL.length}`);
      initControlsFromData();
      render();
    } catch (e) {
      setStatus("Ошибка загрузки");
      console.error(e);
      alert("Не удалось загрузить данные.\n\n" + e);
    }
  }

  function initControlsFromData() {
    fillSelect(els.q, uniq(ALL.map(x => x.question)), "Все вопросы");
    fillSelect(els.region, uniq(ALL.map(x => x.region)), "Все регионы");
    fillSelect(els.district, [], "Все районы");
    fillSelect(els.settlement, [], "Все населённые пункты");
    fillSelect(els.unit1, [], "Все unit1");
    fillSelect(els.unit2, [], "Все unit2");

    fillDatalist(els.dlRegions, uniq(ALL.map(x => x.region)));
    fillDatalist(els.dlDistricts, uniq(ALL.map(x => x.district)));
    fillDatalist(els.dlSettlements, uniq(ALL.map(x => x.settlement)));
    fillDatalist(els.dlQuestions, uniq(ALL.map(x => x.question)));
    fillDatalist(els.dlUnit1, uniq(ALL.map(x => x.unit1)));
    fillDatalist(els.dlUnit2, uniq(ALL.map(x => x.unit2)));

    els.region.addEventListener("change", () => {
      const r = els.region.value;
      fillSelect(
        els.district,
        uniq(ALL.filter(x => !r || x.region === r).map(x => x.district)),
        "Все районы"
      );
      fillSelect(
        els.settlement,
        uniq(ALL.filter(x => (!r || x.region === r)).map(x => x.settlement)),
        "Все населённые пункты"
      );
    });

    els.district.addEventListener("change", () => {
      const r = els.region.value;
      const d = els.district.value;
      fillSelect(
        els.settlement,
        uniq(ALL.filter(x => (!r || x.region === r) && (!d || x.district === d)).map(x => x.settlement)),
        "Все населённые пункты"
      );
    });

    els.q.addEventListener("change", () => {
      const q = els.q.value;
      fillSelect(els.unit1, uniq(ALL.filter(x => !q || x.question === q).map(x => x.unit1)), "Все unit1");
      fillSelect(els.unit2, uniq(ALL.filter(x => !q || x.question === q).map(x => x.unit2)), "Все unit2");
    });

    els.apply.onclick = () => render();

    els.reset.onclick = () => {
      els.q.value = ""; els.unit1.value = ""; els.unit2.value = "";
      els.region.value = ""; els.district.value = ""; els.settlement.value = "";
      map.setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);
      render();
    };
  }

  function getFilteredRows() {
    const q = els.q.value, u1 = els.unit1.value, u2 = els.unit2.value;
    const r = els.region.value, d = els.district.value, s = els.settlement.value;

    return ALL.filter(x =>
      (!q || x.question === q) &&
      (!u1 || x.unit1 === u1) &&
      (!u2 || x.unit2 === u2) &&
      (!r || x.region === r) &&
      (!d || x.district === d) &&
      (!s || x.settlement === s)
    );
  }

  // Одна метка = один населённый пункт (ключ: region+district+settlement, но district может быть пустым)
  function groupBySettlement(rows) {
    const m = new Map();
    for (const x of rows) {
      const key = [
        (x.region || "").toLowerCase().trim(),
        (x.district || "").toLowerCase().trim(),
        (x.settlement || "").toLowerCase().trim()
      ].join("|||");

      if (!m.has(key)) {
        m.set(key, {
          region: x.region,
          district: x.district,
          settlement: x.settlement,
          lat: x.lat,
          lon: x.lon,
          items: []
        });
      }
      m.get(key).items.push(x);
    }

    const out = Array.from(m.values());
    for (const g of out) {
      g.items.sort((a,b) => (a.question || "").localeCompare((b.question || ""), "ru"));
    }
    out.sort((a,b) => (a.settlement || "").localeCompare((b.settlement || ""), "ru"));
    return out;
  }

  function popupHtmlForGroup(g) {
    let html = `<div style="min-width:280px;max-height:300px;overflow-y:auto;">`;
    html += `<div><b>${esc(g.settlement || "(без названия)")}</b></div>`;
    html += `<div class="small">${esc(g.region)}${g.district ? (", " + esc(g.district)) : ""}</div>`;
    html += `<hr style="margin:6px 0">`;

    for (let i = 0; i < g.items.length; i++) {
      const x = g.items[i];
      html += `<div style="margin-bottom:8px;">`;
      html += `<div><b>${i+1}. ${esc(x.question)}</b></div>`;
      html += `<div>Ответ 1: ${esc(x.unit1)}</div>`;
      html += `<div>Ответ 2: ${esc(x.unit2)}</div>`;
      html += `</div>`;
    }

    html += `</div>`;
    return html;
  }

  function popupHtmlSingle(x) {
    return (
      `<div style="min-width:240px">` +
      `<div><b>${esc(x.settlement || "")}</b></div>` +
      `<div class="small">${esc(x.region)}${x.district ? (", " + esc(x.district)) : ""}</div>` +
      `<hr style="margin:6px 0">` +
      `<div><b>${esc(x.question)}</b></div>` +
      `<div>Ответ 1: ${esc(x.unit1)}</div>` +
      `<div>Ответ 2: ${esc(x.unit2)}</div>` +
      `</div>`
    );
  }

  function render() {
    const rows = getFilteredRows();

    markersLayer.clearLayers();
    els.list.innerHTML = "";

    if (!rows.length) {
      setStatus(`Показано: 0 из ${ALL.length}`);
      els.list.innerHTML = '<div class="small">Нет результатов.</div>';
      return;
    }

    const groups = groupBySettlement(rows);
    setStatus(`Пунктов: ${groups.length} · Записей: ${rows.length} (всего: ${ALL.length})`);

    for (const g of groups) {
      const m = L.marker([g.lat, g.lon]).addTo(markersLayer);

      if (g.items.length === 1) m.bindPopup(popupHtmlSingle(g.items[0]));
      else m.bindPopup(popupHtmlForGroup(g));

      const row = document.createElement("div");
      row.className = "row";

      if (g.items.length === 1) {
        const x = g.items[0];
        row.innerHTML =
          `<div><b>${esc(x.settlement)}</b> — ${esc(x.question)}</div>` +
          `<div class="small">${esc(x.region)}${x.district ? (" · " + esc(x.district)) : ""} · ${esc(x.unit1)} / ${esc(x.unit2)}</div>`;
      } else {
        row.innerHTML =
          `<div><b>${esc(g.settlement)}</b> — ${g.items.length} вопрос(ов)</div>` +
          `<div class="small">${esc(g.region)}${g.district ? (" · " + esc(g.district)) : ""}</div>`;
      }

      row.onclick = () => { map.panTo([g.lat, g.lon]); m.openPopup(); };
      els.list.appendChild(row);
    }
  }

  async function prepareAdd() {
    setAddStatus("Ищу координаты...");
    els.add_result.innerHTML = "";
    els.add_send.disabled = true;

    const reg = els.add_region.value.trim();
    let dist = els.add_district.value.trim();       // <-- район можно не вводить
    const setl = els.add_settlement.value.trim();
    const ques = els.add_question.value.trim();
    const u1 = els.add_unit1.value.trim();
    const u2 = els.add_unit2.value.trim();          // unit2 необязателен

    if (!reg || !setl || !ques || !u1) {
      setAddStatus("Заполни: регион, населённый пункт, вопрос, unit1");
      return;
    }

    const query = [setl, dist, reg, "Россия"].filter(Boolean).join(", ");

    try {
      const r = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
      const j = await r.json();

      if (!j.ok) {
        const wiki = j.wiki || `https://ru.wikipedia.org/wiki/${encodeURIComponent(setl.replace(/ /g, "_"))}`;
        els.add_result.innerHTML = `Не нашел координаты. <a target="_blank" href="${wiki}">Открыть Википедию</a>`;
        setAddStatus("Координаты не найдены");
        return;
      }

      // <-- Автоподстановка района
      if (!dist && j.district) {
        dist = String(j.district).trim();
        els.add_district.value = dist;
      }

      LAST_ADD_ROW = {
        region: reg,
        district: dist,      // может быть пустым, но если нашли — подставили
        settlement: setl,
        lat: j.lat,
        lon: j.lon,
        question: ques,
        unit1: u1,
        unit2: u2,
        comment: ""
      };

      els.add_result.innerHTML =
        `Найдено: <b>${esc(j.display_name)}</b>` +
        (dist ? `<br>Район (авто): <b>${esc(dist)}</b>` : "") +
        `<br>Координаты: ${j.lat}, ${j.lon}`;

      els.add_send.disabled = false;
      setAddStatus("Готово");
    } catch (e) {
      setAddStatus("Ошибка связи");
      els.add_result.textContent = String(e);
    }
  }

  async function sendAdd() {
    if (!LAST_ADD_ROW) return;
    setAddStatus("Отправка...");
    try {
      const r = await fetch("/api/sheet_append", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(LAST_ADD_ROW)
      });
      const j = await r.json();

      if (j.ok) {
        setAddStatus("Успешно!");
        els.add_result.innerHTML = "Запись добавлена в таблицу.";
        LAST_ADD_ROW = null;
        els.add_send.disabled = true;
      } else {
        setAddStatus("Ошибка");
        els.add_result.textContent = (j.error || "Ошибка") + (j.details ? (": " + j.details) : "");
      }
    } catch (e) {
      setAddStatus("Ошибка");
      els.add_result.textContent = String(e);
    }
  }

  els.add_prepare.onclick = prepareAdd;
  els.add_send.onclick = sendAdd;

  loadBoundary();
  loadData();
})();
