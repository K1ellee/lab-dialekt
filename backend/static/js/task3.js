(function(){
  const statusEl = document.getElementById("status");
  const qEl = document.getElementById("q");
  const unitEl = document.getElementById("unit");
  const admEl = document.getElementById("adm");
  const settEl = document.getElementById("sett");
  const listEl = document.getElementById("list");
  const linksEl = document.getElementById("sheetLinks");

  const CFG = window.APP_CONFIG || {};
  const SHEET_CSV_URL = (CFG.SHEET_CSV_URL || "").trim();
  const SHEET_EDIT_URL = (CFG.SHEET_EDIT_URL || "").trim();

  if (SHEET_EDIT_URL) {
    linksEl.innerHTML = `Таблица данных (редактирование): <a href="${SHEET_EDIT_URL}" target="_blank">открыть</a>`;
  } else {
    linksEl.textContent = "Таблица данных не подключена (используются примерные данные из проекта).";
  }

  // --- ВАЖНО: убираем лого Leaflet, но оставляем OSM attribution ---
  const map = L.map('map', { attributionControl: false }).setView([57.0, 53.2], 7);
  
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    // эту строку НЕ ставим, иначе Leaflet всё равно вставит свой логотип
    // attribution: '&copy; OpenStreetMap'
  }).addTo(map);
  
  // Добавляем атрибуцию OSM вручную (без лого Leaflet)
  L.control.attribution({ position: 'bottomright', prefix: false })
    .addAttribution('&copy; OpenStreetMap').addTo(map);

  let allRows = [];
  let markers = [];

  function clearMarkers(){
    markers.forEach(m => map.removeLayer(m));
    markers = [];
  }

  function norm(s){ return (s||"").toString().toLowerCase(); }

  function parseCSV(text){
    const lines = text.split(/\r?\n/).filter(l => l.trim().length>0);
    const header = lines[0].split(",").map(h=>h.trim());
    const rows = [];
    for (let i=1;i<lines.length;i++){
      const cols = lines[i].split(",");
      const obj = {};
      header.forEach((h,idx)=> obj[h]= (cols[idx]||"").trim());
      rows.push(obj);
    }
    return rows;
  }

  async function loadData(){
    statusEl.textContent = "Загружаю данные...";
    try {
      if (SHEET_CSV_URL) {
        const r = await fetch(SHEET_CSV_URL, {cache:"no-store"});
        const t = await r.text();
        const raw = parseCSV(t);

        allRows = raw.map(x => ({
          region: x.region || x["регион"] || x["Region"] || "",
          district: x.district || x["район"] || x["District"] || "",
          settlement: x.settlement || x["населенный пункт"] || x["settlement"] || "",
          lat: parseFloat(x.lat || x["широта"] || x["Lat"] || "0"),
          lon: parseFloat(x.lon || x["долгота"] || x["Lon"] || "0"),
          question: x.question || x["вопрос"] || x["Question"] || "",
          unit1: x.unit1 || x["единица1"] || x["linguistic unit 1"] || "",
          unit2: x.unit2 || x["единица2"] || x["linguistic unit 2"] || "",
          comment: x.comment || x["комментарий"] || ""
        })).filter(r => r.lat && r.lon && r.question);

        statusEl.textContent = "Данные загружены из таблицы.";
      } else {
        const r = await fetch("/static/data/sample_points.json", {cache:"no-store"});
        allRows = await r.json();
        statusEl.textContent = "Используются примерные данные (встроенные).";
      }
    } catch(e){
      statusEl.textContent = "Ошибка загрузки данных. Использую примерные.";
      const r = await fetch("/static/data/sample_points.json", {cache:"no-store"});
      allRows = await r.json();
    }

    buildQuestionList();
    render();
  }

  function buildQuestionList(){
    const qs = Array.from(new Set(allRows.map(r=>r.question))).sort();
    qEl.innerHTML = "";
    qs.forEach(q=>{
      const opt = document.createElement("option");
      opt.value = q; opt.textContent = q;
      qEl.appendChild(opt);
    });
  }

  function render(){
    clearMarkers();
    listEl.innerHTML = "";

    const q = qEl.value;
    const unit = norm(unitEl.value);
    const adm = norm(admEl.value);
    const sett = norm(settEl.value);

    const filtered = allRows.filter(r=>{
      if (q && r.question !== q) return false;
      if (unit && !norm(r.unit1).includes(unit) && !norm(r.unit2).includes(unit)) return false;
      const admStr = norm(r.region + " " + r.district);
      if (adm && !admStr.includes(adm)) return false;
      if (sett && !norm(r.settlement).includes(sett)) return false;
      return true;
    });

    filtered.forEach((r, idx)=>{
      const m = L.marker([r.lat, r.lon]).addTo(map);
      m.bindPopup(
        `<b>${r.settlement}</b><br>`+
        `${r.region}, ${r.district}<br>`+
        `<b>Вопрос:</b> ${r.question}<br>`+
        `<b>Unit1:</b> ${r.unit1}<br>`+
        `<b>Unit2:</b> ${r.unit2}<br>`+
        (r.comment ? `<b>Комментарий:</b> ${r.comment}` : "")
      );
      markers.push(m);

      const div = document.createElement("div");
      div.className = "list-item";
      div.textContent = `${r.settlement} — ${r.unit1} (${r.region}, ${r.district})`;
      div.onclick = ()=>{
        map.setView([r.lat, r.lon], 12);
        m.openPopup();
      };
      listEl.appendChild(div);
    });

    if (filtered.length > 0) {
      const group = L.featureGroup(markers);
      map.fitBounds(group.getBounds().pad(0.2));
    }
    statusEl.textContent = `Показано пунктов: ${filtered.length}`;
  }

  document.getElementById("apply").onclick = render;
  document.getElementById("reset").onclick = ()=>{
    unitEl.value=""; admEl.value=""; settEl.value="";
    render();
  };

  loadData();
})();