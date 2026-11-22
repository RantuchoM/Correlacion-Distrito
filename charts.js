(() => {
  const COLORS = [
    "#0b5f6b",
    "#c45c26",
    "#1f7a4c",
    "#3d6ea8",
    "#8a6d1d",
    "#7a3e8a",
    "#a11f2c",
    "#2f6f5e",
    "#5c6b76",
    "#147a88",
  ];

  const COLUMNS = [
    { id: "count", label: "Cantidad de personas", kind: "count" },
    { id: "sex", label: "Sexo", kind: "category" },
    { id: "age", label: "Edad", kind: "numeric" },
    { id: "baptism", label: "Fecha bautismo", kind: "date" },
    { id: "attendance", label: "Asistencia", kind: "ratio" },
    { id: "temple", label: "Rec. templo", kind: "category" },
    { id: "calling", label: "Llamamiento", kind: "category" },
    { id: "assignment", label: "Asignación", kind: "category" },
    { id: "report", label: "Informe", kind: "category" },
    { id: "dato", label: "Dato", kind: "text" },
  ];

  let chartInstance = null;
  let lastSpec = null;

  function colMeta(id) {
    return COLUMNS.find((c) => c.id === id) || COLUMNS[0];
  }

  function shortUnit(name) {
    return String(name || "")
      .replace(/^Rama\s+/i, "")
      .trim() || "—";
  }

  function memberAge(m) {
    const n = Number(String(m.age ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }

  function parseAttendanceRatio(value) {
    const m = String(value || "").match(/(\d+)\s*\/\s*(\d+)/);
    if (!m) return null;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (!b) return null;
    return Math.max(0, Math.min(1, a / b));
  }

  function categoryLabel(raw, field) {
    const v = String(raw ?? "").trim();
    if (!v) {
      if (field === "assignment" || field === "report") return "Pendiente";
      return "Sin dato";
    }
    return v;
  }

  function collectMembers(units, selectedNames) {
    const set = new Set(selectedNames);
    const rows = [];
    for (const unit of units || []) {
      if (!set.has(unit.name)) continue;
      for (const m of unit.members || []) {
        rows.push({ unit: unit.name, member: m });
      }
    }
    return rows;
  }

  function recommend(kind, { unitCount, consolidado }) {
    // consolidado = una sola serie agregada; por ramas = comparar series
    const single = consolidado || unitCount <= 1;
    if (kind === "count") {
      return {
        type: "bar",
        reason: single
          ? "Cantidad total de personas en la selección."
          : "Barras para comparar cantidad de personas entre ramas.",
      };
    }
    if (kind === "category" || kind === "text") {
      if (single) {
        return {
          type: "doughnut",
          reason: consolidado
            ? "Dona del consolidado: composición de todas las ramas elegidas juntas."
            : "Dona para ver la composición de una sola rama.",
        };
      }
      return {
        type: "bar",
        reason: "Cada rama es una barra al 100%; los cortes son el % de cada opción.",
        percentStacked: true,
      };
    }
    if (kind === "numeric") {
      if (single) {
        return {
          type: "bar",
          reason: consolidado
            ? "Histograma de edades en el consolidado."
            : "Histograma de edades en la rama seleccionada.",
          histogram: true,
        };
      }
      return {
        type: "bar",
        reason: "Barras con edad promedio (y conteo) por rama.",
        averages: true,
      };
    }
    if (kind === "ratio") {
      if (single) {
        return {
          type: "bar",
          reason: consolidado
            ? "Distribución de asistencia en el consolidado."
            : "Distribución de asistencia en rangos (0%, parcial, ≥50%, 100%).",
          buckets: true,
        };
      }
      return {
        type: "bar",
        reason: "Porcentaje promedio de asistencia por rama.",
        averages: true,
      };
    }
    if (kind === "date") {
      return {
        type: "bar",
        reason: single
          ? "Conteo de bautismos por mes en la selección."
          : "Cada rama es una barra al 100%; los cortes son el % por mes.",
        timeline: true,
        percentStacked: !single,
      };
    }
    return { type: "bar", reason: "Barras como vista general." };
  }

  function countBy(values) {
    const map = new Map();
    for (const v of values) {
      map.set(v, (map.get(v) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), "es"));
  }

  function histogram(nums, binSize = 5) {
    if (!nums.length) return [];
    const min = Math.floor(Math.min(...nums) / binSize) * binSize;
    const max = Math.ceil(Math.max(...nums) / binSize) * binSize;
    const bins = [];
    for (let start = min; start < max; start += binSize) {
      const end = start + binSize - 1;
      const label = `${start}-${end}`;
      const n = nums.filter((x) => x >= start && x <= end).length;
      bins.push([label, n]);
    }
    return bins;
  }

  function attendanceBucket(ratio) {
    if (ratio == null) return "Sin dato";
    if (ratio === 0) return "0%";
    if (ratio < 0.5) return "1–49%";
    if (ratio < 1) return "50–99%";
    return "100%";
  }

  function monthKey(raw, parseLooseDate) {
    const ts = parseLooseDate(raw);
    if (ts == null) return "Sin fecha";
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }

  function buildDataset({
    units,
    selectedUnits,
    columnId,
    consolidado,
    chartType,
    parseLooseDate,
  }) {
    const col = colMeta(columnId);
    const selected = selectedUnits.filter(Boolean);
    const poolNames =
      selected.length > 0 ? selected : (units || []).map((u) => u.name);
    const rec = recommend(col.kind, {
      unitCount: consolidado ? 1 : selected.length,
      consolidado: !!consolidado,
    });
    let type = chartType || rec.type;
    // Nunca apilar consolidado con ramas: o vista consolidada (1 serie) o comparación por ramas.
    let stacked = false;
    let percentStacked = false;
    let showValues = false;

    let groups;
    if (consolidado) {
      groups = [
        {
          key: "__all__",
          label: "Consolidado",
          rows: collectMembers(units, poolNames),
        },
      ];
    } else {
      groups = selected.map((name) => ({
        key: name,
        label: shortUnit(name),
        rows: collectMembers(units, [name]),
      }));
    }

    if (!groups.length) {
      throw new Error("Elegí al menos una rama, o activá vista consolidada.");
    }

    const titleParts = [col.label];
    if (consolidado) titleParts.push("Consolidado");
    else if (groups.length === 1) titleParts.push(groups[0].label);
    else titleParts.push(`${groups.length} ramas`);
    const title = titleParts.join(" · ");

    let labels = [];
    let datasets = [];
    let tableRows = [];

    if (col.kind === "count") {
      labels = groups.map((g) => g.label);
      const data = groups.map((g) => g.rows.length);
      datasets = [
        {
          label: "Personas",
          data,
          backgroundColor: labels.map((_, i) => COLORS[i % COLORS.length]),
        },
      ];
      tableRows = labels.map((l, i) => [l, data[i]]);
    } else if (col.kind === "category" || col.kind === "text") {
      if (groups.length === 1 && type === "doughnut") {
        const values = groups[0].rows.map((r) =>
          categoryLabel(r.member[col.id], col.id)
        );
        const counted = countBy(values).slice(0, col.kind === "text" ? 12 : 20);
        labels = counted.map(([k]) => k);
        const data = counted.map(([, n]) => n);
        datasets = [
          {
            label: groups[0].label,
            data,
            backgroundColor: labels.map((_, i) => COLORS[i % COLORS.length]),
          },
        ];
        tableRows = counted;
      } else {
        const allCats = new Set();
        const perGroup = groups.map((g) => {
          const values = g.rows.map((r) => categoryLabel(r.member[col.id], col.id));
          const counted = new Map(countBy(values));
          for (const k of counted.keys()) allCats.add(k);
          return { group: g, counted };
        });
        labels = [...allCats];
        if (col.kind === "text" && labels.length > 12) {
          labels = countBy(
            groups.flatMap((g) =>
              g.rows.map((r) => categoryLabel(r.member[col.id], col.id))
            )
          )
            .slice(0, 12)
            .map(([k]) => k);
        }
        // Eje X = ramas; cada barra = 100%; datasets = opciones (cortes %).
        const cats = labels;
        labels = perGroup.map((pg) => pg.group.label);
        const totals = perGroup.map((pg) =>
          Math.max(
            1,
            cats.reduce((s, lab) => s + (pg.counted.get(lab) || 0), 0)
          )
        );
        datasets = cats.map((cat, i) => {
          const counts = perGroup.map((pg) => pg.counted.get(cat) || 0);
          const pcts = counts.map((n, gi) =>
            Math.round((n / totals[gi]) * 1000) / 10
          );
          return {
            label: cat,
            data: pcts,
            counts,
            backgroundColor: COLORS[i % COLORS.length],
            stack: "pct",
          };
        });
        stacked = true;
        percentStacked = true;
        showValues = true;
        tableRows = perGroup.flatMap((pg, gi) =>
          cats.map((cat) => {
            const n = pg.counted.get(cat) || 0;
            const pct = Math.round((n / totals[gi]) * 1000) / 10;
            return [pg.group.label, cat, n, `${pct}%`];
          })
        );
      }
    } else if (col.kind === "numeric") {
      if (groups.length === 1 && (rec.histogram || type === "bar" || type === "doughnut")) {
        const ages = groups[0].rows
          .map((r) => memberAge(r.member))
          .filter((n) => n != null);
        const bins = histogram(ages, 5);
        labels = bins.map(([k]) => k);
        const data = bins.map(([, n]) => n);
        datasets = [
          {
            label: `Edad · ${groups[0].label}`,
            data,
            backgroundColor: COLORS[0],
          },
        ];
        tableRows = bins;
      } else {
        labels = groups.map((g) => g.label);
        const avgs = groups.map((g) => {
          const ages = g.rows
            .map((r) => memberAge(r.member))
            .filter((n) => n != null);
          if (!ages.length) return 0;
          return Math.round((ages.reduce((a, b) => a + b, 0) / ages.length) * 10) / 10;
        });
        const counts = groups.map((g) =>
          g.rows.map((r) => memberAge(r.member)).filter((n) => n != null).length
        );
        datasets = [
          {
            label: "Edad promedio",
            data: avgs,
            backgroundColor: COLORS[0],
          },
          {
            label: "Con edad cargada",
            data: counts,
            backgroundColor: COLORS[1],
          },
        ];
        tableRows = labels.map((l, i) => [l, avgs[i], counts[i]]);
      }
    } else if (col.kind === "ratio") {
      if (groups.length === 1 && (rec.buckets || type === "bar")) {
        const buckets = ["Sin dato", "0%", "1–49%", "50–99%", "100%"];
        const counts = Object.fromEntries(buckets.map((b) => [b, 0]));
        for (const r of groups[0].rows) {
          const ratio = parseAttendanceRatio(r.member.attendance);
          counts[attendanceBucket(ratio)] += 1;
        }
        labels = buckets;
        const data = buckets.map((b) => counts[b]);
        datasets = [
          {
            label: groups[0].label,
            data,
            backgroundColor: COLORS.slice(0, buckets.length),
          },
        ];
        tableRows = buckets.map((b) => [b, counts[b]]);
      } else {
        labels = groups.map((g) => g.label);
        const avgs = groups.map((g) => {
          const ratios = g.rows
            .map((r) => parseAttendanceRatio(r.member.attendance))
            .filter((n) => n != null);
          if (!ratios.length) return 0;
          return Math.round((ratios.reduce((a, b) => a + b, 0) / ratios.length) * 1000) / 10;
        });
        datasets = [
          {
            label: "Asistencia promedio %",
            data: avgs,
            backgroundColor: labels.map((_, i) => COLORS[i % COLORS.length]),
          },
        ];
        tableRows = labels.map((l, i) => [l, `${avgs[i]}%`]);
      }
    } else if (col.kind === "date") {
      const monthMaps = groups.map((g) => {
        const values = g.rows.map((r) =>
          monthKey(r.member.baptism, parseLooseDate)
        );
        return { group: g, counted: new Map(countBy(values)) };
      });
      const months = [...new Set(monthMaps.flatMap((mm) => [...mm.counted.keys()]))].sort();
      if (groups.length > 1 && (rec.percentStacked || type === "bar")) {
        labels = monthMaps.map((mm) => mm.group.label);
        const totals = monthMaps.map((mm) =>
          Math.max(
            1,
            months.reduce((s, m) => s + (mm.counted.get(m) || 0), 0)
          )
        );
        datasets = months.map((month, i) => {
          const counts = monthMaps.map((mm) => mm.counted.get(month) || 0);
          const pcts = counts.map((n, gi) =>
            Math.round((n / totals[gi]) * 1000) / 10
          );
          return {
            label: month,
            data: pcts,
            counts,
            backgroundColor: COLORS[i % COLORS.length],
            stack: "pct",
          };
        });
        stacked = true;
        percentStacked = true;
        showValues = true;
        tableRows = monthMaps.flatMap((mm, gi) =>
          months.map((month) => {
            const n = mm.counted.get(month) || 0;
            const pct = Math.round((n / totals[gi]) * 1000) / 10;
            return [mm.group.label, month, n, `${pct}%`];
          })
        );
      } else {
        labels = months;
        datasets = monthMaps.map((mm, i) => ({
          label: mm.group.label,
          data: labels.map((lab) => mm.counted.get(lab) || 0),
          backgroundColor: COLORS[i % COLORS.length],
        }));
        tableRows = labels.map((lab) => [
          lab,
          ...monthMaps.map((mm) => mm.counted.get(lab) || 0),
        ]);
      }
    }

    if (percentStacked) type = "bar";
    // Valores visibles también en histograma / conteo simple
    if (!showValues && type === "bar" && datasets.length) {
      showValues = true;
    }

    return {
      title,
      reason: rec.reason,
      recommendedType: rec.type,
      type,
      stacked,
      percentStacked,
      showValues,
      labels,
      datasets,
      tableRows,
      tableHeader: percentStacked
        ? ["Rama", "Opción", "Cantidad", "%"]
        : col.kind === "count"
          ? ["Serie", "Personas"]
          : col.kind === "numeric" && groups.length > 1
            ? ["Serie", "Edad promedio", "Con edad"]
            : col.kind === "ratio" && !(groups.length === 1 && (rec.buckets || type === "bar"))
              ? ["Serie", "Asistencia promedio %"]
              : groups.length === 1
                ? ["Valor", "Cantidad"]
                : ["Valor", ...groups.map((g) => g.label)],
      col,
      groups,
    };
  }

  const valueLabelsPlugin = {
    id: "correlacionValueLabels",
    afterDatasetsDraw(chart) {
      const spec = chart.$correlacionSpec;
      if (!spec?.showValues) return;
      const { ctx } = chart;
      chart.data.datasets.forEach((dataset, di) => {
        const meta = chart.getDatasetMeta(di);
        if (meta.hidden) return;
        meta.data.forEach((el, i) => {
          const raw = dataset.data[i];
          if (raw == null || Number(raw) === 0) return;
          const count = dataset.counts?.[i];
          let text;
          if (spec.percentStacked) {
            if (Number(raw) < 6) return;
            text = count != null ? `${raw}%\n(${count})` : `${raw}%`;
          } else {
            text = String(raw);
          }
          const { x, y } = el.tooltipPosition();
          const props = el.getProps(["base", "y", "height"], true);
          const segH = Math.abs((props.base ?? y) - y);
          if (spec.percentStacked && segH < 14) return;
          ctx.save();
          ctx.fillStyle = "#f4f8fa";
          ctx.font = "600 11px DM Sans, system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.shadowColor = "rgba(0,0,0,0.45)";
          ctx.shadowBlur = 2;
          const lines = text.split("\n");
          lines.forEach((line, li) => {
            ctx.fillText(line, x, y + (li - (lines.length - 1) / 2) * 12);
          });
          ctx.restore();
        });
      });
    },
  };

  function destroyChart() {
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }
  }

  function renderChart(canvas, spec) {
    if (typeof Chart === "undefined") {
      throw new Error("Chart.js no cargó. Revisá la conexión.");
    }
    destroyChart();
    lastSpec = spec;
    const stacked = !!spec.stacked;
    const percentStacked = !!spec.percentStacked;
    chartInstance = new Chart(canvas.getContext("2d"), {
      type: spec.type === "doughnut" ? "doughnut" : "bar",
      data: {
        labels: spec.labels,
        datasets: spec.datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom" },
          title: {
            display: true,
            text: spec.title,
            font: { size: 15, weight: "600" },
          },
          tooltip: {
            mode: "index",
            intersect: false,
            callbacks: {
              label(ctx) {
                const count = ctx.dataset.counts?.[ctx.dataIndex];
                const v = ctx.parsed.y ?? ctx.parsed;
                if (percentStacked) {
                  return count != null
                    ? `${ctx.dataset.label}: ${v}% (${count})`
                    : `${ctx.dataset.label}: ${v}%`;
                }
                return `${ctx.dataset.label}: ${v}`;
              },
            },
          },
        },
        scales:
          spec.type === "doughnut"
            ? {}
            : {
                x: { stacked, ticks: { maxRotation: 45, minRotation: 0 } },
                y: {
                  stacked,
                  beginAtZero: true,
                  max: percentStacked ? 100 : undefined,
                  ticks: {
                    precision: 0,
                    callback: percentStacked ? (v) => `${v}%` : undefined,
                  },
                },
              },
      },
      plugins: [valueLabelsPlugin],
    });
    chartInstance.$correlacionSpec = spec;
    return chartInstance;
  }

  function exportPng(filename) {
    if (!chartInstance) throw new Error("No hay gráfico para exportar.");
    const a = document.createElement("a");
    a.href = chartInstance.toBase64Image("image/png", 1);
    a.download = filename || "grafico-correlacion.png";
    a.click();
  }

  async function exportPdf(filename) {
    if (!chartInstance) throw new Error("No hay gráfico para exportar.");
    const JsPDF = window.jspdf && window.jspdf.jsPDF;
    if (!JsPDF) throw new Error("jsPDF no está disponible.");
    const img = chartInstance.toBase64Image("image/png", 1);
    const pdf = new JsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 36;
    pdf.setFontSize(14);
    pdf.text(lastSpec?.title || "Gráfico", margin, margin);
    if (lastSpec?.reason) {
      pdf.setFontSize(10);
      pdf.setTextColor(90);
      pdf.text(lastSpec.reason, margin, margin + 16, { maxWidth: pageW - margin * 2 });
      pdf.setTextColor(0);
    }
    const imgW = pageW - margin * 2;
    const imgH = pageH - margin * 2 - 40;
    pdf.addImage(img, "PNG", margin, margin + 28, imgW, imgH);
    pdf.save(filename || "grafico-correlacion.pdf");
  }

  function exportCsv(filename) {
    if (!lastSpec?.tableRows?.length) throw new Error("No hay datos para exportar.");
    const header = lastSpec.tableHeader || [];
    const lines = [header, ...lastSpec.tableRows].map((row) =>
      row
        .map((cell) => {
          const s = String(cell ?? "");
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(",")
    );
    const blob = new Blob(["\uFEFF" + lines.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename || "grafico-correlacion.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function fillColumnSelect(selectEl) {
    if (!selectEl) return;
    selectEl.innerHTML = COLUMNS.map(
      (c) => `<option value="${c.id}">${c.label}</option>`
    ).join("");
  }

  function fillUnitChecks(container, units, selected = null) {
    if (!container) return;
    const names = (units || []).map((u) => u.name);
    const picked = selected
      ? new Set(selected)
      : new Set(names);
    container.innerHTML = names
      .map((name, i) => {
        const id = `chartUnit_${i}`;
        const checked = picked.has(name) ? "checked" : "";
        return `<label class="chart-unit-check" for="${id}"><input type="checkbox" name="chartUnit" value="${escapeAttr(
          name
        )}" id="${id}" ${checked} /><span>${escapeHtml(shortUnit(name))}</span></label>`;
      })
      .join("");
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function escapeAttr(s) {
    return escapeHtml(s).replaceAll("'", "&#39;");
  }

  function selectedUnitNames(container) {
    return [...(container?.querySelectorAll('input[name="chartUnit"]:checked') || [])].map(
      (el) => el.value
    );
  }

  function safeFilename(parts) {
    return parts
      .filter(Boolean)
      .join("_")
      .replace(/[^\w\-áéíóúñÁÉÍÓÚÑ]+/gi, "_")
      .replace(/_+/g, "_")
      .slice(0, 80);
  }

  window.CorrelacionCharts = {
    COLUMNS,
    colMeta,
    recommend,
    buildDataset,
    renderChart,
    destroyChart,
    exportPng,
    exportPdf,
    exportCsv,
    fillColumnSelect,
    fillUnitChecks,
    selectedUnitNames,
    safeFilename,
    getLastSpec: () => lastSpec,
  };
})();
