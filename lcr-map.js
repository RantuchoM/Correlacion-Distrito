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

  base.baptisms = base.units.map((u) => ({
    unit: u.name.replace(/^Rama\s+/i, ""),
    prev: 0,
    curr: u.members.length,
  }));

  base.summaryUnits = base.units.map((u) => u.name.replace(/^Rama\s+/i, ""));
  while (base.summaryUnits.length < 4) base.summaryUnits.push("—");
  base.summaryUnits = base.summaryUnits.slice(0, 4);
  base.summaryRows = base.summaryRows.map((row) => ({
    label: row.label,
    values: base.summaryUnits.map(() =>
      row.label === "Misioneros de rama" ? "0" : "Pendiente"
    ),
  }));

  base.upcoming = [];
  base._lcrMeta = {
    url: payload.url || "",
    scrapedAt: payload.scrapedAt || "",
    total: base.units.reduce((n, u) => n + u.members.length, 0),
  };

  return base;
};
