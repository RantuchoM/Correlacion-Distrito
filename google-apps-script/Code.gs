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
 */

var SCRIPT_TOKEN = "CAMBIAR_ESTE_TOKEN";
var SHEET_MIEMBROS = "Miembros";
var SHEET_INFORME = "Informe";
var SHEET_ACCESO = "Acceso";
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
  var sh = ensureSheet_(SHEET_INFORME);
  sh.clear();
  sh.getRange(1, 1).setValue(JSON.stringify(report));
  sh.getRange(2, 1).setValue(new Date().toISOString());
  writeMiembrosFromReport_(report);
  writeAccesoSheet_();
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
  var sh = getSpreadsheet_().getSheetByName(SHEET_INFORME);
  if (sh) {
    var raw = String(sh.getRange(1, 1).getValue() || "").trim();
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch (e) {
        // fall through to miembros
      }
    }
  }
  return miembrosSheetToReport_();
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
      rows.push([
        m.name || "",
        unit.name || "",
        m.age || "",
        m.sex || "",
        m.baptism || "",
        m.attendance || "",
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
    sh.getRange(1, 1, rows.length, headers.length).setValues(rows);
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
