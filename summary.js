(() => {
  const MEETING_LABELS = [
    "Consejo de rama",
    "Correlación",
    "Encuentro breve",
    "Fundamentos del Evangelio",
  ];

  const ACCESS_KEY = "correlacion-distrito-access-v1";
  const SESSION_KEY = "correlacion-distrito-session-v1";

  const DEFAULT_ACCESS = {
    districtView: "dv1",
    districtPin: "2026",
    ramas: {
      América: { view: "am1", pin: "1111" },
      Viedma: { view: "vi1", pin: "2222" },
      "Carmen de Patagones": { view: "cp1", pin: "3333" },
      "San Antonio Oeste": { view: "sa1", pin: "4444" },
    },
  };

  function clone(o) {
    return JSON.parse(JSON.stringify(o));
  }

  function shortUnit(name) {
    return String(name || "")
      .replace(/^Rama\s+/i, "")
      .trim();
  }

  function normUnit(name) {
    return shortUnit(name)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("es");
  }

  function findUnitKey(map, name) {
    const n = normUnit(name);
    return Object.keys(map || {}).find((k) => normUnit(k) === n) || shortUnit(name);
  }

  /** Domingos del año (ISO yyyy-mm-dd, UTC). */
  function sundaysOfYear(year) {
    const out = [];
    const d = new Date(Date.UTC(year, 0, 1));
    const day = d.getUTCDay();
    const add = day === 0 ? 0 : 7 - day;
    d.setUTCDate(d.getUTCDate() + add);
    while (d.getUTCFullYear() === year) {
      out.push(d.toISOString().slice(0, 10));
      d.setUTCDate(d.getUTCDate() + 7);
    }
    return out;
  }

  function lastNSundays(year, n = 6, before = new Date()) {
    const all = sundaysOfYear(year);
    const today = before.toISOString().slice(0, 10);
    const upto = all.filter((s) => s <= today);
    const list = (upto.length ? upto : all).slice(-n);
    return list;
  }

  function formatSundayLabel(iso) {
    const d = new Date(iso + "T12:00:00");
    const months = [
      "ene",
      "feb",
      "mar",
      "abr",
      "mayo",
      "jun",
      "jul",
      "ago",
      "sep",
      "oct",
      "nov",
      "dic",
    ];
    return `${d.getDate()} ${months[d.getMonth()]}`;
  }

  function emptySummary(units) {
    const labels = (units || []).map(shortUnit);
    const meetings = {};
    for (const label of MEETING_LABELS) {
      meetings[label] = {};
      for (const u of labels) meetings[label][u] = {};
    }
    const leaders = {};
    const missionaries = {};
    for (const u of labels) {
      leaders[u] = [];
      missionaries[u] = [];
    }
    return { meetingLabels: MEETING_LABELS.slice(), meetings, leaders, missionaries };
  }

  function ensureSummary(report) {
    if (!report) return report;
    const units = (report.summaryUnits || []).length
      ? report.summaryUnits.map(shortUnit)
      : (report.units || []).map((u) => shortUnit(u.name));
    report.summaryUnits = units.length ? units : ["América", "Viedma", "Carmen de Patagones", "San Antonio Oeste"];

    if (!report.summary || typeof report.summary !== "object") {
      report.summary = emptySummary(report.summaryUnits);
    }
    const s = report.summary;
    if (!Array.isArray(s.meetingLabels) || !s.meetingLabels.length) {
      s.meetingLabels = MEETING_LABELS.slice();
    }
    if (!s.meetings) s.meetings = {};
    if (!s.leaders) s.leaders = {};
    if (!s.missionaries) s.missionaries = {};

    for (const label of s.meetingLabels) {
      if (!s.meetings[label]) s.meetings[label] = {};
      for (const u of report.summaryUnits) {
        const key = findUnitKey(s.meetings[label], u);
        if (!s.meetings[label][u]) {
          s.meetings[label][u] = s.meetings[label][key] || {};
        }
      }
    }
    for (const u of report.summaryUnits) {
      if (!s.leaders[u]) s.leaders[u] = s.leaders[findUnitKey(s.leaders, u)] || [];
      if (!s.missionaries[u]) {
        s.missionaries[u] = s.missionaries[findUnitKey(s.missionaries, u)] || [];
      }
    }
    return report;
  }

  function meetingScore(summary, label, unit, weeks) {
    const map = summary?.meetings?.[label]?.[unit] || {};
    let n = 0;
    for (const w of weeks) if (map[w]) n += 1;
    return { done: n, total: weeks.length };
  }

  function meetingClass(done, total) {
    if (!total) return "";
    if (done <= 0) return "att-0";
    if (done <= 2) return "att-low";
    if (done <= 4) return "att-mid";
    return "att-high";
  }

  function activePeople(list) {
    return (list || []).filter((p) => p && !p.releasedAt);
  }

  function currentLeader(list) {
    const act = activePeople(list);
    return act.length ? act[act.length - 1] : null;
  }

  function personLabel(p) {
    if (!p) return "—";
    const last = String(p.last || "").trim();
    const first = String(p.first || "").trim();
    if (last && first) return `${last}, ${first}`;
    return last || first || "—";
  }

  function loadAccess() {
    try {
      const raw = localStorage.getItem(ACCESS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          ...clone(DEFAULT_ACCESS),
          ...parsed,
          ramas: { ...DEFAULT_ACCESS.ramas, ...(parsed.ramas || {}) },
        };
      }
    } catch (_) {}
    return clone(DEFAULT_ACCESS);
  }

  function saveAccess(cfg) {
    localStorage.setItem(ACCESS_KEY, JSON.stringify(cfg));
    return cfg;
  }

  function loadSession() {
    try {
      return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
    } catch (_) {
      return null;
    }
  }

  function saveSession(session) {
    if (!session) sessionStorage.removeItem(SESSION_KEY);
    else sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  function resolveAccessFromUrl(access = loadAccess()) {
    const q = new URLSearchParams(location.search);
    const ramaParam = q.get("rama");
    const v = String(q.get("v") || "").trim();
    const d = String(q.get("d") || q.get("distrito") || "").trim();
    const vista = String(q.get("vista") || "").trim().toLowerCase();
    const districtToken = String(
      access.districtView || DEFAULT_ACCESS.districtView || ""
    ).trim();
    const dMatch =
      d && districtToken && d.toLowerCase() === districtToken.toLowerCase();

    if (dMatch) {
      return { mode: "district", rama: null, canEdit: false, via: "url-district" };
    }
    // Compat: ?vista=distrito&d=…
    if (vista === "distrito" && dMatch) {
      return { mode: "district", rama: null, canEdit: false, via: "url-district" };
    }

    if (ramaParam && v) {
      const ramas = access.ramas || {};
      const key = Object.keys(ramas).find(
        (k) =>
          normUnit(k) === normUnit(ramaParam) &&
          String(ramas[k].view || "") === v
      );
      if (key) {
        return { mode: "rama", rama: key, canEdit: false, via: "url-rama" };
      }
    }
    return null;
  }

  function checkDistrictPin(pin, access = loadAccess()) {
    return String(pin || "") === String(access.districtPin || "");
  }

  function checkRamaPin(rama, pin, access = loadAccess()) {
    const key = findUnitKey(access.ramas, rama);
    const cfg = access.ramas?.[key];
    return cfg && String(pin || "") === String(cfg.pin || "");
  }

  function ramaViewLink(rama, access = loadAccess(), origin = location.origin + location.pathname) {
    const key = findUnitKey(access.ramas, rama);
    const cfg = access.ramas?.[key];
    if (!cfg?.view) return "";
    const url = new URL(origin);
    url.searchParams.set("rama", key);
    url.searchParams.set("v", cfg.view);
    return url.toString();
  }

  function districtViewLink(access = loadAccess(), origin = location.origin + location.pathname) {
    const url = new URL(origin);
    url.searchParams.set("d", access.districtView || "dv1");
    return url.toString();
  }

  window.CorrelacionSummary = {
    MEETING_LABELS,
    DEFAULT_ACCESS,
    shortUnit,
    normUnit,
    findUnitKey,
    sundaysOfYear,
    lastNSundays,
    formatSundayLabel,
    emptySummary,
    ensureSummary,
    meetingScore,
    meetingClass,
    activePeople,
    currentLeader,
    personLabel,
    loadAccess,
    saveAccess,
    loadSession,
    saveSession,
    resolveAccessFromUrl,
    checkDistrictPin,
    checkRamaPin,
    ramaViewLink,
    districtViewLink,
  };
})();
