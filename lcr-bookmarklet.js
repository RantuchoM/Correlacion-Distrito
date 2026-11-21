/**
 * Extrae tablas de informes personalizados de LCR
 * (create-a-report / custom-reports-details).
 */
(function extractLcrCustomReport() {
  function clean(td) {
    const el = td.querySelector("button, a");
    let t = ((el && el.textContent) || td.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
    const prefixes = [
      "record.preferred.name",
      "custom-reports.unit",
      "Edad",
      "Sexo",
      "Oficio en el sacerdocio",
      "record.callings",
      "custom-reports.is.convert",
      "record.home.teachers",
      "record.visiting.teachers",
      "custom-reports.temple.recommend.expiration.date",
    ];
    for (const p of prefixes) {
      if (t.startsWith(p)) t = t.slice(p.length).trim();
    }
    return t;
  }

  const unitInfo = (
    document.querySelector(".mltp-unit-info-right") || {}
  ).textContent;
  const blocks = [
    ...document.querySelectorAll(".details__grouped-sections-grid > div"),
  ];

  let units = blocks
    .map((block) => {
      const name =
        (block.querySelector(".details__section-title") || {}).textContent?.trim() ||
        "Unidad";
      const table = block.querySelector("table");
      const members = [...(table ? table.querySelectorAll("tbody tr") : [])]
        .map((tr) => {
          const c = [...tr.children].map(clean);
          return {
            name: c[0] || "",
            unit: c[1] || name,
            age: c[2] || "",
            sex: c[3] || "",
            priesthood: c[4] || "",
            callings: c[5] || "",
            isConvert: c[6] || "",
            homeTeachers: c[7] || "",
            visitingTeachers: c[8] || "",
            templeDate: c[9] || "",
          };
        })
        .filter((r) => r.name);
      return { name, members };
    })
    .filter((u) => u.members.length);

  // Fallback: tablas sueltas si el layout cambió
  if (!units.length) {
    const tables = [...document.querySelectorAll("table")];
    units = tables.map((table, i) => {
      const titleEl = table
        .closest("div")
        ?.parentElement?.querySelector(".details__section-title");
      const name = titleEl?.textContent?.trim() || `Unidad ${i + 1}`;
      const members = [...table.querySelectorAll("tbody tr")]
        .map((tr) => {
          const c = [...tr.children].map(clean);
          return {
            name: c[0] || "",
            unit: c[1] || name,
            age: c[2] || "",
            sex: c[3] || "",
            priesthood: c[4] || "",
            callings: c[5] || "",
            isConvert: c[6] || "",
            homeTeachers: c[7] || "",
            visitingTeachers: c[8] || "",
            templeDate: c[9] || "",
          };
        })
        .filter((r) => r.name);
      return { name, members };
    }).filter((u) => u.members.length);
  }

  const payload = {
    source: "lcr",
    scrapedAt: new Date().toISOString(),
    url: location.href,
    unitInfo: (unitInfo || "").replace(/\s+/g, " ").trim(),
    units,
  };

  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "lcr-export.json";
  document.body.appendChild(a);
  a.click();
  a.remove();

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(json).catch(() => {});
  }

  const total = units.reduce((n, u) => n + u.members.length, 0);
  const appUrl = "http://127.0.0.1:8765/#from-lcr";
  const go = confirm(
    `LCR: ${units.length} unidades, ${total} filas.\n\nSe descargó lcr-export.json` +
      (navigator.clipboard ? " y se copió al portapapeles." : ".") +
      `\n\n¿Abrir la app de Correlación?`
  );
  if (go) window.open(appUrl, "_blank");
  return payload;
})();
