/**
 * Extrae asistencia sacramental de Miembros nuevos (Progress Record)
 * para las 4 ramas del Distrito Viedma y la exporta a Correlación.
 *
 * Usar en: https://lcr.churchofjesuschrist.org/one-work/progress-record?...
 */
(async function exportLcrAttendanceDistrict() {
  const DISTRICT = { name: "Distrito Viedma Argentina", unitNumber: "612502" };
  const UNITS = [
    { name: "Rama América", unitNumber: "322539" },
    { name: "Rama Carmen de Patagones", unitNumber: "287296" },
    { name: "Rama San Antonio Oeste", unitNumber: "313076" },
    { name: "Rama Viedma", unitNumber: "126802" },
  ];

  const APP_URLS = [
    "https://rantuchom.github.io/Correlacion-Distrito/#from-lcr-attendance",
    "http://127.0.0.1:8765/#from-lcr-attendance",
  ];

  function attendanceRatio(list) {
    const weeks = Array.isArray(list) ? list : [];
    if (!weeks.length) return "";
    const attended = weeks.filter((w) => w && w.attended === true).length;
    return `${attended}/${weeks.length}`;
  }

  function mapMember(m) {
    return {
      name: String(m.name || "").trim(),
      attendance: attendanceRatio(m.sacramentMeetingAttendanceList),
      weeksSinceLastAttendance: m.weeksSinceLastAttendance,
      memberSince: m.memberSinceDisplayString || "",
      isConvert: "Sí",
      personUuid: m.personUuid || "",
      cmisId: m.cmisId || "",
    };
  }

  async function fetchUnit(unit) {
    const url =
      `/api/report/one-work/progress-record/new-members?lang=spa&unitNumber=${unit.unitNumber}`;
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) {
      throw new Error(`${unit.name}: HTTP ${res.status}`);
    }
    const data = await res.json();
    const list = data.newMemberList || [];
    return {
      name: unit.name,
      unitNumber: unit.unitNumber,
      members: list.map(mapMember).filter((m) => m.name),
    };
  }

  if (!/lcr\.churchofjesuschrist\.org/i.test(location.hostname)) {
    alert(
      "Abrí primero Progreso de la senda de los convenios en LCR y volvé a usar el favorito."
    );
    return;
  }

  const units = [];
  const errors = [];
  for (const unit of UNITS) {
    try {
      units.push(await fetchUnit(unit));
    } catch (err) {
      errors.push(String(err.message || err));
    }
  }

  if (!units.length) {
    alert(
      "No se pudo leer ninguna rama.\n\n" +
        (errors.join("\n") || "¿Estás logueado en LCR?")
    );
    return;
  }

  const payload = {
    source: "lcr-progress-attendance",
    kind: "attendance",
    scrapedAt: new Date().toISOString(),
    url: location.href,
    unitInfo: DISTRICT.name,
    districtUnitNumber: DISTRICT.unitNumber,
    units,
    errors,
  };

  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "lcr-attendance.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);

  let copied = false;
  try {
    await navigator.clipboard.writeText(json);
    copied = true;
  } catch (_) {}

  const total = units.reduce((n, u) => n + u.members.length, 0);
  const withAtt = units.reduce(
    (n, u) => n + u.members.filter((m) => m.attendance).length,
    0
  );
  const summary =
    `Asistencia: ${units.length} ramas, ${total} miembros nuevos` +
    ` (${withAtt} con ratio).` +
    (copied ? "\nJSON copiado al portapapeles." : "") +
    "\nSe descargó lcr-attendance.json." +
    (errors.length ? `\nAvisos:\n- ${errors.join("\n- ")}` : "");

  const go = confirm(`${summary}\n\n¿Abrir Correlación para pegar la asistencia?`);
  if (go) {
    const preferLocal = /127\.0\.0\.1|localhost/i.test(location.hostname);
    window.open(preferLocal ? APP_URLS[1] : APP_URLS[0], "_blank");
  }
  return payload;
})();
