(() => {
  const STORAGE_KEY = "correlacion-distrito-v2";
  const SHEETS_CFG_KEY = "correlacion-distrito-sheets-cfg";
  /** Endpoint compartido: todas las vistas leen/escriben el mismo Sheets. */
  const DEFAULT_SHEETS_CFG = {
    url: "https://script.google.com/macros/s/AKfycbzuuhippetrKZWYCnlHxPnbXTmZnSUr0NMu0xKgp9ibyZNJfgiBzEqyvQ_mhlLOBJQY/exec",
    token: "cd-viedma-mR7k9x2",
    autosave: true,
  };

  const els = {
    report: document.getElementById("report"),
    baptismsEditor: document.getElementById("baptismsEditor"),
    goalsEditor: document.getElementById("goalsEditor"),
    unitsEditor: document.getElementById("unitsEditor"),
    summaryEditor: document.getElementById("summaryEditor"),
    metaTitle: document.getElementById("metaTitle"),
    metaPeriod: document.getElementById("metaPeriod"),
    status: document.getElementById("status"),
    app: document.querySelector(".app"),
    sheetsUrl: document.getElementById("sheetsUrl"),
    sheetsToken: document.getElementById("sheetsToken"),
    sheetsAutosave: document.getElementById("sheetsAutosave"),
    sheetsLoadOnOpen: document.getElementById("sheetsLoadOnOpen"),
    sheetsStatus: document.getElementById("sheetsStatus"),
  };

  let state = loadState();
  let sheetsSaveTimer = null;
  let sheetsSaving = false;
  let suppressSheetsSave = false;
  let accessCfg = window.CorrelacionSummary
    ? window.CorrelacionSummary.loadAccess()
    : null;
  let session =
    (window.CorrelacionSummary && window.CorrelacionSummary.loadSession()) ||
    null;

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function clearLocalReportCache() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(SHEETS_CFG_KEY);
    } catch (_) {}
  }

  /** Solo placeholder en memoria hasta que llegue Sheets. No usa localStorage. */
  function loadState() {
    clearLocalReportCache();
    const report = clone(window.DEFAULT_REPORT);
    report._seedDefault = true;
    if (window.CorrelacionSummary) window.CorrelacionSummary.ensureSummary(report);
    return report;
  }

  function isSeedDefaultReport(report = state) {
    return !!(report && report._seedDefault);
  }

  function canEdit() {
    return !!(session && session.canEdit);
  }

  function isRamaMode() {
    return session?.mode === "rama" && !!session.rama;
  }

  function visibleSummaryUnits() {
    const units = state.summaryUnits || [];
    if (isRamaMode()) {
      const S = window.CorrelacionSummary;
      return units.filter((u) => S.normUnit(u) === S.normUnit(session.rama));
    }
    return units;
  }

  function visibleUnits() {
    if (!isRamaMode()) return state.units || [];
    const S = window.CorrelacionSummary;
    return (state.units || []).filter(
      (u) => S.normUnit(u.name) === S.normUnit(session.rama)
    );
  }

  /** Bautismos del año: en enlace de rama, solo esa unidad. */
  function visibleBaptisms() {
    const all = state.baptisms || [];
    if (!isRamaMode()) return all;
    const S = window.CorrelacionSummary;
    return all.filter((b) => S.normUnit(b.unit) === S.normUnit(session.rama));
  }

  function computeGoalDonesFromUnits(units, year) {
    const counts = Array(12).fill(0);
    for (const unit of units || []) {
      for (const m of unit.members || []) {
        const my = monthYearFromBaptism(m.baptism);
        if (!my || my.year !== year) continue;
        counts[my.month] += 1;
      }
    }
    return counts;
  }

  /** Metas mensuales por rama (separadas del distrito). */
  function ensureUnitGoals(ramaName) {
    if (!ramaName) return [];
    const S = window.CorrelacionSummary;
    if (!state.unitGoals) state.unitGoals = {};
    const short = S.shortUnit(ramaName);
    const existingKey = Object.keys(state.unitGoals).find(
      (k) => S.normUnit(k) === S.normUnit(ramaName)
    );
    const existing = existingKey ? state.unitGoals[existingKey] : null;
    const prevByIdx = new Map();
    for (const g of existing || []) {
      const idx = g.monthIndex != null ? Number(g.monthIndex) : monthKey(g.month);
      if (idx < 0 || idx > 11) continue;
      prevByIdx.set(idx, g);
    }
    // Primera vez: heredar metas del distrito como punto de partida
    if (!existing?.length) {
      for (const g of state.goals || []) {
        const idx = g.monthIndex != null ? Number(g.monthIndex) : monthKey(g.month);
        if (idx < 0 || idx > 11) continue;
        if (!prevByIdx.has(idx)) prevByIdx.set(idx, g);
      }
    }
    const currY = state.years?.current ?? new Date().getFullYear();
    const list = MONTH_NAMES.map((month, i) => {
      const prev = prevByIdx.get(i);
      const goalNum = prev?.goal;
      return {
        month,
        monthIndex: i,
        year: currY,
        done: 0,
        goal: goalNum == null || goalNum === "" ? 10 : Number(goalNum) || 0,
      };
    });
    if (existingKey && existingKey !== short) delete state.unitGoals[existingKey];
    state.unitGoals[short] = list;
    return list;
  }

  /** Modelo de metas para la vista actual (distrito o rama del enlace). */
  function goalsForDisplay() {
    ensureGoalsForCurrentYear(state);
    const currY = state.years?.current ?? new Date().getFullYear();
    const dones = computeGoalDonesFromUnits(visibleUnits(), currY);
    const source = isRamaMode()
      ? ensureUnitGoals(session.rama)
      : state.goals || [];
    return source.map((g, i) => {
      const idx = g.monthIndex != null ? g.monthIndex : i;
      return {
        month: g.month || MONTH_NAMES[idx],
        monthIndex: idx,
        done: dones[idx] || 0,
        goal: Number(g.goal) || 0,
        index: i,
      };
    });
  }

  function saveState() {
    // Fuente de verdad: Google Sheets (nada de informe en localStorage).
    clearLocalReportCache();
    scheduleSheetsSave();
  }

  function setStatus(msg) {
    els.status.textContent = msg || "";
  }

  function setImportStatus(msg) {
    const el = document.getElementById("importStatus");
    if (el) el.textContent = msg || "";
  }

  function setSheetsStatus(msg) {
    if (els.sheetsStatus) els.sheetsStatus.textContent = msg || "";
  }

  function loadSheetsCfg() {
    // URL/token embebidos: no depender de config local que desincronice vistas.
    return { ...DEFAULT_SHEETS_CFG };
  }

  function saveSheetsCfg(partial) {
    return { ...loadSheetsCfg(), ...partial };
  }

  function getSheetsCfgFromUi() {
    return {
      url:
        String(els.sheetsUrl?.value || "").trim().replace(/\/$/, "") ||
        DEFAULT_SHEETS_CFG.url,
      token: String(els.sheetsToken?.value || "").trim() || DEFAULT_SHEETS_CFG.token,
      autosave: els.sheetsAutosave?.checked !== false,
    };
  }

  function applySheetsCfgToUi(cfg) {
    if (els.sheetsUrl && cfg.url != null) els.sheetsUrl.value = cfg.url;
    if (els.sheetsToken && cfg.token != null) els.sheetsToken.value = cfg.token;
    if (els.sheetsAutosave && cfg.autosave != null) els.sheetsAutosave.checked = !!cfg.autosave;
  }

  function sheetsConfigured(cfg = getSheetsCfgFromUi()) {
    return Boolean(cfg.url && cfg.token);
  }

  async function sheetsRequest({ method = "GET", action = "load", body } = {}) {
    const cfg = getSheetsCfgFromUi();
    if (!cfg.url || !cfg.token) {
      throw new Error("Completá URL y token de Apps Script.");
    }

    if (method === "GET") {
      const u = new URL(cfg.url);
      u.searchParams.set("token", cfg.token);
      u.searchParams.set("action", action);
      const res = await fetch(u.toString(), { method: "GET", redirect: "follow" });
      const data = await res.json();
      if (!data?.ok) throw new Error(data?.error || `Error HTTP ${res.status}`);
      return data;
    }

    const payload = JSON.stringify({
      token: cfg.token,
      action,
      ...(body || {}),
    });
    const res = await fetch(cfg.url, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: payload,
    });
    const data = await res.json();
    if (!data?.ok) throw new Error(data?.error || `Error HTTP ${res.status}`);
    return data;
  }

  async function saveToSheets({ silent = false, allowWithoutEdit = false } = {}) {
    if (!sheetsConfigured()) {
      if (!silent) setSheetsStatus("Configurá URL y token para guardar en Sheets.");
      return false;
    }
    // Nunca subir el placeholder de ejemplo: pisaría el informe real del distrito.
    if (isSeedDefaultReport(state)) {
      if (!silent) setSheetsStatus("Todavía no hay informe real para guardar (esperá a Sheets).");
      return false;
    }
    // Solo lectura: no escribe (salvo pegado explícito de asistencia Progress Record).
    if (!canEdit() && !allowWithoutEdit) {
      if (!silent) setSheetsStatus("Vista solo lectura: no se guarda en Sheets.");
      return false;
    }
    if (sheetsSaving) {
      scheduleSheetsSave(800);
      return false;
    }
    sheetsSaving = true;
    if (!silent) setSheetsStatus("Guardando en Sheets…");
    try {
      const report = clone(state);
      delete report._lcrMeta;
      delete report._seedDefault;
      const data = await sheetsRequest({
        method: "POST",
        action: "save",
        body: { report },
      });
      const when = data.savedAt
        ? new Date(data.savedAt).toLocaleString("es-AR")
        : new Date().toLocaleString("es-AR");
      setSheetsStatus(`Guardado en Sheets · ${when}`);
      return true;
    } catch (err) {
      setSheetsStatus(`No se pudo guardar: ${err.message || err}`);
      console.error(err);
      return false;
    } finally {
      sheetsSaving = false;
    }
  }

  function countFilledAttendance(report = state) {
    let n = 0;
    for (const unit of report?.units || []) {
      for (const member of unit.members || []) {
        if (String(member.attendance || "").trim()) n += 1;
      }
    }
    return n;
  }

  async function loadFromSheets() {
    if (!sheetsConfigured()) {
      setSheetsStatus("Configurá URL y token para cargar desde Sheets.");
      return false;
    }
    // Cancelá cualquier autosave pendiente del placeholder inicial.
    clearTimeout(sheetsSaveTimer);
    sheetsSaveTimer = null;
    setSheetsStatus("Cargando desde Sheets…");
    try {
      const data = await sheetsRequest({ method: "GET", action: "load" });
      if (!data.report || !Array.isArray(data.report.units)) {
        throw new Error("La hoja no devolvió un informe válido.");
      }
      state = data.report;
      // Si alguna vez se guardó el demo por error, no lo trates como “datos reales”.
      if (state._seedDefault) {
        console.warn("Sheets devolvió el informe de ejemplo (_seedDefault).");
      }
      delete state._seedDefault;
      syncAllAttendanceDisplays(state);
      recomputeBaptismsFromMembers(state);
      recomputeGoalDones(state);
      if (window.CorrelacionSummary) window.CorrelacionSummary.ensureSummary(state);
      suppressSheetsSave = true;
      try {
        clearLocalReportCache();
        refresh();
      } finally {
        suppressSheetsSave = false;
      }
      setSheetsStatus(
        `Cargado desde Sheets · ${state.units.length} unidades, ` +
          `${state.units.reduce((n, u) => n + (u.members || []).length, 0)} personas · ` +
          `${countFilledAttendance(state)} con asistencia.`
      );
      setStatus("Datos cargados desde Google Sheets.");
      return true;
    } catch (err) {
      setSheetsStatus(`No se pudo cargar: ${err.message || err}`);
      console.error(err);
      return false;
    }
  }

  function scheduleSheetsSave(delayMs = 1200) {
    if (suppressSheetsSave) return;
    if (isSeedDefaultReport(state)) return;
    if (!canEdit()) return;
    const cfg = getSheetsCfgFromUi();
    if (!cfg.autosave || !sheetsConfigured(cfg)) return;
    clearTimeout(sheetsSaveTimer);
    sheetsSaveTimer = setTimeout(() => {
      saveToSheets({ silent: true });
    }, delayMs);
  }

  function normName(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLocaleLowerCase("es");
  }

  /** Clave estable para "Apellido, Nombre" vs "Nombre Apellido". */
  function nameMatchKey(value) {
    const n = normName(value).replace(/,/g, " ");
    const tokens = n.split(/\s+/).filter(Boolean).sort();
    return tokens.join(" ");
  }

  function indexMembersForMerge(units) {
    const byUnitName = new Map();
    const byName = new Map();
    for (const unit of units || []) {
      for (const member of unit.members || []) {
        const nameKey = normName(member.name);
        if (!nameKey) continue;
        byUnitName.set(`${normName(unit.name)}::${nameKey}`, member);
        byName.set(nameKey, member);
      }
    }
    return { byUnitName, byName };
  }

  function indexMembersByMatchKey(units) {
    const byUnitKey = new Map();
    const byKey = new Map();
    const unitKey = (name) =>
      window.CorrelacionSummary
        ? window.CorrelacionSummary.normUnit(name)
        : normName(name);
    for (const unit of units || []) {
      for (const member of unit.members || []) {
        const key = nameMatchKey(member.name);
        if (!key) continue;
        byUnitKey.set(`${unitKey(unit.name)}::${key}`, member);
        byKey.set(key, member);
      }
    }
    return { byUnitKey, byKey };
  }

  function isAttendancePayload(payload) {
    return (
      payload &&
      (payload.kind === "attendance" ||
        payload.source === "lcr-progress-attendance")
    );
  }

  /** Últimos N domingos (incluye el próximo / el de hoy si es domingo), como LCR. */
  function lastNSundayKeys(n = 6, from = new Date()) {
    const d = new Date(
      Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())
    );
    const day = d.getUTCDay();
    const add = day === 0 ? 0 : 7 - day;
    d.setUTCDate(d.getUTCDate() + add);
    const out = [];
    for (let i = 0; i < n; i += 1) {
      const x = new Date(d.getTime());
      x.setUTCDate(d.getUTCDate() - i * 7);
      out.push(x.toISOString().slice(0, 10));
    }
    return out;
  }

  function attendanceRatioFromLog(byDate, n = 6) {
    const weeks = lastNSundayKeys(n);
    let done = 0;
    for (const iso of weeks) {
      if (byDate && byDate[iso] === true) done += 1;
    }
    return `${done}/${n}`;
  }

  function syncMemberAttendanceDisplay(member) {
    if (!member) return member;
    if (
      member.attendanceByDate &&
      typeof member.attendanceByDate === "object" &&
      Object.keys(member.attendanceByDate).length
    ) {
      member.attendance = attendanceRatioFromLog(member.attendanceByDate, 6);
    }
    return member;
  }

  function syncAllAttendanceDisplays(report = state) {
    for (const unit of report?.units || []) {
      for (const member of unit.members || []) {
        syncMemberAttendanceDisplay(member);
      }
    }
    return report;
  }

  /**
   * Aplica asistencia (Progress Record) sobre el informe actual.
   * Si vienen semanas fechadas, acumula en attendanceByDate (LCR pisa esos domingos).
   * Si solo viene ratio legacy (5/6), reemplaza el texto como antes.
   */
  function applyAttendanceOverlay(payload) {
    if (!isAttendancePayload(payload)) {
      throw new Error("JSON inválido: no es un export de asistencia.");
    }
    if (!state?.units?.length) {
      throw new Error(
        "No hay informe cargado. Importá primero el CSV/JSON de miembros y después la asistencia."
      );
    }

    const { byUnitKey, byKey } = indexMembersByMatchKey(state.units);
    let matched = 0;
    let updated = 0;
    let weekWrites = 0;
    const unmatched = [];

    for (const unit of payload.units || []) {
      for (const incoming of unit.members || []) {
        const key = nameMatchKey(incoming.name);
        if (!key) continue;
        const weeks = Array.isArray(incoming.weeks) ? incoming.weeks : [];
        const att = String(incoming.attendance || "").trim();
        if (!weeks.length && !att) continue;
        const unitKey = window.CorrelacionSummary
          ? window.CorrelacionSummary.normUnit(unit.name)
          : normName(unit.name);
        const target =
          byUnitKey.get(`${unitKey}::${key}`) || byKey.get(key);
        if (!target) {
          unmatched.push(`${unit.name}: ${incoming.name}`);
          continue;
        }
        matched += 1;
        let changed = false;

        if (weeks.length) {
          if (!target.attendanceByDate || typeof target.attendanceByDate !== "object") {
            target.attendanceByDate = {};
          }
          for (const w of weeks) {
            const iso = String(w?.date || "").trim().slice(0, 10);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;
            const next = !!w.attended;
            if (target.attendanceByDate[iso] !== next) {
              target.attendanceByDate[iso] = next;
              changed = true;
            }
            weekWrites += 1;
          }
          const prevRatio = String(target.attendance || "").trim();
          syncMemberAttendanceDisplay(target);
          if (prevRatio !== String(target.attendance || "").trim()) changed = true;
        } else if (att && String(target.attendance || "").trim() !== att) {
          target.attendance = att;
          changed = true;
        }

        if (changed) updated += 1;
      }
    }

    // Pintá sin depender del autosave (que en solo lectura no corre).
    suppressSheetsSave = true;
    try {
      refresh();
    } finally {
      suppressSheetsSave = false;
    }
    // Persistí sí o sí: el pegado de asistencia es una escritura intencional.
    clearTimeout(sheetsSaveTimer);
    sheetsSaveTimer = null;
    saveToSheets({ silent: false, allowWithoutEdit: true });
    const missNote =
      unmatched.length > 0
        ? ` · ${unmatched.length} sin match` +
          (unmatched.length <= 5 ? ` (${unmatched.join("; ")})` : "")
        : "";
    const weekNote = weekWrites ? ` · ${weekWrites} celdas domingo` : "";
    setImportStatus(
      `Asistencia aplicada: ${updated} actualizados, ${matched} encontrados` +
        weekNote +
        missNote +
        "."
    );
    setStatus("Asistencia de LCR fusionada (acumulable por domingo).");
    return { matched, updated, unmatched, weekWrites };
  }

  // Campos que el usuario edita a mano: se conservan al reimportar LCR/CSV.
  const HAND_FIELDS = ["attendance", "assignment", "report", "dato"];

  function mergeHandFieldsByName(previousUnits, nextReport) {
    if (!previousUnits?.length || !nextReport?.units?.length) return nextReport;
    const { byUnitName, byName } = indexMembersForMerge(previousUnits);
    let kept = 0;

    for (const unit of nextReport.units) {
      for (const member of unit.members || []) {
        const nameKey = normName(member.name);
        if (!nameKey) continue;
        const prev =
          byUnitName.get(`${normName(unit.name)}::${nameKey}`) ||
          byName.get(nameKey);
        if (!prev) continue;

        let touched = false;
        for (const field of HAND_FIELDS) {
          const incoming = String(member[field] ?? "").trim();
          const previous = String(prev[field] ?? "").trim();
          if (!incoming && previous) {
            member[field] = prev[field];
            touched = true;
          }
        }
        if (
          prev.attendanceByDate &&
          typeof prev.attendanceByDate === "object" &&
          Object.keys(prev.attendanceByDate).length
        ) {
          member.attendanceByDate = {
            ...(member.attendanceByDate || {}),
            ...prev.attendanceByDate,
          };
          syncMemberAttendanceDisplay(member);
          touched = true;
        }
        if (touched) kept += 1;
      }
    }

    nextReport._mergeMeta = { kept };
    return nextReport;
  }

  function yearFromMemberBaptism(text) {
    const ts = parseLooseDate(text);
    if (ts == null) {
      const m = String(text || "").match(/(20\d{2}|19\d{2})/);
      return m ? Number(m[1]) : null;
    }
    return new Date(ts).getUTCFullYear();
  }

  /** Recalcula bautismos prev/curr según fecha de confirmación de cada miembro. */
  function recomputeBaptismsFromMembers(report = state) {
    if (!report?.units) return report;
    const prevY = report.years?.previous ?? new Date().getFullYear() - 1;
    const currY = report.years?.current ?? new Date().getFullYear();
    report.years = { previous: prevY, current: currY };
    report.baptisms = report.units.map((u) => {
      let prev = 0;
      let curr = 0;
      for (const m of u.members || []) {
        const y = yearFromMemberBaptism(m.baptism);
        if (y === prevY) prev += 1;
        else if (y === currY) curr += 1;
      }
      return {
        unit: String(u.name || "").replace(/^Rama\s+/i, ""),
        prev,
        curr,
      };
    });
    return report;
  }

  const MONTH_NAMES = [
    "Enero",
    "Febrero",
    "Marzo",
    "Abril",
    "Mayo",
    "Junio",
    "Julio",
    "Agosto",
    "Septiembre",
    "Octubre",
    "Noviembre",
    "Diciembre",
  ];

  function monthKey(name) {
    const n = normName(name).slice(0, 3);
    const idx = MONTH_NAMES.findIndex((m) => normName(m).startsWith(n));
    return idx >= 0 ? idx : -1;
  }

  function monthYearFromBaptism(text) {
    const ts = parseLooseDate(text);
    if (ts == null) return null;
    const d = new Date(ts);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
  }

  /**
   * Asegura 12 meses del año actual (para que el mes en curso y los futuros
   * existan y se puedan editar las metas). Conserva goals ya cargados.
   */
  function ensureGoalsForCurrentYear(report = state) {
    if (!report) return report;
    const currY = report.years?.current ?? new Date().getFullYear();
    const prevByIdx = new Map();
    for (const g of report.goals || []) {
      const idx = g.monthIndex != null ? Number(g.monthIndex) : monthKey(g.month);
      if (idx < 0 || idx > 11) continue;
      prevByIdx.set(idx, g);
    }
    report.goals = MONTH_NAMES.map((month, i) => {
      const prev = prevByIdx.get(i);
      const goalNum = prev?.goal;
      return {
        month,
        monthIndex: i,
        year: currY,
        done: 0,
        goal:
          goalNum == null || goalNum === ""
            ? 10
            : Number(goalNum) || 0,
      };
    });
    return report;
  }

  /** done = confirmaciones del mes (año del informe) — siempre a nivel distrito. */
  function recomputeGoalDones(report = state) {
    if (!report) return report;
    ensureGoalsForCurrentYear(report);
    const currY = report.years.current;
    const counts = computeGoalDonesFromUnits(report.units || [], currY);
    for (const g of report.goals) {
      g.done = counts[g.monthIndex] || 0;
    }
    return report;
  }

  function applyLcrPayload(payload, { skipHandMerge = false } = {}) {
    if (!payload || !payload.units) {
      throw new Error("JSON inválido: no hay unidades.");
    }
    const onlyConverts = document.getElementById("onlyConverts")?.checked !== false;
    const previousUnits = clone(state?.units || []);
    const skipMerge = skipHandMerge || isSeedDefaultReport(state);
    let next = window.mapLcrExportToReport(payload, { onlyConverts });
    if (!skipMerge) next = mergeHandFieldsByName(previousUnits, next);
    // Conservar metas mensuales y resumen (tildes / personas) al reimportar
    if (!skipMerge && previousUnits?.length && state?.goals?.length) {
      next.goals = clone(state.goals);
    }
    if (!skipMerge && state?.unitGoals) next.unitGoals = clone(state.unitGoals);
    if (!skipMerge && state?.summary) next.summary = clone(state.summary);
    if (state?.summaryUnits?.length) {
      // mantener columnas de resumen alineadas a unidades nuevas
      next.summaryUnits = next.units.map((u) =>
        String(u.name || "").replace(/^Rama\s+/i, "")
      );
    }
    delete next._seedDefault;
    if (window.CorrelacionSummary) window.CorrelacionSummary.ensureSummary(next);
    recomputeBaptismsFromMembers(next);
    recomputeGoalDones(next);
    state = next;
    refresh();
    const total = state._lcrMeta?.total ?? 0;
    const kept = state._mergeMeta?.kept || 0;
    const bap = state.baptisms.reduce(
      (a, b) => ({ prev: a.prev + b.prev, curr: a.curr + b.curr }),
      { prev: 0, curr: 0 }
    );
    setImportStatus(
      `Importado: ${state.units.length} unidades, ${total} personas` +
        (onlyConverts ? " (solo conversos)" : "") +
        ` · bautismos ${state.years.previous}:${bap.prev} / ${state.years.current}:${bap.curr}` +
        (kept ? ` · ${kept} filas conservaron datos previos` : "") +
        "."
    );
    setStatus("Listo para descargar PDF.");
  }

  function sexFromCsv(raw) {
    const s = String(raw || "").trim().toUpperCase();
    if (s === "V" || s === "H") return "H";
    if (s === "M") return "M";
    return s;
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let inQuotes = false;
    const src = text.replace(/^\uFEFF/, "");
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      const next = src[i + 1];
      if (inQuotes) {
        if (ch === '"' && next === '"') {
          cell += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          cell += ch;
        }
        continue;
      }
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(cell);
        cell = "";
      } else if (ch === "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else if (ch !== "\r") {
        cell += ch;
      }
    }
    if (cell.length || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows.filter((r) => r.some((c) => String(c).trim()));
  }

  function csvToPayload(text) {
    const rows = parseCsv(text);
    if (rows.length < 2) throw new Error("CSV vacío");
    const headers = rows[0].map((h) => h.trim());
    const idx = (name) => headers.findIndex((h) => h === name);
    const get = (r, name) => {
      const i = idx(name);
      return i >= 0 ? String(r[i] || "").trim() : "";
    };

    const byUnit = new Map();
    for (const r of rows.slice(1)) {
      const unit = get(r, "Unidad");
      const name = get(r, "Nombre de preferencia");
      if (!unit || !name || name.toLowerCase().startsWith("recuento")) continue;
      if (!byUnit.has(unit)) byUnit.set(unit, []);
      byUnit.get(unit).push({
        name,
        unit,
        age: get(r, "Edad"),
        sex: sexFromCsv(get(r, "Sexo")),
        priesthood: get(r, "Oficio en el sacerdocio"),
        callings: get(r, "Llamamientos"),
        isConvert: get(r, "Es converso") || "Sí",
        homeTeachers: get(r, "Hermanos ministrantes"),
        visitingTeachers: get(r, "Hermanas ministrantes"),
        templeDate: get(
          r,
          "Fecha de vencimiento de la recomendación para el templo"
        ),
        confirmationDate:
          get(r, "Fecha de la confirmación") || get(r, "Fecha bautismo"),
        attendance: get(r, "Asistencia"),
        temple: get(r, "Rec. templo"),
        calling: get(r, "Llamamiento"),
        assignment: get(r, "Asignación"),
        report: get(r, "Informe"),
        dato: get(r, "Dato"),
      });
    }

    return {
      source: "lcr-csv",
      scrapedAt: new Date().toISOString(),
      unitInfo: "Distrito Viedma Argentina",
      units: [...byUnit.entries()].map(([name, members]) => ({ name, members })),
    };
  }

  function mergePayload(base, incoming) {
    // Une unidades por nombre; los miembros se fusionan luego por persona en applyLcrPayload.
    const map = new Map((base.units || []).map((u) => [u.name, u]));
    for (const u of incoming.units || []) {
      const prev = map.get(u.name);
      if (!prev) {
        map.set(u.name, u);
        continue;
      }
      const byName = new Map(
        (prev.members || []).map((m) => [normName(m.name), m])
      );
      for (const m of u.members || []) {
        byName.set(normName(m.name), m);
      }
      map.set(u.name, { ...u, members: [...byName.values()] });
    }
    return {
      ...incoming,
      unitInfo: incoming.unitInfo || base.unitInfo,
      units: [...map.values()],
    };
  }

  async function importFromText(text, { merge = true } = {}) {
    const trimmed = text.trim();
    let payload;
    if (trimmed.startsWith("{")) {
      payload = JSON.parse(trimmed);
    } else {
      payload = csvToPayload(trimmed);
    }
    if (isAttendancePayload(payload)) {
      applyAttendanceOverlay(payload);
      return;
    }
    if (merge && window._lastLcrPayload?.units?.length) {
      payload = mergePayload(window._lastLcrPayload, payload);
    }
    window._lastLcrPayload = payload;
    applyLcrPayload(payload);
  }

  async function importAttendanceFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text?.trim()) throw new Error("El portapapeles está vacío.");
      await importFromText(text, { merge: false });
    } catch (err) {
      const manual = prompt(
        "No se pudo leer el portapapeles. Pegá aquí el JSON de lcr-attendance.json:"
      );
      if (!manual) return;
      try {
        await importFromText(manual, { merge: false });
      } catch (e) {
        setImportStatus(e.message || "JSON de asistencia inválido.");
      }
    }
  }

  function statusClass(value) {
    const v = String(value || "").trim().toLowerCase();
    if (["sí", "si", "yes", "ok", "✅"].includes(v)) return "status--si";
    if (["no", "❌"].includes(v)) return "status--no";
    if (["n/a", "na", "—", "-"].includes(v)) return "status--na";
    return "status--pend";
  }

  function statusChip(value) {
    const text = value == null ? "" : String(value).trim();
    if (!text || text === "—") return "";
    return `<span class="status ${statusClass(text)}">${escapeHtml(text)}</span>`;
  }

  function isCheckedValue(value) {
    const v = String(value || "").trim().toLowerCase();
    return ["sí", "si", "yes", "ok", "x", "hecho", "true", "1"].includes(v);
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function attendanceClass(value) {
    const m = String(value || "").match(/(\d+)\s*\/\s*(\d+)/);
    if (!m) return "";
    const a = Number(m[1]);
    if (a <= 0) return "att-0";
    if (a <= 2) return "att-low";
    if (a <= 4) return "att-mid";
    return "att-high"; // 5 o 6 (o más)
  }

  function deltaClass(n) {
    if (n > 0) return "delta-pos";
    if (n < 0) return "delta-neg";
    return "delta-zero";
  }

  function sortHeader(label, { type = "text", filter = "text", className = "" } = {}) {
    const cls = ["", className].filter(Boolean).join(" ");
    const typeAttr =
      type === "num"
        ? ' data-sort-type="num"'
        : type === "date"
          ? ' data-sort-type="date"'
          : "";
    let filterHtml;
    if (filter === "num") {
      filterHtml = `<div class="th-range no-print" data-filter="num">
        <input type="number" class="th-min" placeholder="Min" aria-label="Edad mínima" />
        <input type="number" class="th-max" placeholder="Máx" aria-label="Edad máxima" />
      </div>`;
    } else if (filter === "date") {
      filterHtml = `<div class="th-range no-print" data-filter="date">
        <input type="date" class="th-min" aria-label="Fecha desde" title="Desde" />
        <input type="date" class="th-max" aria-label="Fecha hasta" title="Hasta" />
      </div>`;
    } else {
      filterHtml = `<input type="search" class="th-filter no-print" placeholder="Filtrar…" aria-label="Filtrar ${escapeHtml(label || "columna")}" />`;
    }
    return `<th class="${cls}" data-sort${typeAttr}>
      <button type="button" class="th-sort">${escapeHtml(label)}</button>
      ${filterHtml}
    </th>`;
  }

  function renderReport() {
    const prevYear = state.years.previous;
    const currYear = state.years.current;
    const baptisms = visibleBaptisms();
    const ramaOnly = isRamaMode();
    const totals = baptisms.reduce(
      (acc, row) => {
        acc.prev += Number(row.prev) || 0;
        acc.curr += Number(row.curr) || 0;
        return acc;
      },
      { prev: 0, curr: 0 }
    );
    const totalDelta = totals.curr - totals.prev;

    const prevCells = baptisms
      .map((b) => `<td>${Number(b.prev) || 0}</td>`)
      .join("");
    const currCells = baptisms
      .map((b) => `<td>${Number(b.curr) || 0}</td>`)
      .join("");
    const deltaCells = baptisms
      .map((b) => {
        const d = (Number(b.curr) || 0) - (Number(b.prev) || 0);
        const sign = d > 0 ? `+${d}` : String(d);
        return `<td class="${deltaClass(d)}">${sign}</td>`;
      })
      .join("");
    const districtHead = ramaOnly ? "" : sortHeader("Distrito", { type: "num" });
    const districtPrev = ramaOnly ? "" : `<td>${totals.prev}</td>`;
    const districtCurr = ramaOnly ? "" : `<td>${totals.curr}</td>`;
    const districtDelta = ramaOnly
      ? ""
      : `<td class="${deltaClass(totalDelta)}">${totalDelta > 0 ? "+" : ""}${totalDelta}</td>`;

    const now = new Date();
    const reportYear = state.years?.current ?? now.getFullYear();
    const currentMonthIdx =
      reportYear === now.getFullYear() ? now.getMonth() : reportYear > now.getFullYear() ? -1 : 12;
    const goalsView = goalsForDisplay();
    const goals = goalsView
      .map((g) => {
        const idx = g.monthIndex != null ? g.monthIndex : g.index;
        const done = Number(g.done) || 0;
        const goal = Number(g.goal) || 0;
        const isOpen = idx >= currentMonthIdx;
        const met = done >= goal && goal > 0;
        return `<div class="goal-card ${isOpen ? "goal-card--open" : ""} ${met ? "goal-card--met" : ""}" data-month-index="${idx}">
          <span>${escapeHtml(g.month)}</span>
          <strong class="only-print">${done}/${goal}</strong>
          <div class="goal-card__value no-print">
            <span class="goal-done" title="Confirmaciones del mes">${done}</span>
            <span class="goal-slash">/</span>
            <input
              class="goal-input"
              type="number"
              min="0"
              inputmode="numeric"
              data-goal-index="${g.index}"
              value="${goal}"
              aria-label="Meta de ${escapeHtml(g.month)}"
              title="Meta mensual (editable)"
              ${canEdit() ? "" : "disabled"}
            />
          </div>
          ${isOpen ? `<em class="goal-card__hint">Meta editable</em>` : ""}
        </div>`;
      })
      .join("");

    const S = window.CorrelacionSummary;
    if (S) S.ensureSummary(state);
    const year = state.years?.current ?? new Date().getFullYear();
    const weeks6 = S ? S.lastNSundays(year, 6) : [];
    const sumUnits = visibleSummaryUnits();
    const editAttr = canEdit() ? "" : "disabled";

    const unitPages = visibleUnits()
      .map((unit) => {
        const ui = (state.units || []).indexOf(unit);
        const rows = (unit.members || [])
          .map((m, mi) => {
            const age = m.age != null ? m.age : String(m.ageSex || "").replace(/\s*[HhMmVvFf]\s*$/, "").trim();
            const sex =
              m.sex != null && m.sex !== ""
                ? m.sex
                : String(m.ageSex || "").match(/[HhMmVvFf]\s*$/)?.[0]?.toUpperCase() === "V"
                  ? "H"
                  : String(m.ageSex || "").match(/[HhMmVvFf]\s*$/)?.[0]?.toUpperCase() || "";
            const assignOn = isCheckedValue(m.assignment);
            const reportOn = isCheckedValue(m.report);
            return `<tr data-unit-index="${ui}" data-member-index="${mi}">
              <td class="col-nombre">${escapeHtml(m.name)}</td>
              <td>${escapeHtml(m.baptism || "")}</td>
              <td>${escapeHtml(age)}</td>
              <td>${escapeHtml(sex)}</td>
              <td class="col-asistencia">
                ${
                  canEdit()
                    ? `<input
                  type="text"
                  class="row-dato no-print ${m.attendance ? attendanceClass(m.attendance) : ""}"
                  data-field="attendance"
                  value="${escapeHtml(m.attendance || "")}"
                  placeholder="0/6"
                  ${editAttr}
                />
                <span class="dato-print only-print ${m.attendance ? attendanceClass(m.attendance) : ""}">${escapeHtml(m.attendance || "")}</span>`
                    : m.attendance
                      ? `<span class="att-chip ${attendanceClass(m.attendance)}">${escapeHtml(m.attendance)}</span>`
                      : `<span class="att-empty muted">—</span>`
                }
              </td>
              <td>${statusChip(m.temple)}</td>
              <td>${statusChip(m.calling)}</td>
              <td class="col-asignacion">
                <label class="tick no-print">
                  <input type="checkbox" data-field="assignment" ${assignOn ? "checked" : ""} ${editAttr} />
                  <span>Hecho</span>
                </label>
                <span class="tick-print only-print">${assignOn ? "Sí" : ""}</span>
              </td>
              <td class="col-informe">
                <label class="tick no-print">
                  <input type="checkbox" data-field="report" ${reportOn ? "checked" : ""} ${editAttr} />
                  <span>Hecho</span>
                </label>
                <span class="tick-print only-print">${reportOn ? "Sí" : ""}</span>
              </td>
              <td class="col-dato">
                <input type="text" class="row-dato no-print" data-field="dato" value="${escapeHtml(m.dato || "")}" placeholder="Dato…" ${editAttr} />
                <span class="dato-print only-print">${escapeHtml(m.dato || "")}</span>
              </td>
            </tr>`;
          })
          .join("");

        return `<section class="page">
          <div class="page__body">
            <h2 class="page__title">${escapeHtml(unit.name)} <span class="table-count muted"></span></h2>
            <div class="table-scroll">
              <table class="members-table js-interactive-table">
                <thead>
                  <tr>
                    ${sortHeader("Nombre", { className: "col-nombre" })}
                    ${sortHeader("Fecha bautismo", { type: "date", filter: "date" })}
                    ${sortHeader("Edad", { type: "num", filter: "num" })}
                    ${sortHeader("Sexo")}
                    ${sortHeader("Asistencia")}
                    ${sortHeader("Rec. templo")}
                    ${sortHeader("Llamamiento")}
                    ${sortHeader("Asignación", { className: "col-asignacion" })}
                    ${sortHeader("Informe", { className: "col-informe" })}
                    ${sortHeader("Dato", { className: "col-dato" })}
                  </tr>
                </thead>
                <tbody>${rows || `<tr><td colspan="10">Sin registros</td></tr>`}</tbody>
              </table>
            </div>
          </div>
        </section>`;
      })
      .join("");

    const meetingLabels = state.summary?.meetingLabels || S?.MEETING_LABELS || [];
    const summaryMeetingRows = meetingLabels
      .map((label) => {
        const cells = sumUnits
          .map((u) => {
            const { done, total } = S.meetingScore(state.summary, label, u, weeks6);
            const cls = S.meetingClass(done, total);
            return `<td>
              <button type="button" class="summary-chip ${cls}" data-summary-open="meeting" data-label="${escapeHtml(label)}" data-unit="${escapeHtml(u)}">${done}/${total}</button>
              <span class="only-print">${done}/${total}</span>
            </td>`;
          })
          .join("");
        return `<tr><td>${escapeHtml(label)}</td>${cells}</tr>`;
      })
      .join("");

    const summaryLeaderRow = (() => {
      const cells = sumUnits
        .map((u) => {
          const cur = S.currentLeader(state.summary.leaders[u]);
          const text = S.personLabel(cur);
          return `<td>
            <button type="button" class="summary-chip summary-chip--text" data-summary-open="leader" data-unit="${escapeHtml(u)}">${escapeHtml(text)}</button>
            <span class="only-print">${escapeHtml(text)}</span>
          </td>`;
        })
        .join("");
      return `<tr><td>Líder de obra misional</td>${cells}</tr>`;
    })();

    const summaryMissionRow = (() => {
      const cells = sumUnits
        .map((u) => {
          const n = S.activePeople(state.summary.missionaries[u]).length;
          return `<td>
            <button type="button" class="summary-chip" data-summary-open="missionaries" data-unit="${escapeHtml(u)}">${n}</button>
            <span class="only-print">${n}</span>
          </td>`;
        })
        .join("");
      return `<tr><td>Misioneros de rama</td>${cells}</tr>`;
    })();

    const summaryRows = summaryMeetingRows + summaryLeaderRow + summaryMissionRow;

    els.report.innerHTML = `
      <section class="page page--cover">
        <div>
          <p class="cover__kicker">Informe de correlación</p>
          <h2 class="cover__title">${escapeHtml(state.title)}</h2>
          <p class="cover__period">${escapeHtml(state.period)}</p>
        </div>
      </section>

      <section class="page">
        <div class="page__body">
          <h2 class="page__title">Bautismos del año${ramaOnly ? ` · ${escapeHtml(session.rama)}` : ""}</h2>
          <div class="badge-row">
            <span class="badge">${prevYear}: <strong>${totals.prev}</strong></span>
            <span class="badge">${currYear}: <strong>${totals.curr}</strong></span>
            <span class="badge">Variación: <strong class="${deltaClass(totalDelta)}">${totalDelta > 0 ? "+" : ""}${totalDelta}</strong></span>
          </div>
          <p class="table-count muted no-print" style="margin:0 0 0.5rem"></p>
          <table class="stats-table js-interactive-table">
            <thead>
              <tr>
                ${sortHeader("")}
                ${baptisms.map((b) => sortHeader(b.unit, { type: "num" })).join("")}
                ${districtHead}
              </tr>
            </thead>
            <tbody>
              <tr><td>${prevYear}</td>${prevCells}${districtPrev}</tr>
              <tr><td>${currYear}</td>${currCells}${districtCurr}</tr>
              <tr><td>+/−</td>${deltaCells}${districtDelta}</tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="page">
        <div class="page__body">
          <h2 class="page__title">Meta bautismal${ramaOnly ? ` · ${escapeHtml(session.rama)}` : ""} <span class="muted" style="font-size:0.85rem;font-family:inherit;font-weight:500">${escapeHtml(String(state.years?.current || ""))}</span></h2>
          <p class="muted small no-print" style="margin:0 0 0.75rem">Real = confirmaciones del mes${ramaOnly ? " de esta rama" : ""}. La meta (derecha) se edita acá; el mes actual y futuros quedan visibles.</p>
          <div class="goals-grid">${goals}</div>
        </div>
      </section>

      ${unitPages}

      <section class="page">
        <div class="page__body">
          <h2 class="page__title">${isRamaMode() ? `Resumen · ${escapeHtml(session.rama)}` : "Resumen del distrito"}</h2>
          <p class="muted small no-print" style="margin:0 0 0.65rem">Reuniones: últimas 6 semanas (${escapeHtml(String(year))}). Tocá una celda para ver detalle${canEdit() ? " y editar" : " (solo lectura)"}.</p>
          <div class="table-scroll">
            <table class="summary-table">
              <thead>
                <tr>
                  <th>Indicador</th>
                  ${sumUnits.map((u) => `<th>${escapeHtml(u)}</th>`).join("")}
                </tr>
              </thead>
              <tbody>${summaryRows}</tbody>
            </table>
          </div>
        </div>
      </section>
    `;

    wireInteractiveTables(els.report);
    wireRowEditors(els.report);
    wireGoalEditors(els.report);
    wireSummaryChips(els.report);
    applyAccessChrome();
  }

  function wireSummaryChips(root) {
    root.querySelectorAll("[data-summary-open]").forEach((btn) => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", () => {
        openSummaryDetail(btn.dataset.summaryOpen, btn.dataset.unit, btn.dataset.label);
      });
    });
  }

  function openSummaryDetail(kind, unit, label) {
    const S = window.CorrelacionSummary;
    if (!S) return;
    S.ensureSummary(state);
    const modal = document.getElementById("summaryModal");
    const title = document.getElementById("summaryModalTitle");
    const body = document.getElementById("summaryModalBody");
    if (!modal || !body) return;
    const year = state.years?.current ?? new Date().getFullYear();
    const weeks6 = S.lastNSundays(year, 6);
    const editable = canEdit();

    if (kind === "meeting") {
      title.textContent = `${label} · ${unit}`;
      const map = state.summary.meetings[label]?.[unit] || {};
      body.innerHTML = `
        <p class="muted small">Últimas 6 semanas (el año completo queda guardado).</p>
        <div class="summary-weeks">
          ${weeks6
            .map((w) => {
              const id = `wk_${w}`;
              const checked = map[w] ? "checked" : "";
              return `<label class="check summary-week">
                <input type="checkbox" data-week="${w}" id="${id}" ${checked} ${editable ? "" : "disabled"} />
                ${escapeHtml(S.formatSundayLabel(w))}
              </label>`;
            })
            .join("")}
        </div>`;
      body.querySelectorAll("input[data-week]").forEach((inp) => {
        inp.addEventListener("change", () => {
          if (!state.summary.meetings[label][unit]) state.summary.meetings[label][unit] = {};
          state.summary.meetings[label][unit][inp.dataset.week] = inp.checked;
          saveState();
          renderReport();
        });
      });
    } else if (kind === "leader") {
      title.textContent = `Líder de obra misional · ${unit}`;
      body.innerHTML = renderPeopleEditor("leaders", unit, { singleActive: true });
      wirePeopleEditor(body, "leaders", unit);
    } else if (kind === "missionaries") {
      title.textContent = `Misioneros de rama · ${unit}`;
      body.innerHTML = renderPeopleEditor("missionaries", unit, { singleActive: false });
      wirePeopleEditor(body, "missionaries", unit);
    }

    modal.hidden = false;
    document.body.classList.add("modal-open");
  }

  function renderPeopleEditor(bucket, unit, { singleActive }) {
    const S = window.CorrelacionSummary;
    const list = state.summary[bucket][unit] || [];
    const editable = canEdit();
    const active = S.activePeople(list);
    const rows = list
      .map((p, i) => {
        const activeNow = !p.releasedAt;
        return `<div class="person-row ${activeNow ? "person-row--active" : ""}">
          <div class="row-edit row-edit--compact">
            <input data-person="${i}" data-field="last" placeholder="Apellido" value="${escapeHtml(p.last || "")}" ${editable ? "" : "disabled"} />
            <input data-person="${i}" data-field="first" placeholder="Nombre" value="${escapeHtml(p.first || "")}" ${editable ? "" : "disabled"} />
          </div>
          <div class="row-edit row-edit--compact">
            <label class="field"><span>Llamamiento</span>
              <input type="date" data-person="${i}" data-field="calledAt" value="${escapeHtml(p.calledAt || "")}" ${editable ? "" : "disabled"} />
            </label>
            <label class="field"><span>Relevo</span>
              <input type="date" data-person="${i}" data-field="releasedAt" value="${escapeHtml(p.releasedAt || "")}" ${editable ? "" : "disabled"} />
            </label>
          </div>
          ${activeNow ? `<p class="hint">Actual</p>` : `<p class="hint">Relevado</p>`}
        </div>`;
      })
      .join("");
    return `
      <p class="muted small">${singleActive ? "Se muestra el actual en la tabla; el historial queda abajo." : `Activos: <strong>${active.length}</strong> (el número de la celda).`}</p>
      <div class="people-list">${rows || "<p class='muted'>Sin personas cargadas.</p>"}</div>
      ${
        editable
          ? `<button type="button" class="btn btn--primary" data-add-person>Agregar</button>`
          : `<p class="hint">Modo solo lectura — usá Editar (PIN) para cambiar.</p>`
      }`;
  }

  function wirePeopleEditor(body, bucket, unit) {
    const commit = (i, field, value) => {
      if (!canEdit()) return;
      const list = state.summary[bucket][unit];
      if (!list[i]) return;
      list[i][field] = value || null;
      if (field === "releasedAt" && value === "") list[i].releasedAt = null;
      saveState();
      renderReport();
    };
    body.querySelectorAll("[data-person]").forEach((inp) => {
      const apply = () => commit(Number(inp.dataset.person), inp.dataset.field, inp.value);
      inp.addEventListener("change", apply);
      inp.addEventListener("blur", apply);
    });
    body.querySelector("[data-add-person]")?.addEventListener("click", () => {
      if (!canEdit()) return;
      const today = new Date().toISOString().slice(0, 10);
      if (bucket === "leaders") {
        const cur = window.CorrelacionSummary.currentLeader(state.summary.leaders[unit]);
        if (cur && !cur.releasedAt) cur.releasedAt = today;
      }
      state.summary[bucket][unit].push({
        last: "",
        first: "",
        calledAt: today,
        releasedAt: null,
      });
      saveState();
      openSummaryDetail(bucket === "leaders" ? "leader" : "missionaries", unit);
    });
  }

  function closeSummaryModal() {
    const modal = document.getElementById("summaryModal");
    if (modal) modal.hidden = true;
    document.body.classList.toggle(
      "modal-open",
      Boolean(
        (document.getElementById("configModal") && !document.getElementById("configModal").hidden) ||
          (document.getElementById("chartsModal") && !document.getElementById("chartsModal").hidden)
      )
    );
  }

  function applyAccessChrome() {
    const main = document.getElementById("mainApp");
    const gate = document.getElementById("accessGate");
    const eyebrow = document.getElementById("accessEyebrow");
    const btnEdit = document.getElementById("btnUnlockEdit");
    const btnLock = document.getElementById("btnLockEdit");
    const btnConfig = document.getElementById("btnOpenConfig");
    const gateToken = document.getElementById("gateDistrictToken");

    if (!session) {
      if (gate) gate.hidden = false;
      if (main) main.hidden = true;
      // Prefill desde ?d= si el link no alcanzó a abrir (clave distinta en este navegador).
      if (gateToken && !gateToken.value) {
        const d = new URLSearchParams(location.search).get("d") ||
          new URLSearchParams(location.search).get("distrito");
        if (d) gateToken.value = d;
      }
      return;
    }
    if (gate) gate.hidden = true;
    if (main) main.hidden = false;

    if (eyebrow) {
      eyebrow.textContent =
        session.mode === "rama"
          ? `Rama ${session.rama}${session.canEdit ? " · edición" : " · solo ver"}`
          : `Distrito${session.canEdit ? " · edición" : " · solo ver"}`;
    }
    if (btnEdit) btnEdit.hidden = !!session.canEdit;
    if (btnLock) btnLock.hidden = !session.canEdit;
    if (btnConfig) btnConfig.hidden = !(session.mode === "district" && session.canEdit);

    document.body.classList.toggle("access-readonly", !session.canEdit);
    document.body.classList.toggle("access-rama", session.mode === "rama");
  }

  function enterSession(next) {
    session = next;
    window.CorrelacionSummary.saveSession(session);
    applyAccessChrome();
    refresh();
  }

  /** Deja la barra de direcciones alineada con el acceso (p. ej. ?d=dv1). */
  function syncAccessUrl(next) {
    const url = new URL(location.href);
    url.searchParams.delete("rama");
    url.searchParams.delete("v");
    url.searchParams.delete("d");
    url.searchParams.delete("distrito");
    if (next?.mode === "district") {
      const token = String(
        accessCfg?.districtView ||
          window.CorrelacionSummary?.DEFAULT_ACCESS?.districtView ||
          ""
      ).trim();
      if (token) url.searchParams.set("d", token);
    } else if (next?.mode === "rama" && next.rama) {
      const view = String(accessCfg?.ramas?.[next.rama]?.view || "").trim();
      if (view) {
        url.searchParams.set("rama", next.rama);
        url.searchParams.set("v", view);
      }
    }
    const nextSearch = url.searchParams.toString();
    const target = url.pathname + (nextSearch ? `?${nextSearch}` : "") + url.hash;
    if (target !== location.pathname + location.search + location.hash) {
      history.replaceState(null, "", target);
    }
  }

  function renderAccessGateLinks() {
    /* Los links de rama viven en Google Sheets (pestaña Acceso), no en la landing. */
  }

  function wireGoalEditors(root) {
    root.querySelectorAll("input[data-goal-index]").forEach((input) => {
      if (input.dataset.bound) return;
      input.dataset.bound = "1";
      const commit = () => {
        if (!canEdit()) return;
        const i = Number(input.dataset.goalIndex);
        const value = input.value === "" ? 0 : Number(input.value) || 0;
        if (isRamaMode()) {
          const list = ensureUnitGoals(session.rama);
          if (!list?.[i]) return;
          list[i].goal = value;
        } else {
          if (!state.goals?.[i]) return;
          state.goals[i].goal = value;
        }
        saveState();
        scheduleSheetsSave(600);
        const card = input.closest(".goal-card");
        const done = Number(card?.querySelector(".goal-done")?.textContent) || 0;
        const goal = value;
        card?.classList.toggle("goal-card--met", done >= goal && goal > 0);
        const printEl = card?.querySelector(".only-print");
        if (printEl) printEl.textContent = `${done}/${goal}`;
      };
      input.addEventListener("change", commit);
      input.addEventListener("blur", commit);
    });
  }

  function wireRowEditors(root) {
    root.querySelectorAll("tr[data-unit-index]").forEach((tr) => {
      if (tr.dataset.editBound) return;
      tr.dataset.editBound = "1";
      const ui = Number(tr.dataset.unitIndex);
      const mi = Number(tr.dataset.memberIndex);

      tr.querySelectorAll('input[data-field]').forEach((input) => {
        const field = input.dataset.field;
        const apply = () => {
          const member = state.units?.[ui]?.members?.[mi];
          if (!member) return;
          if (input.type === "checkbox") {
            member[field] = input.checked ? "Sí" : "";
          } else {
            member[field] = input.value;
          }
          saveState();
          // sync print mirrors without re-render
          if (field === "assignment" || field === "report") {
            const printEl = input.closest("td")?.querySelector(".tick-print");
            if (printEl) printEl.textContent = input.checked ? "Sí" : "";
          }
          if (field === "dato") {
            const printEl = tr.querySelector(".dato-print");
            if (printEl) printEl.textContent = input.value;
          }
          if (field === "attendance") {
            const cls = input.value ? attendanceClass(input.value) : "";
            input.className = `row-dato no-print ${cls}`.trim();
            const printEl = input.closest("td")?.querySelector(".dato-print");
            if (printEl) {
              printEl.textContent = input.value;
              printEl.className = `dato-print only-print ${cls}`.trim();
            }
          }
        };
        input.addEventListener("click", (e) => e.stopPropagation());
        input.addEventListener("keydown", (e) => e.stopPropagation());
        input.addEventListener("change", apply);
        input.addEventListener("input", apply);
      });
    });
  }

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

  function parseLooseDate(text) {
    const t = String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!t) return null;

    let m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (m) {
      const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      return Date.UTC(y, Number(m[2]) - 1, Number(m[1]));
    }

    m = t.match(/^(\d{1,2})\s+([a-záéíóú.]+)\s+(\d{4})$/i);
    if (m) {
      const mon = MONTHS_ES[m[2].replace(/\./g, "")];
      if (mon != null) return Date.UTC(Number(m[3]), mon, Number(m[1]));
    }

    m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

    const d = Date.parse(t);
    return Number.isNaN(d) ? null : d;
  }

  function cellEditableValue(td) {
    if (!td) return "";
    const check = td.querySelector('input[type="checkbox"][data-field]');
    if (check) return check.checked ? "Sí" : "";
    const textInput = td.querySelector('input[type="text"][data-field], input.row-dato');
    if (textInput) return textInput.value || "";
    return (td.innerText || td.textContent || "").replace(/\s+/g, " ").trim();
  }

  function cellSortValue(td, type) {
    const text = cellEditableValue(td);
    if (type === "num") {
      const m = text.match(/-?\d+(?:[.,]\d+)?/);
      return m ? Number(m[0].replace(",", ".")) : Number.NEGATIVE_INFINITY;
    }
    if (type === "date") {
      const ts = parseLooseDate(text);
      return ts == null ? Number.NEGATIVE_INFINITY : ts;
    }
    return text.toLocaleLowerCase("es");
  }

  function updateTableCount(table) {
    const countEl = table.closest(".page__body")?.querySelector(".table-count");
    if (!countEl) return;
    const rows = [...(table.tBodies[0]?.rows || [])];
    const visible = rows.filter((r) => r.style.display !== "none").length;
    countEl.textContent = `(${visible}/${rows.length})`;
  }

  function columnMatchesFilter(th, cell) {
    const text = cellEditableValue(cell);
    const range = th.querySelector(".th-range");
    if (range) {
      const kind = range.dataset.filter;
      const minRaw = range.querySelector(".th-min")?.value ?? "";
      const maxRaw = range.querySelector(".th-max")?.value ?? "";
      if (!minRaw && !maxRaw) return true;
      if (!text) return false;

      if (kind === "num") {
        const n = Number(String(text).replace(",", "."));
        if (Number.isNaN(n)) return false;
        if (minRaw !== "" && n < Number(minRaw)) return false;
        if (maxRaw !== "" && n > Number(maxRaw)) return false;
        return true;
      }

      if (kind === "date") {
        const ts = parseLooseDate(text);
        if (ts == null) return false;
        if (minRaw) {
          const minTs = parseLooseDate(minRaw);
          if (minTs != null && ts < minTs) return false;
        }
        if (maxRaw) {
          const maxTs = parseLooseDate(maxRaw);
          if (maxTs != null && ts > maxTs) return false;
        }
        return true;
      }
    }

    const q = (th.querySelector(".th-filter")?.value || "").trim().toLocaleLowerCase("es");
    if (!q) return true;
    return text.toLocaleLowerCase("es").includes(q);
  }

  function wireInteractiveTables(root) {
    root.querySelectorAll("table.js-interactive-table").forEach((table) => {
      const tbody = table.tBodies[0];
      if (!tbody) return;
      const headers = [...table.querySelectorAll("thead th[data-sort]")];

      const applyFilter = () => {
        [...tbody.rows].forEach((tr) => {
          const ok = headers.every((th, i) => columnMatchesFilter(th, tr.cells[i]));
          tr.style.display = ok ? "" : "none";
        });
        updateTableCount(table);
      };

      headers.forEach((th, colIndex) => {
        const sortBtn = th.querySelector(".th-sort");
        if (th.dataset.bound) return;
        th.dataset.bound = "1";

        th.querySelectorAll(".th-filter, .th-min, .th-max").forEach((input) => {
          input.addEventListener("click", (e) => e.stopPropagation());
          input.addEventListener("keydown", (e) => e.stopPropagation());
          input.addEventListener("input", applyFilter);
          input.addEventListener("change", applyFilter);
        });

        const sortBy = () => {
          const type = th.dataset.sortType || "text";
          const dir = th.dataset.sortDir === "asc" ? "desc" : "asc";
          headers.forEach((h) => {
            h.classList.remove("is-sorted-asc", "is-sorted-desc");
            delete h.dataset.sortDir;
          });
          th.dataset.sortDir = dir;
          th.classList.add(dir === "asc" ? "is-sorted-asc" : "is-sorted-desc");

          const rows = [...tbody.rows].filter((r) => r.style.display !== "none");
          const hidden = [...tbody.rows].filter((r) => r.style.display === "none");
          rows.sort((a, b) => {
            const av = cellSortValue(a.cells[colIndex], type);
            const bv = cellSortValue(b.cells[colIndex], type);
            let cmp = 0;
            if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
            else cmp = String(av).localeCompare(String(bv), "es", { numeric: true });
            return dir === "asc" ? cmp : -cmp;
          });
          rows.forEach((r) => tbody.appendChild(r));
          hidden.forEach((r) => tbody.appendChild(r));
        };

        if (sortBtn) {
          sortBtn.title = "Clic para ordenar";
          sortBtn.addEventListener("click", sortBy);
        } else {
          th.addEventListener("click", sortBy);
        }
      });

      applyFilter();
    });
  }

  function renderEditors() {
    els.metaTitle.value = state.title;
    els.metaPeriod.value = state.period;

    els.baptismsEditor.innerHTML = state.baptisms
      .map(
        (b, i) => `<div class="metric-card">
          <h4>${escapeHtml(b.unit)}</h4>
          <div class="row-edit row-edit--compact">
            <input data-path="baptisms.${i}.prev" type="number" min="0" value="${b.prev}" title="Año anterior" />
            <input data-path="baptisms.${i}.curr" type="number" min="0" value="${b.curr}" title="Año actual" />
            <input data-path="baptisms.${i}.unit" type="text" value="${escapeHtml(b.unit)}" title="Unidad" />
            <button type="button" class="btn btn--tiny btn--ghost" data-remove-baptism="${i}">✕</button>
          </div>
        </div>`
      )
      .join("") + `<button type="button" class="btn btn--ghost" id="addBaptism">+ Unidad bautismos</button>`;

    els.goalsEditor.innerHTML =
      `<p class="muted small">Real (izq.) = confirmaciones del mes · editá solo la meta.</p>` +
      state.goals
        .map((g, i) => {
          const idx = g.monthIndex != null ? g.monthIndex : i;
          const now = new Date();
          const reportYear = state.years?.current ?? now.getFullYear();
          const currentMonthIdx =
            reportYear === now.getFullYear()
              ? now.getMonth()
              : reportYear > now.getFullYear()
                ? -1
                : 12;
          const isOpen = idx >= currentMonthIdx;
          return `<div class="row-edit row-edit--compact ${isOpen ? "goal-row--open" : ""}">
            <span class="goal-editor-month">${escapeHtml(g.month)}${isOpen ? " ·" : ""}</span>
            <input type="number" min="0" value="${Number(g.done) || 0}" disabled title="Confirmaciones (auto)" />
            <input data-path="goals.${i}.goal" type="number" min="0" value="${Number(g.goal) || 0}" title="Meta" />
          </div>`;
        })
        .join("");

    els.unitsEditor.innerHTML = state.units
      .map((unit, ui) => {
        const members = (unit.members || [])
          .map((m, mi) => {
            const age =
              m.age != null
                ? m.age
                : String(m.ageSex || "").replace(/\s*[HhMmVvFf]\s*$/, "").trim();
            let sex = m.sex || "";
            if (!sex && m.ageSex) {
              const s = String(m.ageSex).match(/([HhMmVvFf])\s*$/);
              sex = s ? (s[1].toUpperCase() === "V" ? "H" : s[1].toUpperCase()) : "";
            }
            return `<div class="row-edit" title="Fila de converso">
              <input data-path="units.${ui}.members.${mi}.name" value="${escapeHtml(m.name)}" placeholder="Nombre" />
              <input data-path="units.${ui}.members.${mi}.baptism" value="${escapeHtml(m.baptism || "")}" placeholder="Fecha" />
              <input data-path="units.${ui}.members.${mi}.age" value="${escapeHtml(age)}" placeholder="Edad" />
              <input data-path="units.${ui}.members.${mi}.sex" value="${escapeHtml(sex)}" placeholder="Sexo" />
              <input data-path="units.${ui}.members.${mi}.attendance" value="${escapeHtml(m.attendance || "")}" placeholder="Asist." />
              <input data-path="units.${ui}.members.${mi}.assignment" value="${escapeHtml(m.assignment || "")}" placeholder="Asignación" />
              <input data-path="units.${ui}.members.${mi}.report" value="${escapeHtml(m.report || "")}" placeholder="Informe" />
              <button type="button" class="btn btn--tiny btn--ghost" data-remove-member="${ui}:${mi}">✕</button>
              <input data-path="units.${ui}.members.${mi}.temple" value="${escapeHtml(m.temple || "")}" placeholder="Templo" />
              <input data-path="units.${ui}.members.${mi}.calling" value="${escapeHtml(m.calling || "")}" placeholder="Llamamiento" />
            </div>`;
          })
          .join("");

        return `<div class="unit-card">
          <h3>
            <input data-path="units.${ui}.name" value="${escapeHtml(unit.name)}" style="width:100%" />
          </h3>
          ${members}
          <div style="display:flex;gap:0.4rem;flex-wrap:wrap;margin-top:0.4rem">
            <button type="button" class="btn btn--tiny btn--ghost" data-add-member="${ui}">+ Converso</button>
            <button type="button" class="btn btn--tiny btn--ghost" data-remove-unit="${ui}">Eliminar unidad</button>
          </div>
        </div>`;
      })
      .join("");

    if (window.CorrelacionSummary) window.CorrelacionSummary.ensureSummary(state);
    const unitLabels = (state.summaryUnits || [])
      .map(
        (u, i) =>
          `<input data-path="summaryUnits.${i}" value="${escapeHtml(u)}" title="Columna ${i + 1}" />`
      )
      .join("");
    els.summaryEditor.innerHTML = `
      <div class="metric-card">
        <h4>Columnas (unidades)</h4>
        <p class="muted small">Semanas y personas se editan tocando las celdas del informe.</p>
        <div class="row-edit row-edit--summary">${unitLabels}</div>
      </div>`;

    const accessEditor = document.getElementById("accessEditor");
    if (accessEditor && accessCfg) {
      const ramas = Object.keys(accessCfg.ramas || {});
      accessEditor.innerHTML = `
        <label class="field"><span>Clave distrito (ver)</span>
          <input id="accessDistrictView" value="${escapeHtml(accessCfg.districtView || "")}" />
        </label>
        <label class="field"><span>PIN distrito (editar)</span>
          <input id="accessDistrictPin" value="${escapeHtml(accessCfg.districtPin || "")}" />
        </label>
        <p class="hint">Link distrito: <code class="break-all">${escapeHtml(window.CorrelacionSummary.districtViewLink(accessCfg))}</code></p>
        ${ramas
          .map((rama) => {
            const cfg = accessCfg.ramas[rama];
            return `<div class="metric-card">
              <h4>${escapeHtml(rama)}</h4>
              <div class="row-edit row-edit--compact">
                <input data-access-rama="${escapeHtml(rama)}" data-access-field="view" value="${escapeHtml(cfg.view || "")}" title="Token ver" />
                <input data-access-rama="${escapeHtml(rama)}" data-access-field="pin" value="${escapeHtml(cfg.pin || "")}" title="PIN editar" />
              </div>
              <p class="hint break-all">${escapeHtml(window.CorrelacionSummary.ramaViewLink(rama, accessCfg))}</p>
            </div>`;
          })
          .join("")}
        <button type="button" class="btn btn--ghost" id="btnSaveAccess">Guardar acceso</button>`;
    }
  }

  function setByPath(path, value) {
    const parts = path.split(".");
    let cursor = state;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = /^\d+$/.test(parts[i]) ? Number(parts[i]) : parts[i];
      cursor = cursor[key];
    }
    const last = parts[parts.length - 1];
    const lastKey = /^\d+$/.test(last) ? Number(last) : last;
    if (["prev", "curr", "goal"].includes(lastKey)) {
      cursor[lastKey] = value === "" ? 0 : Number(value);
    } else if (lastKey === "done") {
      cursor[lastKey] = value === "" ? null : Number(value);
    } else {
      cursor[lastKey] = value;
    }
  }

  function refresh() {
    recomputeGoalDones(state);
    renderEditors();
    renderReport();
    // No persistir placeholder ni vistas de solo lectura (evita pisar Sheets).
    if (!isSeedDefaultReport(state) && canEdit()) saveState();
  }

  function bind() {
    els.metaTitle.addEventListener("input", (e) => {
      state.title = e.target.value;
      renderReport();
      saveState();
    });
    els.metaPeriod.addEventListener("input", (e) => {
      state.period = e.target.value;
      renderReport();
      saveState();
    });

    document.getElementById("panel").addEventListener("input", (e) => {
      const path = e.target.getAttribute("data-path");
      if (!path) return;
      setByPath(path, e.target.value);
      renderReport();
      saveState();
    });

    document.getElementById("panel").addEventListener("change", (e) => {
      const path = e.target.getAttribute("data-path");
      if (!path) return;
      setByPath(path, e.target.value);
      renderReport();
      saveState();
    });

    document.getElementById("panel").addEventListener("click", (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;

      if (t.id === "addBaptism") {
        state.baptisms.push({ unit: "Nueva unidad", prev: 0, curr: 0 });
        refresh();
        return;
      }
      if (t.id === "addUnit" || t.closest("#addUnit")) {
        state.units.push({
          name: "Nueva unidad",
          members: [
            {
              name: "Apellido, Nombre",
              baptism: "",
              age: "",
              sex: "",
              attendance: "",
              temple: "",
              calling: "",
              assignment: "",
              report: "",
            },
          ],
        });
        refresh();
        return;
      }

      if (t.dataset.removeBaptism != null) {
        state.baptisms.splice(Number(t.dataset.removeBaptism), 1);
        refresh();
        return;
      }
      if (t.dataset.removeGoal != null) {
        state.goals.splice(Number(t.dataset.removeGoal), 1);
        refresh();
        return;
      }
      if (t.dataset.removeUnit != null) {
        state.units.splice(Number(t.dataset.removeUnit), 1);
        refresh();
        return;
      }
      if (t.dataset.addMember != null) {
        const ui = Number(t.dataset.addMember);
        state.units[ui].members.push({
          name: "Apellido, Nombre",
          baptism: "",
          age: "",
          sex: "",
          attendance: "",
          temple: "",
          calling: "",
          assignment: "",
          report: "",
          dato: "",
        });
        refresh();
        return;
      }
      if (t.dataset.removeMember != null) {
        const [ui, mi] = t.dataset.removeMember.split(":").map(Number);
        state.units[ui].members.splice(mi, 1);
        refresh();
      }
    });

    const configModal = document.getElementById("configModal");
    const openConfigBtn = document.getElementById("btnOpenConfig");
    const closeConfigBtn = document.getElementById("btnCloseConfig");
    const chartsModal = document.getElementById("chartsModal");
    const openChartsBtn = document.getElementById("btnOpenCharts");
    const closeChartsBtn = document.getElementById("btnCloseCharts");
    const chartColumn = document.getElementById("chartColumn");
    const chartUnits = document.getElementById("chartUnits");
    const chartConsolidado = document.getElementById("chartConsolidado");
    const chartType = document.getElementById("chartType");
    const chartReason = document.getElementById("chartReason");
    const chartStatus = document.getElementById("chartStatus");
    const chartCanvas = document.getElementById("chartCanvas");

    function anyModalOpen() {
      return (
        (configModal && !configModal.hidden) ||
        (chartsModal && !chartsModal.hidden)
      );
    }

    function syncBodyModalClass() {
      document.body.classList.toggle("modal-open", anyModalOpen());
    }

    function openConfigModal() {
      if (!configModal) return;
      configModal.hidden = false;
      syncBodyModalClass();
      closeConfigBtn?.focus();
    }

    function closeConfigModal() {
      if (!configModal) return;
      configModal.hidden = true;
      syncBodyModalClass();
      openConfigBtn?.focus();
    }

    function setChartStatus(msg) {
      if (chartStatus) chartStatus.textContent = msg || "";
    }

    function refreshChartControls() {
      const C = window.CorrelacionCharts;
      if (!C) return;
      C.fillColumnSelect(chartColumn);
      C.fillUnitChecks(chartUnits, state.units);
      updateChartReason();
    }

    function updateChartReason() {
      const C = window.CorrelacionCharts;
      if (!C || !chartReason) return;
      const col = C.colMeta(chartColumn?.value);
      const selected = C.selectedUnitNames(chartUnits);
      const rec = C.recommend(col.kind, {
        unitCount: selected.length,
        consolidado: !!chartConsolidado?.checked,
      });
      chartReason.textContent = rec.reason;
    }

    function hideChartPeople() {
      const panel = document.getElementById("chartPeoplePanel");
      if (panel) panel.hidden = true;
    }

    function showChartPeople(payload) {
      const panel = document.getElementById("chartPeoplePanel");
      const titleEl = document.getElementById("chartPeopleTitle");
      const metaEl = document.getElementById("chartPeopleMeta");
      const listEl = document.getElementById("chartPeopleList");
      const eyeEl = document.getElementById("chartPeopleEyebrow");
      if (!panel || !listEl) return;
      if (!payload) {
        panel.hidden = true;
        return;
      }
      const { group, option, column, people } = payload;
      if (eyeEl) eyeEl.textContent = column || "Personas";
      if (titleEl) {
        titleEl.textContent =
          group && option && group !== option ? `${group} · ${option}` : option || group || "Segmento";
      }
      if (metaEl) {
        metaEl.textContent = `${people.length} persona${people.length === 1 ? "" : "s"}`;
      }
      listEl.innerHTML = people.length
        ? people
            .map((p) => {
              const unit =
                chartConsolidado?.checked || (group && group !== p.unit)
                  ? ` <span class="muted">${escapeHtml(p.unit)}</span>`
                  : "";
              return `<li><strong>${escapeHtml(p.name)}</strong>${unit}</li>`;
            })
            .join("")
        : `<li class="muted">Nadie en este segmento.</li>`;
      panel.hidden = false;
    }

    function renderSelectedChart() {
      const C = window.CorrelacionCharts;
      if (!C || !chartCanvas) return;
      try {
        const selected = C.selectedUnitNames(chartUnits);
        if (!selected.length && !chartConsolidado?.checked) {
          throw new Error("Elegí al menos una rama, o activá vista consolidada.");
        }
        const typeSel = chartType?.value || "auto";
        const spec = C.buildDataset({
          units: state.units,
          selectedUnits: selected,
          columnId: chartColumn?.value || "count",
          consolidado: !!chartConsolidado?.checked,
          chartType: typeSel === "auto" ? null : typeSel,
          parseLooseDate,
        });
        if (chartReason) {
          chartReason.textContent = `${spec.reason} Tocá un color para ver el listado.`;
        }
        hideChartPeople();
        C.renderChart(chartCanvas, spec, { onPeopleSelect: showChartPeople });
        setChartStatus(`${spec.title} · clic en un segmento para listar personas.`);
      } catch (err) {
        setChartStatus(err.message || String(err));
        console.error(err);
      }
    }

    function openChartsModal() {
      if (!chartsModal) return;
      refreshChartControls();
      chartsModal.hidden = false;
      syncBodyModalClass();
      renderSelectedChart();
      closeChartsBtn?.focus();
    }

    function closeChartsModal() {
      if (!chartsModal) return;
      chartsModal.hidden = true;
      syncBodyModalClass();
      openChartsBtn?.focus();
    }

    openConfigBtn?.addEventListener("click", openConfigModal);
    closeConfigBtn?.addEventListener("click", closeConfigModal);
    configModal?.addEventListener("click", (e) => {
      if (e.target instanceof HTMLElement && e.target.hasAttribute("data-close-modal")) {
        closeConfigModal();
      }
    });

    openChartsBtn?.addEventListener("click", openChartsModal);
    closeChartsBtn?.addEventListener("click", closeChartsModal);
    chartsModal?.addEventListener("click", (e) => {
      if (e.target instanceof HTMLElement && e.target.hasAttribute("data-close-charts")) {
        closeChartsModal();
      }
    });
    chartColumn?.addEventListener("change", () => {
      updateChartReason();
      renderSelectedChart();
    });
    chartType?.addEventListener("change", renderSelectedChart);
    chartConsolidado?.addEventListener("change", () => {
      updateChartReason();
      renderSelectedChart();
    });
    chartUnits?.addEventListener("change", () => {
      updateChartReason();
      renderSelectedChart();
    });
    document.getElementById("chartUnitsAll")?.addEventListener("click", () => {
      chartUnits
        ?.querySelectorAll('input[name="chartUnit"]')
        .forEach((el) => {
          el.checked = true;
        });
      updateChartReason();
      renderSelectedChart();
    });
    document.getElementById("chartUnitsNone")?.addEventListener("click", () => {
      chartUnits
        ?.querySelectorAll('input[name="chartUnit"]')
        .forEach((el) => {
          el.checked = false;
        });
      updateChartReason();
      renderSelectedChart();
    });
    document.getElementById("btnCloseChartPeople")?.addEventListener("click", hideChartPeople);
    document.getElementById("btnChartRender")?.addEventListener("click", renderSelectedChart);
    document.getElementById("btnChartPng")?.addEventListener("click", () => {
      try {
        const C = window.CorrelacionCharts;
        const spec = C.getLastSpec();
        C.exportPng(`${C.safeFilename(["grafico", spec?.col?.id, state.title])}.png`);
        setChartStatus("PNG descargado.");
      } catch (err) {
        setChartStatus(err.message || String(err));
      }
    });
    document.getElementById("btnChartPdf")?.addEventListener("click", async () => {
      try {
        const C = window.CorrelacionCharts;
        const spec = C.getLastSpec();
        await C.exportPdf(`${C.safeFilename(["grafico", spec?.col?.id, state.title])}.pdf`);
        setChartStatus("PDF descargado.");
      } catch (err) {
        setChartStatus(err.message || String(err));
      }
    });
    document.getElementById("btnChartCsv")?.addEventListener("click", () => {
      try {
        const C = window.CorrelacionCharts;
        const spec = C.getLastSpec();
        C.exportCsv(`${C.safeFilename(["grafico", spec?.col?.id, state.title])}.csv`);
        setChartStatus("CSV descargado.");
      } catch (err) {
        setChartStatus(err.message || String(err));
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const summaryModal = document.getElementById("summaryModal");
      if (summaryModal && !summaryModal.hidden) {
        closeSummaryModal();
        return;
      }
      if (chartsModal && !chartsModal.hidden) {
        closeChartsModal();
        return;
      }
      if (configModal && !configModal.hidden) closeConfigModal();
    });

    document.getElementById("btnCloseSummary")?.addEventListener("click", closeSummaryModal);
    document.getElementById("summaryModal")?.addEventListener("click", (e) => {
      if (e.target instanceof HTMLElement && e.target.hasAttribute("data-close-summary")) {
        closeSummaryModal();
      }
    });

    const tryGateDistrict = () => {
      const token = String(document.getElementById("gateDistrictToken")?.value || "").trim();
      const gateStatus = document.getElementById("gateStatus");
      const expected = String(
        accessCfg?.districtView ||
          window.CorrelacionSummary?.DEFAULT_ACCESS?.districtView ||
          ""
      ).trim();
      if (!token || token.toLowerCase() !== expected.toLowerCase()) {
        if (gateStatus) gateStatus.textContent = "Clave de distrito incorrecta.";
        return;
      }
      const next = { mode: "district", rama: null, canEdit: false, via: "gate" };
      syncAccessUrl(next);
      enterSession(next);
      if (gateStatus) gateStatus.textContent = "";
      setStatus("Vista distrito (solo lectura). Usá Editar (PIN) para cambiar datos.");
    };
    document.getElementById("btnGateDistrict")?.addEventListener("click", tryGateDistrict);
    document.getElementById("gateDistrictToken")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        tryGateDistrict();
      }
    });

    document.getElementById("btnUnlockEdit")?.addEventListener("click", () => {
      if (!session) return;
      const pin = prompt(
        session.mode === "rama"
          ? `PIN de edición · Rama ${session.rama}`
          : "PIN de edición · Distrito"
      );
      if (pin == null) return;
      const ok =
        session.mode === "rama"
          ? window.CorrelacionSummary.checkRamaPin(session.rama, pin, accessCfg)
          : window.CorrelacionSummary.checkDistrictPin(pin, accessCfg);
      if (!ok) {
        alert("PIN incorrecto.");
        return;
      }
      enterSession({ ...session, canEdit: true });
      setStatus("Edición habilitada.");
    });

    document.getElementById("btnLockEdit")?.addEventListener("click", () => {
      if (!session) return;
      enterSession({ ...session, canEdit: false });
      setStatus("Volviste a solo lectura.");
    });

    document.getElementById("panel")?.addEventListener("click", (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      if (t.id === "btnSaveAccess") {
        const view = String(document.getElementById("accessDistrictView")?.value || "").trim();
        const pin = String(document.getElementById("accessDistrictPin")?.value || "").trim();
        accessCfg.districtView = view || accessCfg.districtView;
        accessCfg.districtPin = pin || accessCfg.districtPin;
        document.querySelectorAll("[data-access-rama]").forEach((inp) => {
          const rama = inp.getAttribute("data-access-rama");
          const field = inp.getAttribute("data-access-field");
          if (!accessCfg.ramas[rama]) accessCfg.ramas[rama] = { view: "", pin: "" };
          accessCfg.ramas[rama][field] = String(inp.value || "").trim();
        });
        window.CorrelacionSummary.saveAccess(accessCfg);
        renderEditors();
        renderAccessGateLinks();
        setStatus("Acceso guardado en este navegador.");
      }
    });

    document.getElementById("btnReset").addEventListener("click", () => {
      if (!confirm("¿Restablecer los datos de ejemplo?")) return;
      state = clone(window.DEFAULT_REPORT);
      if (window.CorrelacionSummary) window.CorrelacionSummary.ensureSummary(state);
      refresh();
      setStatus("Datos de ejemplo restaurados.");
      setImportStatus("");
    });

    document.getElementById("btnPasteLcr").addEventListener("click", async () => {
      try {
        const text = await navigator.clipboard.readText();
        await importFromText(text);
      } catch (err) {
        const manual = prompt(
          "No se pudo leer el portapapeles. Pegá aquí el JSON exportado de LCR:"
        );
        if (!manual) return;
        try {
          await importFromText(manual);
        } catch (e) {
          setImportStatus("JSON inválido.");
          console.error(e);
        }
      }
    });

    document.getElementById("lcrFile").addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const merge = !file.name.toLowerCase().endsWith(".json");
        await importFromText(text, { merge });
      } catch (err) {
        setImportStatus("No se pudo leer el archivo (JSON o CSV de LCR).");
        console.error(err);
      } finally {
        e.target.value = "";
      }
    });

    document.getElementById("onlyConverts").addEventListener("change", () => {
      setImportStatus("Volvé a importar para aplicar el filtro.");
    });

    applySheetsCfgToUi(loadSheetsCfg());

    els.sheetsAutosave?.addEventListener("change", () => {
      if (els.sheetsAutosave.checked) scheduleSheetsSave(400);
    });
    document.getElementById("btnSheetsSave")?.addEventListener("click", () => {
      saveToSheets({ silent: false });
    });
    document.getElementById("btnSheetsLoad")?.addEventListener("click", () => {
      loadFromSheets();
    });

    document
      .getElementById("btnPasteAttendance")
      ?.addEventListener("click", () => importAttendanceFromClipboard());

    // Si venís del bookmarklet, intentar pegar automáticamente
    if (location.hash === "#from-lcr") {
      setImportStatus("Pegá el JSON (botón Pegar JSON) o elegí lcr-export.json.");
    }
    if (location.hash === "#from-lcr-attendance") {
      setImportStatus("Esperando Sheets para pegar asistencia…");
      openConfigModal();
    }

    // Siempre Sheets. El informe no se guarda en el navegador.
    (async () => {
      clearLocalReportCache();
      setStatus("Cargando desde Google Sheets…");
      const cfg = getSheetsCfgFromUi();
      if (sheetsConfigured(cfg)) {
        const ok = await loadFromSheets();
        if (ok) {
          if (location.hash === "#from-lcr-attendance") {
            setImportStatus("Leyendo asistencia del portapapeles…");
            importAttendanceFromClipboard();
          }
          return;
        }
      }

      setStatus("No se pudo cargar Sheets. Probá de nuevo o usá Cargar.");
      const forceLcr =
        location.hash === "#from-lcr" ||
        new URLSearchParams(location.search).get("lcr") === "1";
      if (!forceLcr) return;

      // Fallback solo para ver en local si Sheets falló. Nunca subir esto:
      // lcr-export no trae asistencia y pisaría Sheets.
      try {
        const jsonRes = await fetch("lcr-export.json", { cache: "no-store" });
        if (jsonRes.ok) {
          const payload = await jsonRes.json();
          if (payload?.units) {
            applyLcrPayload(payload, { skipHandMerge: true });
            setStatus("Vista local de respaldo (no se guardó en Sheets).");
          }
        }
      } catch (_) {}
    })();

    document.getElementById("btnPrint").addEventListener("click", () => {
      window.print();
    });

    document.getElementById("btnDownload").addEventListener("click", async () => {
      await downloadPdf();
    });
  }

  async function downloadPdf() {
    setStatus("Generando PDF…");
    const safe = (s) =>
      String(s || "informe")
        .replace(/[^\w\-áéíóúñÁÉÍÓÚÑ]+/gi, "_")
        .replace(/_+/g, "_");
    const filename = `Correlacion_${safe(state.title)}_${safe(state.period)}.pdf`;

    const JsPDF = window.jspdf && window.jspdf.jsPDF;
    if (typeof html2canvas !== "function" || !JsPDF) {
      setStatus("Librerías PDF no cargaron. Usá Imprimir → Guardar como PDF.");
      window.print();
      return;
    }

    const pages = [...els.report.querySelectorAll(".page")];
    if (!pages.length) {
      setStatus("No hay páginas para exportar.");
      return;
    }

    const btn = document.getElementById("btnDownload");
    btn.disabled = true;

    const host = document.createElement("div");
    host.id = "pdf-capture-host";
    Object.assign(host.style, {
      position: "fixed",
      left: "0",
      top: "0",
      width: "1200px",
      background: "#ffffff",
      zIndex: "2147483646",
      opacity: "0.01",
      pointerEvents: "none",
      overflow: "visible",
    });
    document.body.appendChild(host);

    try {
      const doc = new JsPDF({
        unit: "mm",
        format: "a4",
        orientation: "landscape",
      });
      const margin = 8;
      const usableW = 297 - margin * 2;
      const usableH = 210 - margin * 2;
      let firstPage = true;

      for (let i = 0; i < pages.length; i++) {
        setStatus(`Generando PDF… ${i + 1}/${pages.length}`);
        host.innerHTML = "";
        const clone = pages[i].cloneNode(true);
        clone.style.width = "1200px";
        clone.style.maxWidth = "1200px";
        clone.style.boxShadow = "none";
        clone.style.borderRadius = "0";
        clone.style.margin = "0";
        clone.style.background = "#ffffff";
        host.appendChild(clone);

        await new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r))
        );

        const canvas = await html2canvas(clone, {
          scale: 1.5,
          useCORS: true,
          backgroundColor: "#ffffff",
          logging: false,
          windowWidth: 1200,
          scrollX: 0,
          scrollY: 0,
          onclone: (_doc, el) => {
            el.style.opacity = "1";
            el.style.transform = "none";
            el.querySelectorAll(".no-print, .th-filter, .th-range, .table-count").forEach(
              (n) => n.remove()
            );
            el.querySelectorAll(".only-print").forEach((n) => {
              n.style.display = "inline";
            });
            el.querySelectorAll("thead th[data-sort]").forEach((th) => {
              th.classList.remove("is-sorted-asc", "is-sorted-desc");
            });
            el.querySelectorAll(".th-sort").forEach((btn) => {
              const label = btn.textContent.trim();
              btn.replaceWith(document.createTextNode(label));
            });
          },
        });

        if (!canvas.width || !canvas.height) {
          throw new Error(`Canvas vacío en página ${i + 1}`);
        }

        const pxPerMm = canvas.width / usableW;
        let srcY = 0;
        let remainingPx = canvas.height;

        while (remainingPx > 1) {
          const sliceHpx = Math.min(remainingPx, Math.floor(usableH * pxPerMm));
          const sliceCanvas = document.createElement("canvas");
          sliceCanvas.width = canvas.width;
          sliceCanvas.height = Math.max(1, sliceHpx);
          const ctx = sliceCanvas.getContext("2d");
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
          ctx.drawImage(
            canvas,
            0,
            srcY,
            canvas.width,
            sliceHpx,
            0,
            0,
            canvas.width,
            sliceHpx
          );

          const sliceHmm = sliceHpx / pxPerMm;
          const imgData = sliceCanvas.toDataURL("image/jpeg", 0.93);

          if (!firstPage) doc.addPage();
          firstPage = false;
          doc.addImage(imgData, "JPEG", margin, margin, usableW, sliceHmm);

          srcY += sliceHpx;
          remainingPx -= sliceHpx;
        }
      }

      doc.save(filename);
      setStatus(`Descargado: ${filename}`);
    } catch (err) {
      console.error(err);
      setStatus(
        "Falló la descarga automática. Se abre Imprimir → elegí Guardar como PDF."
      );
      window.print();
    } finally {
      btn.disabled = false;
      host.remove();
    }
  }

  function bootAccess() {
    if (!window.CorrelacionSummary) {
      session = { mode: "district", rama: null, canEdit: true, via: "fallback" };
      return;
    }
    accessCfg = window.CorrelacionSummary.loadAccess();
    const fromUrl = window.CorrelacionSummary.resolveAccessFromUrl(accessCfg);
    if (fromUrl) {
      const prev = window.CorrelacionSummary.loadSession();
      if (
        prev &&
        prev.mode === fromUrl.mode &&
        prev.rama === fromUrl.rama &&
        prev.canEdit
      ) {
        fromUrl.canEdit = true;
      }
      session = fromUrl;
      window.CorrelacionSummary.saveSession(session);
      return;
    }
    const prev = window.CorrelacionSummary.loadSession();
    if (prev?.mode === "district") {
      session = prev;
      return;
    }
    session = null;
    window.CorrelacionSummary.saveSession(null);
  }

  bootAccess();
  bind();
  renderAccessGateLinks();
  applyAccessChrome();
  // Pintá UI si hay sesión, pero sin autosave: el informe real llega de Sheets.
  if (session) {
    suppressSheetsSave = true;
    try {
      refresh();
    } finally {
      suppressSheetsSave = false;
    }
  }
})();
