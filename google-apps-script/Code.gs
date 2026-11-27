/**
 * Correlación Distrito — backend mínimo para GitHub Pages
 *
 * Setup:
 * 1. Creá una Google Sheet vacía.
 * 2. Extensiones → Apps Script → pegá este archivo.
 * 3. Cambiá SCRIPT_TOKEN por un secreto tuyo.
 * 4. Implementar → Nueva implementación → Tipo: Aplicación web
 *    - Ejecutar como: Yo
 *    - Quién tiene acceso: Cualquier persona
 * 5. Copiá la URL de la app web y pegala en la app (campo "URL Apps Script").
 *
 * La app envía Content-Type: text/plain (evita preflight CORS).
 *
 * Hojas:
 * - Informe: JSON del informe (sin historial domingo-a-domingo; eso va a Asistencia).
 * - Miembros: tabla legible (ratio de asistencia en columna).
 * - Asistencia: una fila por persona × domingo (acumulable).
 * - Acceso: links cortos.
 */

var SCRIPT_TOKEN = "CAMBIAR_ESTE_TOKEN";
var SHEET_MIEMBROS = "Miembros";
var SHEET_INFORME = "Informe";
var SHEET_ACCESO = "Acceso";
var SHEET_ASISTENCIA = "Asistencia";
/** URL pública de la app (GitHub Pages). */
var APP_BASE_URL = "https://rantuchom.github.io/Correlacion-Distrito/";

