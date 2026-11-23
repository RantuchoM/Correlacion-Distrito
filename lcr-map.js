window.mapLcrExportToReport = function mapLcrExportToReport(payload, options = {}) {
  const onlyConverts = options.onlyConverts !== false;
  const base = JSON.parse(JSON.stringify(window.DEFAULT_REPORT));

  const info = String(payload.unitInfo || "");
  const districtMatch = info.match(/Distrito\s+([^(]+)/i);
  if (districtMatch) {
    base.title = `Distrito ${districtMatch[1].trim().replace(/\s+Argentina$/i, "")}`;
  }

  const now = new Date();
  const months = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
  ];
  base.period = `${months[now.getMonth()]} ${now.getFullYear()}`;
  base.years = { previous: now.getFullYear() - 1, current: now.getFullYear() };

  const MONTHS_ES = {
    ene: 0, enero: 0,
    feb: 1, febrero: 1,
    mar: 2, marzo: 2,
    abr: 3, abril: 3,
    may: 4, mayo: 4,
    jun: 5, junio: 5,
    jul: 6, julio: 6,
    ago: 7, agosto: 7,
    sep: 8, sept: 8, septiembre: 8,
    oct: 9, octubre: 9,
    nov: 10, noviembre: 10,
    dic: 11, diciembre: 11,
  };

  function yearFromLooseDate(text) {
    const t = String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!t) return null;
    let m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (m) return m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    m = t.match(/^(\d{1,2})\s+([a-záéíóú.]+)\s+(\d{4})$/i);
    if (m && MONTHS_ES[m[2].replace(/\./g, "")] != null) return Number(m[3]);
    m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return Number(m[1]);
    m = t.match(/(20\d{2}|19\d{2})/);
    return m ? Number(m[1]) : null;
  }

  const sexLabel = (sex) => {
    const s = String(sex || "").trim().toUpperCase();
    if (s === "V" || s === "H" || s === "MALE") return "H";
    if (s === "M" || s === "F" || s === "FEMALE") return "M";
    return s;
  };

  base.units = (payload.units || []).map((unit) => {
    const members = (unit.members || [])
      .filter((m) => {
        if (!onlyConverts) return true;
        return /^s[ií]$/i.test(String(m.isConvert || "").trim());
      })
      .map((m) => {
        const age = String(m.age || "").trim();
        const hasCalling = Boolean(String(m.callings || "").trim());
        const hasTemple = Boolean(String(m.templeDate || "").trim());

        return {
          name: m.name,
          baptism: String(m.confirmationDate || m.baptism || "").trim(),
          age,
          sex: sexLabel(m.sex),
          attendance: String(m.attendance || "").trim(),
          temple: m.temple
            ? String(m.temple).trim()
            : hasTemple
              ? "Sí"
              : Number(age) < 12
                ? "N/A"
                : "No",
          calling: m.calling
            ? String(m.calling).trim()
            : hasCalling
              ? "Sí"
              : "No",
          assignment: String(m.assignment || "").trim(),
          report: String(m.report || "").trim(),
          dato: String(m.dato || m.note || "").trim(),
        };
      });

    return { name: unit.name, members };
  });

  // Contar confirmaciones por año real (antes: todo iba a "curr").
  const prevY = base.years.previous;
  const currY = base.years.current;
  base.baptisms = base.units.map((u) => {
    let prev = 0;
    let curr = 0;
    for (const m of u.members) {
      const y = yearFromLooseDate(m.baptism);
      if (y === prevY) prev += 1;
      else if (y === currY) curr += 1;
    }
    return {
      unit: u.name.replace(/^Rama\s+/i, ""),
      prev,
      curr,
    };
  });

  base.summaryUnits = base.units.map((u) => u.name.replace(/^Rama\s+/i, ""));
  while (base.summaryUnits.length < 4) base.summaryUnits.push("—");
  base.summaryUnits = base.summaryUnits.slice(0, 4);
  // summary (reuniones/personas) se fusiona en app.js para no perder tildes/nombres
  base.summaryRows = [];
  if (window.CorrelacionSummary) {
    window.CorrelacionSummary.ensureSummary(base);
  }

  base.upcoming = [];
  base._lcrMeta = {
    url: payload.url || "",
    scrapedAt: payload.scrapedAt || "",
    total: base.units.reduce((n, u) => n + u.members.length, 0),
  };

  return base;
};
