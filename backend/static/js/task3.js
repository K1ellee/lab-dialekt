(function () {
  const CFG = window.APP_CONFIG || {};
  const $ = (id) => document.getElementById(id);

  const els = {
    sheetLinks: $("sheetLinks"),
    status: $("status"),
    list: $("list"),

    q: $("q"),
    answers: $("answers"),
    region: $("region"),
    district: $("district"),
    settlement: $("settlement"),

    legendPinBase: $("legendPinBase"),
    legendPinMixed: $("legendPinMixed"),
    legendDynamic: $("legendDynamic"),

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

  map.createPane("areasPane");
  map.getPane("areasPane").style.zIndex = 350;

  map.createPane("boundaryPane");
  map.getPane("boundaryPane").style.zIndex = 450;

  const osmAttr = '&copy; <a target="_blank" rel="noopener" href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: osmAttr
  }).addTo(map);

  if (map.attributionControl && map.attributionControl.setPrefix) {
    map.attributionControl.setPrefix("");
  }

  const areasLayer = L.layerGroup().addTo(map);
  const markersLayer = L.layerGroup().addTo(map);
  let boundaryLayer = null;

  let ALL = [];
  let LAST_ADD_ROW = null;

  function setStatus(s) { if (els.status) els.status.textContent = s || ""; }
  function setAddStatus(s) { if (els.add_status) els.add_status.textContent = s || ""; }

  function esc(s) {
    return (s ?? "").toString()
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
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
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ru"));
  }

  function getSelectedValues(select) {
    if (!select) return [];
    return Array.from(select.selectedOptions || []).map(o => o.value).filter(Boolean);
  }

  function fillSelect(sel, values, emptyLabel, multiple = false, size = null) {
    if (!sel) return;
    sel.innerHTML = "";

    if (!multiple) {
      const first = document.createElement("option");
      first.value = "";
      first.textContent = emptyLabel || "— все —";
      sel.appendChild(first);
    }

    for (const v of values) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = v;
      sel.appendChild(o);
    }

    if (multiple && size) {
      sel.size = size;
    }
  }

  function fillDatalist(dl, values) {
    if (!dl) return;
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
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) return;
      const gj = await r.json();

      if (boundaryLayer) boundaryLayer.remove();

      boundaryLayer = L.geoJSON(gj, {
        pane: "boundaryPane",
        interactive: false,
        style: { color: "#c00", weight: 3, fill: false, opacity: 0.95 }
      }).addTo(map);

      boundaryLayer.bringToFront();
    } catch (e) {
      console.warn("Boundary load failed:", e);
    }
  }

  function pinSvg(color) {
    return `
<svg xmlns="http://www.w3.org/2000/svg" width="25" height="41" viewBox="0 0 25 41">
  <path d="M12.5 0C5.596 0 0 5.596 0 12.5C0 23.2 12.5 41 12.5 41C12.5 41 25 23.2 25 12.5C25 5.596 19.404 0 12.5 0Z"
        fill="${color}" stroke="#222" stroke-width="1"/>
  <circle cx="12.5" cy="12.5" r="5.2" fill="#fff" fill-opacity="0.92"/>
</svg>`.trim();
  }

  function pinDataUri(color) {
    return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(pinSvg(color));
  }

  function makePinIcon(color) {
    return L.icon({
      iconUrl: pinDataUri(color),
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [0, -34],
      shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      shadowSize: [41, 41],
      shadowAnchor: [12, 41]
    });
  }

  function answerKey(row) {
    const u = (row.unit1 || "").trim();
    if (u) return u;
    const u2 = (row.unit2 || "").trim();
    if (u2) return u2;
    return "(нет ответа)";
  }

  function hslToHex(h, s, l) {
    s /= 100;
    l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;

    if (0 <= h && h < 60) { r = c; g = x; b = 0; }
    else if (60 <= h && h < 120) { r = x; g = c; b = 0; }
    else if (120 <= h && h < 180) { r = 0; g = c; b = x; }
    else if (180 <= h && h < 240) { r = 0; g = x; b = c; }
    else if (240 <= h && h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }

    const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
    return "#" + toHex(r) + toHex(g) + toHex(b);
  }

  function hexToRgba(hex, a) {
    const h = hex.replace("#", "");
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  function buildColors(keys) {
    const n = Math.max(keys.length, 1);
    const map = {};
    for (let i = 0; i < keys.length; i++) {
      const h = Math.round((360 * i) / n);
      map[keys[i]] = hslToHex(h, 75, 45);
    }
    return map;
  }

  function renderLegendDynamic(keys, colorByKey, showAreas) {
    if (!els.legendDynamic) return;
    els.legendDynamic.innerHTML = "";
    if (!keys || !keys.length) return;

    const title = document.createElement("div");
    title.className = "small";
    title.innerHTML = "<b>Условные обозначения ответов:</b>";
    els.legendDynamic.appendChild(title);

    for (const k of keys) {
      const c = colorByKey[k] || "#377eb8";

      const row = document.createElement("div");
      row.className = "legend-item";

      const icons = document.createElement("span");
      icons.className = "legend-inline-icons";

      const img = document.createElement("img");
      img.className = "legend-pin-img";
      img.alt = "";
      img.src = pinDataUri(c);
      icons.appendChild(img);

      if (showAreas) {
        const sw = document.createElement("span");
        sw.className = "legend-area-swatch";
        sw.style.setProperty("--c", c);
        sw.style.setProperty("--bg", hexToRgba(c, 0.18));
        icons.appendChild(sw);
      }

      const label = document.createElement("span");
      label.className = "small";
      label.innerHTML = esc(k);

      row.appendChild(icons);
      row.appendChild(label);
      els.legendDynamic.appendChild(row);
    }
  }

  function popupHtmlForGroup(g) {
    let html = `<div style="min-width:280px;max-height:300px;overflow-y:auto;">`;
    html += `<div><b>${esc(g.settlement || "(без названия)")}</b></div>`;
    html += `<div class="small">${esc(g.region)}${g.district ? (", " + esc(g.district)) : ""}</div>`;
    html += `<hr style="margin:6px 0">`;

    for (let i = 0; i < g.items.length; i++) {
      const x = g.items[i];
      const answerText = [x.unit1, x.unit2].filter(Boolean).join(" / ");
      html += `<div style="margin-bottom:8px;">`;
      html += `<div><b>${i + 1}. ${esc(x.question)}</b></div>`;
      html += `<div>${esc(answerText)}</div>`;
      html += `</div>`;
    }

    html += `</div>`;
    return html;
  }

  function popupHtmlSingle(x) {
    const answerText = [x.unit1, x.unit2].filter(Boolean).join(" / ");
    return (
      `<div style="min-width:240px">` +
      `<div><b>${esc(x.settlement || "")}</b></div>` +
      `<div class="small">${esc(x.region)}${x.district ? (", " + esc(x.district)) : ""}</div>` +
      `<hr style="margin:6px 0">` +
      `<div><b>${esc(x.question)}</b></div>` +
      `<div>${esc(answerText)}</div>` +
      `</div>`
    );
  }

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
      g.items.sort((a, b) => (a.question || "").localeCompare((b.question || ""), "ru"));
    }
    out.sort((a, b) => (a.settlement || "").localeCompare((b.settlement || ""), "ru"));
    return out;
  }

  function buildAreas(rows, colorByKey, questionsSelected) {
    areasLayer.clearLayers();
    if (!questionsSelected.length || !window.turf) return;

    const by = new Map();

    for (const r of rows) {
      const key = answerKey(r);
      if (!by.has(key)) by.set(key, new Map());

      const placeKey = [
        (r.region || "").toLowerCase().trim(),
        (r.district || "").toLowerCase().trim(),
        (r.settlement || "").toLowerCase().trim()
      ].join("|||");

      by.get(key).set(placeKey, r);
    }

    for (const [k, places] of by.entries()) {
      const pts = Array.from(places.values());
      if (!pts.length) continue;

      const color = colorByKey[k] || "#377eb8";

      if (pts.length === 1) {
        const p = pts[0];
        L.circle([p.lat, p.lon], {
          pane: "areasPane",
          radius: 7000,
          color,
          weight: 2,
          fillColor: color,
          fillOpacity: 0.12
        }).addTo(areasLayer);
        continue;
      }

      if (pts.length === 2) {
        const coords = pts.map(p => [p.lon, p.lat]);
        const line = turf.lineString(coords);
        const poly = turf.buffer(line, 7, { units: "kilometers" });
        L.geoJSON(poly, {
          pane: "areasPane",
          style: { color, weight: 2, fillColor: color, fillOpacity: 0.12 }
        }).addTo(areasLayer);
        continue;
      }

      const fc = turf.featureCollection(pts.map(p => turf.point([p.lon, p.lat])));
      const hull = turf.convex(fc);
      if (!hull) continue;

      const buffered = turf.buffer(hull, 7, { units: "kilometers" });
      L.geoJSON(buffered, {
        pane: "areasPane",
        style: { color, weight: 2, fillColor: color, fillOpacity: 0.12 }
      }).addTo(areasLayer);
    }
  }

  function rowMatchesAnswers(row, selectedAnswers) {
    if (!selectedAnswers.length) return true;

    const vals = [(row.unit1 || "").trim(), (row.unit2 || "").trim()];
    return selectedAnswers.some(a => vals.includes(a));
  }

  function getFilteredRows() {
    const questions = getSelectedValues(els.q);
    const answers = getSelectedValues(els.answers);
    const r = els.region.value;
    const d = els.district.value;
    const s = els.settlement.value;

    return ALL.filter(x =>
      (!questions.length || questions.includes(x.question)) &&
      rowMatchesAnswers(x, answers) &&
      (!r || x.region === r) &&
      (!d || x.district === d) &&
      (!s || x.settlement === s)
    );
  }

  function render() {
    const rows = getFilteredRows();

    markersLayer.clearLayers();
    areasLayer.clearLayers();
    if (els.list) els.list.innerHTML = "";
    if (els.legendDynamic) els.legendDynamic.innerHTML = "";

    if (!rows.length) {
      setStatus(`Показано: 0 из ${ALL.length}`);
      if (els.list) els.list.innerHTML = '<div class="small">Нет результатов.</div>';
      if (boundaryLayer) boundaryLayer.bringToFront();
      return;
    }

    const questionsSelected = getSelectedValues(els.q);
    const keys = uniq(rows.map(answerKey));
    const colorByKey = buildColors(keys);

    renderLegendDynamic(keys, colorByKey, questionsSelected.length > 0);
    if (questionsSelected.length > 0) buildAreas(rows, colorByKey, questionsSelected);
    if (boundaryLayer) boundaryLayer.bringToFront();

    const groups = groupBySettlement(rows);
    setStatus(`Пунктов: ${groups.length} · Записей: ${rows.length} (всего: ${ALL.length})`);

    for (const g of groups) {
      let icon;

      if (questionsSelected.length > 0) {
        const set = new Set(g.items.map(answerKey));
        const one = (set.size === 1) ? Array.from(set)[0] : "(смеш.)";
        const color = (set.size === 1) ? (colorByKey[one] || "#377eb8") : "#222222";
        icon = makePinIcon(color);
      } else {
        icon = makePinIcon("#2A81CB");
      }

      const m = L.marker([g.lat, g.lon], { icon }).addTo(markersLayer);

      if (g.items.length === 1) m.bindPopup(popupHtmlSingle(g.items[0]));
      else m.bindPopup(popupHtmlForGroup(g));

      if (els.list) {
        for (const item of g.items) {
          const answerText = [item.unit1, item.unit2].filter(Boolean).join(" / ");
          const row = document.createElement("div");
          row.className = "row";
          row.innerHTML =
            `<div><b>${esc(item.settlement)}</b> — ${esc(item.question)} — ${esc(answerText)}</div>` +
            `<div class="small">${esc(item.region)}${item.district ? (" · " + esc(item.district)) : ""}</div>`;
          row.onclick = () => { map.panTo([g.lat, g.lon]); m.openPopup(); };
          els.list.appendChild(row);
        }
      }
    }
  }

  async function loadData() {
    setStatus("Загружаю данные...");

    if (CFG.SHEET_EDIT_URL && els.sheetLinks) {
      const edit = esc(CFG.SHEET_EDIT_URL);
      els.sheetLinks.innerHTML = `Таблица: <a target="_blank" href="${edit}">открыть для редактирования</a>`;
    }

    const resp = await fetch(CFG.SHEET_CSV_URL, { cache: "no-store" });
    const csvText = await resp.text();
    const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
    ALL = (parsed.data || []).map(normalizeRow).filter(Boolean);

    setStatus(`Загружено записей: ${ALL.length}`);
    initControlsFromData();
    render();
  }

  function initControlsFromData() {
    fillSelect(els.q, uniq(ALL.map(x => x.question)), "", true, 8);
    fillSelect(els.region, uniq(ALL.map(x => x.region)), "Все регионы");
    fillSelect(els.district, [], "Все районы");
    fillSelect(els.settlement, [], "Все населённые пункты");

    const allAnswers = uniq(ALL.flatMap(x => [x.unit1, x.unit2]).filter(Boolean));
    fillSelect(els.answers, allAnswers, "", true, 8);

    fillDatalist(els.dlRegions, uniq(ALL.map(x => x.region)));
    fillDatalist(els.dlDistricts, uniq(ALL.map(x => x.district)));
    fillDatalist(els.dlSettlements, uniq(ALL.map(x => x.settlement)));
    fillDatalist(els.dlQuestions, uniq(ALL.map(x => x.question)));
    fillDatalist(els.dlUnit1, uniq(ALL.map(x => x.unit1)));
    fillDatalist(els.dlUnit2, uniq(ALL.map(x => x.unit2)));

    if (els.region) {
      els.region.addEventListener("change", () => {
        const r = els.region.value;
        fillSelect(els.district, uniq(ALL.filter(x => !r || x.region === r).map(x => x.district)), "Все районы");
        fillSelect(els.settlement, uniq(ALL.filter(x => (!r || x.region === r)).map(x => x.settlement)), "Все населённые пункты");
      });
    }

    if (els.district) {
      els.district.addEventListener("change", () => {
        const r = els.region.value;
        const d = els.district.value;
        fillSelect(els.settlement, uniq(ALL.filter(x => (!r || x.region === r) && (!d || x.district === d)).map(x => x.settlement)), "Все населённые пункты");
      });
    }

    if (els.q) {
      els.q.addEventListener("change", () => {
        const questions = getSelectedValues(els.q);
        const answers = uniq(
          ALL
            .filter(x => !questions.length || questions.includes(x.question))
            .flatMap(x => [x.unit1, x.unit2])
            .filter(Boolean)
        );
        fillSelect(els.answers, answers, "", true, 8);
      });
    }

    if (els.apply) els.apply.onclick = () => render();

    if (els.reset) {
      els.reset.onclick = () => {
        Array.from(els.q.options).forEach(o => o.selected = false);
        Array.from(els.answers.options).forEach(o => o.selected = false);
        els.region.value = "";
        els.district.value = "";
        els.settlement.value = "";
        map.setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);
        render();
      };
    }
  }

  async function prepareAdd() {
    setAddStatus("Ищу координаты...");
    if (els.add_result) els.add_result.innerHTML = "";
    if (els.add_send) els.add_send.disabled = true;
    LAST_ADD_ROW = null;

    const reg = (els.add_region?.value || "").trim();
    let dist = (els.add_district?.value || "").trim();
    const setl = (els.add_settlement?.value || "").trim();
    const ques = (els.add_question?.value || "").trim();
    const u1 = (els.add_unit1?.value || "").trim();
    const u2 = (els.add_unit2?.value || "").trim();

    if (!reg || !setl || !ques || !u1) {
      setAddStatus("Заполни: регион, населённый пункт, вопрос, unit1");
      return;
    }

    const query = [setl, dist, reg, "Россия"].filter(Boolean).join(", ");
    const r = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
    const j = await r.json();

    if (!j.ok) {
      const wiki = j.wiki || `https://ru.wikipedia.org/wiki/${encodeURIComponent(setl.replace(/ /g, "_"))}`;
      if (els.add_result) els.add_result.innerHTML = `Не нашёл координаты. <a target="_blank" href="${wiki}">Открыть Википедию</a>`;
      setAddStatus("Координаты не найдены");
      return;
    }

    if (!dist && j.district) {
      dist = String(j.district).trim();
      if (els.add_district) els.add_district.value = dist;
    }

    LAST_ADD_ROW = {
      region: reg,
      district: dist,
      settlement: setl,
      lat: j.lat,
      lon: j.lon,
      question: ques,
      unit1: u1,
      unit2: u2,
      comment: ""
    };

    if (els.add_result) {
      els.add_result.innerHTML =
        `Найдено: <b>${esc(j.display_name || "")}</b>` +
        (dist ? `<br>Район: <b>${esc(dist)}</b>` : "") +
        `<br>Координаты: ${j.lat}, ${j.lon}`;
    }

    if (els.add_send) els.add_send.disabled = false;
    setAddStatus("Готово");
  }

  async function sendAdd() {
    if (!LAST_ADD_ROW) return;

    setAddStatus("Отправка...");
    if (els.add_send) els.add_send.disabled = true;

    const r = await fetch("/api/sheet_append", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(LAST_ADD_ROW)
    });

    const j = await r.json().catch(() => ({}));

    if (j.ok) {
      setAddStatus("Успешно!");
      if (els.add_result) els.add_result.innerHTML = "Запись добавлена в таблицу.";
      LAST_ADD_ROW = null;
      setTimeout(() => loadData().catch(() => {}), 1500);
      return;
    }

    setAddStatus("Ошибка");
    if (els.add_result) {
      els.add_result.textContent = (j.error || "Ошибка") + (j.details ? (": " + j.details) : "");
    }
    if (els.add_send) els.add_send.disabled = false;
  }

  if (els.legendPinBase) {
    const img = document.createElement("img");
    img.className = "legend-pin-img";
    img.alt = "";
    img.src = pinDataUri("#2A81CB");
    els.legendPinBase.appendChild(img);
  }

  if (els.legendPinMixed) {
    const img = document.createElement("img");
    img.className = "legend-pin-img";
    img.alt = "";
    img.src = pinDataUri("#222222");
    els.legendPinMixed.appendChild(img);
  }

  if (els.add_prepare) {
    els.add_prepare.onclick = () => prepareAdd().catch(e => {
      setAddStatus("Ошибка");
      if (els.add_result) els.add_result.textContent = String(e);
    });
  }

  if (els.add_send) {
    els.add_send.onclick = () => sendAdd().catch(e => {
      setAddStatus("Ошибка");
      if (els.add_result) els.add_result.textContent = String(e);
    });
  }

  loadBoundary();
  loadData().catch(e => {
    setStatus("Ошибка загрузки");
    console.error(e);
  });
})();