function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    assertToken_(p.token);
    var action = String(p.action || "load");
    if (action === "ping") {
      return json_({ ok: true, ping: true });
    }
    if (action === "seedAcceso") {
      writeAccesoSheet_();
      return json_({ ok: true, sheet: SHEET_ACCESO });
    }
    return json_({ ok: true, report: loadReport_() });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function doPost(e) {
  try {
    var raw = e && e.postData && e.postData.contents ? e.postData.contents : "{}";
    var body = JSON.parse(raw);
    assertToken_(body.token);
    var action = String(body.action || "save");

    if (action === "save") {
      if (!body.report) throw new Error("Falta report");
      saveReport_(body.report);
      return json_({ ok: true, savedAt: new Date().toISOString() });
    }

    if (action === "saveCsv") {
      if (!body.csv) throw new Error("Falta csv");
      saveMiembrosCsv_(String(body.csv));
      return json_({ ok: true, savedAt: new Date().toISOString() });
    }

    if (action === "load") {
      return json_({ ok: true, report: loadReport_() });
    }

    throw new Error("Acción desconocida: " + action);
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function assertToken_(token) {
  if (!SCRIPT_TOKEN || SCRIPT_TOKEN === "CAMBIAR_ESTE_TOKEN") {
    throw new Error("Configurá SCRIPT_TOKEN en Code.gs");
  }
  if (String(token || "") !== SCRIPT_TOKEN) {
    throw new Error("Token inválido");
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function getSpreadsheet_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function ensureSheet_(name) {
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

function saveReport_(report) {
  writeAsistenciaFromReport_(report);
  writeMiembrosFromReport_(report);
  writeAccesoSheet_();

  // Informe JSON sin attendanceByDate (el historial vive en la pestaña Asistencia).
  var slim = JSON.parse(JSON.stringify(report || {}));
  stripAttendanceLog_(slim);
  var sh = ensureSheet_(SHEET_INFORME);
  sh.clear();
  sh.getRange(1, 1).setValue(JSON.stringify(slim));
  sh.getRange(2, 1).setValue(new Date().toISOString());
}

/** Ejecutable desde el editor: rellena la pestaña Acceso. */
function seedAcceso() {
  writeAccesoSheet_();
}

/**
 * Pestaña Acceso: links cortos por rama / distrito (para compartir fuera de la landing).
 * Tokens/PIN por defecto alineados con summary.js DEFAULT_ACCESS.
 */
function writeAccesoSheet_() {
  var base = String(APP_BASE_URL || "").replace(/\/?$/, "/");
  var rows = [
    ["Vista", "Token ver", "PIN editar", "Link"],
    ["Distrito (general)", "dv1", "2026", base + "?d=dv1"],
    ["Rama América", "am1", "1111", base + "?rama=América&v=am1"],
    ["Rama Viedma", "vi1", "2222", base + "?rama=Viedma&v=vi1"],
    [
      "Rama Carmen de Patagones",
      "cp1",
      "3333",
      base + "?rama=Carmen%20de%20Patagones&v=cp1",
    ],
    [
      "Rama San Antonio Oeste",
      "sa1",
      "4444",
      base + "?rama=San%20Antonio%20Oeste&v=sa1",
    ],
  ];
  var sh = ensureSheet_(SHEET_ACCESO);
  sh.clear();
  sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, 4);
}

function loadReport_() {
  var report = null;
  var sh = getSpreadsheet_().getSheetByName(SHEET_INFORME);
  if (sh) {
    var raw = String(sh.getRange(1, 1).getValue() || "").trim();
    if (raw) {
      try {
        report = JSON.parse(raw);
      } catch (e) {
        report = null;
      }
    }
  }
  if (!report) report = miembrosSheetToReport_();
  applyAsistenciaSheetToReport_(report);
  syncAttendanceDisplays_(report);
  return report;
}

function stripAttendanceLog_(report) {
  (report.units || []).forEach(function (unit) {
    (unit.members || []).forEach(function (m) {
      if (m && m.attendanceByDate) delete m.attendanceByDate;
    });
  });
}

function lastNSundayKeys_(n, fromDate) {
  var from = fromDate ? new Date(fromDate) : new Date();
  var d = new Date(Date.UTC(from.getFullYear(), from.getMonth(), from.getDate()));
  var day = d.getUTCDay();
  var add = day === 0 ? 0 : 7 - day;
  d.setUTCDate(d.getUTCDate() + add);
  var out = [];
  for (var i = 0; i < n; i++) {
    var x = new Date(d.getTime());
    x.setUTCDate(d.getUTCDate() - i * 7);
    out.push(x.toISOString().slice(0, 10));
  }
  return out;
}

function attendanceRatioFromLog_(byDate, n) {
  n = n || 6;
  var weeks = lastNSundayKeys_(n);
  var done = 0;
  for (var i = 0; i < weeks.length; i++) {
    if (byDate && byDate[weeks[i]] === true) done += 1;
  }
  return done + "/" + n;
}

function syncAttendanceDisplays_(report) {
  (report.units || []).forEach(function (unit) {
    (unit.members || []).forEach(function (m) {
      if (m && m.attendanceByDate && Object.keys(m.attendanceByDate).length) {
        m.attendance = attendanceRatioFromLog_(m.attendanceByDate, 6);
      }
    });
  });
}

/**
 * Formato largo acumulable:
 * Nombre | Unidad | Domingo | Asistió
 */
function writeAsistenciaFromReport_(report) {
  var headers = ["Nombre", "Unidad", "Domingo", "Asistió"];
  var rows = [headers];
  (report.units || []).forEach(function (unit) {
    (unit.members || []).forEach(function (m) {
      var log = m && m.attendanceByDate;
      if (!log || typeof log !== "object") return;
      var dates = Object.keys(log).sort();
      for (var i = 0; i < dates.length; i++) {
        var iso = dates[i];
        rows.push([
          m.name || "",
          unit.name || "",
          iso,
          log[iso] === true ? "Sí" : "No",
        ]);
      }
    });
  });
  var sh = ensureSheet_(SHEET_ASISTENCIA);
  sh.clear();
  if (rows.length) {
    var range = sh.getRange(1, 1, rows.length, headers.length);
    range.setNumberFormat("@");
    range.setValues(rows);
  }
  sh.setFrozenRows(1);
}

function applyAsistenciaSheetToReport_(report) {
  var sh = getSpreadsheet_().getSheetByName(SHEET_ASISTENCIA);
  if (!sh || sh.getLastRow() < 2) return report;

  var values = sh.getDataRange().getValues();
  var headers = values[0].map(function (h) {
    return String(h || "").trim();
  });
  function col(name) {
    return headers.indexOf(name);
  }
  var iName = col("Nombre");
  var iUnit = col("Unidad");
  var iDay = col("Domingo");
  var iAtt = col("Asistió");
  if (iName < 0 || iUnit < 0 || iDay < 0 || iAtt < 0) return report;

  function normName(value) {
    return String(value || "")
      .replace(/,/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }
  function nameKey(value) {
    return normName(value)
      .split(" ")
      .filter(Boolean)
      .sort()
      .join(" ");
  }
  function normUnit(name) {
    return String(name || "")
      .replace(/^Rama\s+/i, "")
      .trim()
      .toLowerCase();
  }

  var byUnitKey = {};
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var name = String(row[iName] || "").trim();
    var unit = String(row[iUnit] || "").trim();
    var day = String(row[iDay] || "").trim().slice(0, 10);
    var attRaw = String(row[iAtt] || "").trim().toLowerCase();
    if (!name || !day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    var attended =
      attRaw === "sí" ||
      attRaw === "si" ||
      attRaw === "true" ||
      attRaw === "1" ||
      attRaw === "x";
    var key = normUnit(unit) + "::" + nameKey(name);
    if (!byUnitKey[key]) byUnitKey[key] = {};
    byUnitKey[key][day] = attended;
  }

  (report.units || []).forEach(function (unit) {
    (unit.members || []).forEach(function (m) {
      var key = normUnit(unit.name) + "::" + nameKey(m.name);
      var log = byUnitKey[key];
      if (!log) return;
      if (!m.attendanceByDate || typeof m.attendanceByDate !== "object") {
        m.attendanceByDate = {};
      }
      Object.keys(log).forEach(function (d) {
        m.attendanceByDate[d] = log[d];
      });
    });
  });
  return report;
}

function writeMiembrosFromReport_(report) {
  var headers = [
    "Nombre de preferencia",
    "Unidad",
    "Edad",
    "Sexo",
    "Fecha bautismo",
    "Asistencia",
    "Rec. templo",
    "Llamamiento",
    "Asignación",
    "Informe",
    "Dato",
    "Es converso",
  ];
  var rows = [headers];
  (report.units || []).forEach(function (unit) {
    (unit.members || []).forEach(function (m) {
      var ratio = m.attendance || "";
      if (m.attendanceByDate && Object.keys(m.attendanceByDate).length) {
        ratio = attendanceRatioFromLog_(m.attendanceByDate, 6);
      }
      rows.push([
        m.name || "",
        unit.name || "",
        m.age || "",
        m.sex || "",
        m.baptism || "",
        ratio,
        m.temple || "",
        m.calling || "",
        m.assignment || "",
        m.report || "",
        m.dato || "",
        "Sí",
      ]);
    });
  });
  var sh = ensureSheet_(SHEET_MIEMBROS);
  sh.clear();
  if (rows.length) {
    var range = sh.getRange(1, 1, rows.length, headers.length);
    // Texto puro: evita que "3/6" se convierta en fecha.
    range.setNumberFormat("@");
    range.setValues(rows);
  }
}

function saveMiembrosCsv_(csvText) {
  var lines = Utilities.parseCsv(csvText);
  if (!lines || !lines.length) throw new Error("CSV vacío");
  var sh = ensureSheet_(SHEET_MIEMBROS);
  sh.clear();
  sh.getRange(1, 1, lines.length, lines[0].length).setValues(lines);
}

function miembrosSheetToReport_() {
  var sh = getSpreadsheet_().getSheetByName(SHEET_MIEMBROS);
  if (!sh || sh.getLastRow() < 2) {
    return {
      title: "Distrito Viedma",
      period: "",
      years: { previous: new Date().getFullYear() - 1, current: new Date().getFullYear() },
      baptisms: [],
      goals: [],
      upcoming: [],
      units: [],
      summaryRows: [],
      summaryUnits: [],
    };
  }
  var values = sh.getDataRange().getValues();
  var headers = values[0].map(function (h) {
    return String(h || "").trim();
  });
  function col(name) {
    return headers.indexOf(name);
  }
  function cell(row, name) {
    var i = col(name);
    return i >= 0 ? String(row[i] || "").trim() : "";
  }

  var byUnit = {};
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var unit = cell(row, "Unidad");
    var name = cell(row, "Nombre de preferencia");
    if (!unit || !name) continue;
    if (!byUnit[unit]) byUnit[unit] = [];
    byUnit[unit].push({
      name: name,
      baptism: cell(row, "Fecha bautismo"),
      age: cell(row, "Edad"),
      sex: cell(row, "Sexo"),
      attendance: cell(row, "Asistencia"),
      temple: cell(row, "Rec. templo"),
      calling: cell(row, "Llamamiento"),
      assignment: cell(row, "Asignación"),
      report: cell(row, "Informe"),
      dato: cell(row, "Dato"),
    });
  }

  var units = Object.keys(byUnit).map(function (u) {
    return { name: u, members: byUnit[u] };
  });

  return {
    title: "Distrito Viedma",
    period: "",
    years: {
      previous: new Date().getFullYear() - 1,
      current: new Date().getFullYear(),
    },
    baptisms: units.map(function (u) {
      return {
        unit: String(u.name).replace(/^Rama\s+/i, ""),
        prev: 0,
        curr: (u.members || []).length,
      };
    }),
    goals: [],
    upcoming: [],
    units: units,
    summaryUnits: units.map(function (u) {
      return String(u.name).replace(/^Rama\s+/i, "");
    }),
    summaryRows: [],
  };
}
