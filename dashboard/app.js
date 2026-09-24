// UK university student numbers dashboard
// Reads data.json (built by notebooks/explore.ipynb) and draws the charts with Chart.js.

const ORDER = {
  level: ["First degree", "Other undergraduate", "Postgraduate (taught)", "Postgraduate (research)"],
  domicile: ["UK", "European Union", "Non-European Union", "Not known"],
  mode: ["Full-time", "Part-time"],
};

// Gold is kept only for the comparison university, so no bar colour can be mistaken for it
const GROUP_COLOURS = {
  "First degree": "#1F5F8B", "Other undergraduate": "#4A9B8E",
  "Postgraduate (taught)": "#8C5A8A", "Postgraduate (research)": "#9DB7CF",
  "UK": "#1F5F8B", "European Union": "#4A9B8E",
  "Non-European Union": "#8C5A8A", "Not known": "#A3ADB2",
  "Full-time": "#1F5F8B", "Part-time": "#4A9B8E",
};
const PRIMARY = "#1F5F8B";
const COMPARE = "#B8860B";
const SMALL_PROVIDER = 500;  // below this, rounding to the nearest 5 distorts percentages
const SIZE_BANDS = [0, 1000, 5000, 10000, 20000, 40000, Infinity];
const MIN_PEERS = 5;         // fewer similar providers than this is too few to say what's typical

const fmt = new Intl.NumberFormat("en-GB");
const charts = {};
const idByName = new Map();
let DATA, METRICS;
let currentId = null;
let compareId = null;

const searchInput = document.getElementById("provider");
const providerList = document.getElementById("provider-list");
const compareInput = document.getElementById("compare");
const clearCompare = document.getElementById("clear-compare");
const actionStatus = document.getElementById("action-status");

Chart.defaults.font.family = '"Public Sans", "Segoe UI", system-ui, sans-serif';
Chart.defaults.color = "#46555C";
Chart.defaults.plugins.legend.position = "bottom";
Chart.defaults.plugins.legend.labels.boxWidth = 12;
Chart.defaults.maintainAspectRatio = false;

// ---------- start-up ----------

async function init() {
  try {
    // "no-cache" makes the browser check for a newer data.json each time, so data updates show straight away
    const response = await fetch("data.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    DATA = await response.json();
  } catch (error) {
    document.getElementById("summary").textContent =
      "The data file couldn't be loaded. Open this page through a local server rather than directly from your files (see the README).";
    return;
  }

  for (const provider of DATA.providers) {
    idByName.set(provider.name.toLowerCase(), provider.id);
    const option = new Option(provider.name);
    // Flag providers that have stopped appearing in HESA's data, so nobody picks one by mistake
    const last = lastIndex(DATA.data[provider.id].total || []);
    if (last !== -1 && last < latest()) option.label = `No figures since ${DATA.years[last]}`;
    providerList.append(option);
  }
  METRICS = new Map(DATA.providers.map((p) => [p.id, metricsFor(DATA.data[p.id])]));
  showPeriod();
  showUpdateDates();

  // A shared link opens the same view: ?uni=<UKPRN>&compare=<UKPRN>
  const params = new URLSearchParams(window.location.search);
  const keele = DATA.providers.find((p) => p.name === "Keele University");
  currentId = DATA.data[params.get("uni")] ? params.get("uni") : (keele ? keele.id : DATA.providers[0].id);
  compareId = DATA.data[params.get("compare")] ? params.get("compare") : null;
  searchInput.value = nameOf(currentId);
  compareInput.value = compareId ? nameOf(compareId) : "";
  searchInput.addEventListener("input", fitName);
  searchInput.addEventListener("blur", fitName);
  window.addEventListener("resize", fitName);

  document.getElementById("copy-link").addEventListener("click", copyLink);
  document.getElementById("download").addEventListener("click", downloadCsv);

  setUpSearch(searchInput, (id) => { currentId = id; }, () => currentId, false);
  setUpSearch(compareInput, (id) => { compareId = id; }, () => compareId, true);
  clearCompare.addEventListener("click", () => {
    compareId = null;
    compareInput.value = "";
    render();
  });

  // Wait for the web font, otherwise Chart.js measures labels in the fallback font and clips them
  await document.fonts.ready;
  fitName();
  render();
}

// A text box can't wrap onto two lines, so shrink the headline until a long name fits
function fitName() {
  searchInput.style.fontSize = "";
  let size = parseFloat(getComputedStyle(searchInput).fontSize);
  while (searchInput.scrollWidth > searchInput.clientWidth && size > 14) {
    size -= 1;
    searchInput.style.fontSize = `${size}px`;
  }
}

// Wires up a search box: switch as soon as the text matches a provider, restore the name if abandoned
function setUpSearch(input, setId, getId, canBeEmpty) {
  input.addEventListener("focus", () => input.select());
  input.addEventListener("input", () => {
    const id = idByName.get(input.value.trim().toLowerCase());
    if (id && id !== getId()) {
      setId(id);
      render();
      input.blur();
      fitName();
    }
  });
  input.addEventListener("blur", () => {
    if (canBeEmpty && input.value.trim() === "") setId(null);
    input.value = getId() ? nameOf(getId()) : "";
    if (canBeEmpty) render();
  });
}

// ---------- helpers ----------

const nameOf = (id) => DATA.providers.find((p) => p.id === id).name;
const latest = () => DATA.years.length - 1;

function lastIndex(values) {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] != null) return i;
  return -1;
}
const firstIndex = (values) => values.findIndex((v) => v != null);

function percentChange(now, before) {
  if (now == null || before == null || before === 0) return null;
  return ((now - before) / before) * 100;
}
function describeChange(pct) {
  if (pct == null) return null;
  if (Math.abs(pct) < 0.5) return "about the same as";
  return `${pct > 0 ? "up" : "down"} ${Math.abs(pct).toFixed(1)}% on`;
}
function internationalShare(uni, i) {
  const dom = uni.domicile || {};
  const all = ORDER.domicile.reduce((sum, g) => sum + (dom[g]?.[i] ?? 0), 0);
  if (all === 0) return null;
  return (((dom["European Union"]?.[i] ?? 0) + (dom["Non-European Union"]?.[i] ?? 0)) / all) * 100;
}
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
const signed = (v) => (v == null ? "No data" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`);
const share = (v) => (v == null ? "No data" : `${v.toFixed(1)}%`);
const escapeHtml = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- summary sentence ----------

function describe(uni) {
  const total = uni.total || [];
  const years = DATA.years;
  const last = lastIndex(total);
  if (last === -1) return { text: "HESA has no enrolment figures for this provider.", notes: [] };

  let text = `<strong>${fmt.format(total[last])}</strong> students in ${years[last]}`;
  const yearChange = describeChange(percentChange(total[last], total[last - 1]));
  if (last > 0 && yearChange) text += `, ${yearChange} ${years[last - 1]}`;

  const first = firstIndex(total);
  const longChange = percentChange(total[last], total[first]);
  if (first < last - 1 && longChange != null) {
    text += ` and ${longChange >= 0 ? "up" : "down"} ${Math.abs(longChange).toFixed(0)}% since ${years[first]}`;
  }
  text += ".";

  const intl = internationalShare(uni, last);
  if (intl != null) text += ` ${Math.round(intl)}% came from outside the UK.`;

  const notes = [];
  if (last < latest()) notes.push(`HESA has no figures for this provider after ${years[last]}. It may have closed, merged with another provider or stopped reporting to HESA.`);
  if (first > 0) notes.push(`HESA's figures start in ${years[first]}.`);
  if (total[last] < SMALL_PROVIDER) notes.push("With this few students, HESA's rounding to the nearest 5 can make percentages jump from year to year.");
  return { text, notes };
}

function renderSummary(uni, name, other, otherName) {
  const summary = document.getElementById("summary");
  const caveat = document.getElementById("caveat");
  const main = describe(uni);

  if (!other) {
    summary.innerHTML = main.text;
    caveat.textContent = main.notes.join(" ");
    caveat.hidden = main.notes.length === 0;
    return;
  }

  // When comparing, give each university its own line, marked with the same line style as the charts
  const second = describe(other);
  summary.innerHTML =
    `<span class="summary-line"><span class="key key-main" aria-hidden="true"></span>` +
    `<span><span class="summary-name">${escapeHtml(name)}:</span> ${main.text}</span></span>` +
    `<span class="summary-line"><span class="key key-compare" aria-hidden="true"></span>` +
    `<span><span class="summary-name">${escapeHtml(otherName)}:</span> ${second.text}</span></span>`;

  const notes = [
    ...main.notes.map((n) => `${name}: ${n}`),
    ...second.notes.map((n) => `${otherName}: ${n}`),
  ];
  caveat.textContent = notes.join(" ");
  caveat.hidden = notes.length === 0;
}

// ---------- benchmark against similar-sized providers ----------

// The figures each provider is benchmarked on, all for the latest year
function metricsFor(uni) {
  const L = latest();
  const total = uni.total || [];
  const entrants = uni.entrants || [];
  return {
    size: total[L] ?? null,
    totalChange: percentChange(total[L], total[L - 1]),
    entrantChange: percentChange(entrants[L], entrants[L - 1]),
    longChange: percentChange(total[L], total[0]),
    international: internationalShare(uni, L),
  };
}

function sizeBand(size) {
  for (let i = 0; i < SIZE_BANDS.length - 1; i++) {
    if (size >= SIZE_BANDS[i] && size < SIZE_BANDS[i + 1]) return [SIZE_BANDS[i], SIZE_BANDS[i + 1]];
  }
  return null;
}

function position(value, peerValues) {
  if (value == null) return "No data for this provider";
  if (peerValues.length < MIN_PEERS) return "Too few similar providers to compare";
  // Within half a percentage point of the median, calling it higher or lower would be misleading
  if (Math.abs(value - median(peerValues)) < 0.5) return "About typical";
  const below = peerValues.filter((v) => v < value).length;
  const above = peerValues.filter((v) => v > value).length;
  if (above === 0) return "Higher than all of them";
  if (below === 0) return "Lower than all of them";
  return below >= above
    ? `Higher than ${Math.round((below / peerValues.length) * 100)}% of them`
    : `Lower than ${Math.round((above / peerValues.length) * 100)}% of them`;
}

// The measures used in both the peer comparison and the head-to-head table
function benchmarkRows() {
  const year = DATA.years[latest()];
  const lastYear = `${DATA.years[latest() - 1]} to ${year}`;
  return [
    { label: "Change in total students", detail: lastYear, key: "totalChange", format: signed },
    { label: "Change in new entrants", detail: lastYear, key: "entrantChange", format: signed },
    { label: "Change in total students", detail: `${DATA.years[0]} to ${year}, providers with figures for both years`, key: "longChange", format: signed },
    { label: "Students from outside the UK", detail: year, key: "international", format: share },
  ];
}

// Works out one provider's size group and, for each measure, the typical value and where it sits
function peerStats(id) {
  const own = METRICS.get(id);
  if (own.size == null) return null;
  const [low, high] = sizeBand(own.size);
  const peers = [...METRICS].filter(([pid, m]) => pid !== id && m.size != null && m.size >= low && m.size < high).map(([, m]) => m);
  const bandText = high === Infinity ? `${fmt.format(low)} or more students`
    : low === 0 ? `fewer than ${fmt.format(high)} students`
    : `between ${fmt.format(low)} and ${fmt.format(high)} students`;

  const measures = {};
  for (const { key, format } of benchmarkRows()) {
    const peerValues = peers.map((m) => m[key]).filter((v) => v != null);
    measures[key] = {
      typical: peerValues.length >= MIN_PEERS ? format(median(peerValues)) : "Not enough providers",
      count: peerValues.length,
      position: position(own[key], peerValues),
    };
  }
  return { own, peers: peers.length, bandText, measures };
}

// How one provider compares with others of a similar size (used when there's no comparison)
function peerComparison(id, name) {
  const stats = peerStats(id);
  const year = DATA.years[latest()];
  if (!stats) return `<p class="note">This comparison uses ${year} figures, and HESA has none for ${escapeHtml(name)}.</p>`;

  const body = benchmarkRows().map(({ label, detail, key, format }) => {
    const m = stats.measures[key];
    return `<tr>
      <th scope="row">${label}<br><span class="verdict">${detail}</span></th>
      <td class="num" data-label="${escapeHtml(name)}">${format(stats.own[key])}</td>
      <td class="num" data-label="Typical">${m.typical} <span class="verdict">(${m.count} providers)</span></td>
      <td data-label="Where it sits">${m.position}</td>
    </tr>`;
  }).join("");

  return `
    <p class="note">${escapeHtml(name)} had ${fmt.format(stats.own.size)} students in ${year}, so it's compared with the ${stats.peers} other providers that had ${stats.bandText}. “Typical” is the median of those providers.</p>
    <div class="table-wrap"><table>
      <caption class="visually-hidden">${escapeHtml(name)} compared with similar-sized providers</caption>
      <thead><tr>
        <th scope="col">Measure</th>
        <th scope="col" class="num">${escapeHtml(name)}</th>
        <th scope="col" class="num">Typical for similar-sized providers</th>
        <th scope="col">Where it sits</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;
}

// One table for two providers: each cell shows the figure, what's typical for its size, and where it sits,
// and the last column spells out the gap between them
function comparisonTable(id, name, otherId, otherName) {
  const year = DATA.years[latest()];
  const a = METRICS.get(id);
  const b = METRICS.get(otherId);
  const sa = peerStats(id);
  const sb = peerStats(otherId);

  const differenceText = (x, y, isCount) => {
    if (x == null || y == null) {
      const missing = x == null && y == null ? "either provider" : escapeHtml(x == null ? name : otherName);
      return `Can't compare: no figures for ${missing}`;
    }
    const gap = Math.abs(x - y);
    if (isCount) return x === y ? "Same size" : `${fmt.format(gap)} more at ${escapeHtml(x > y ? name : otherName)}`;
    if (gap < 0.5) return "About the same";
    return `${gap.toFixed(1)} percentage points higher at ${escapeHtml(x > y ? name : otherName)}`;
  };

  const sizeCell = (m, stats) => `<span class="val">${m.size == null ? "No data" : fmt.format(m.size)}</span>` +
    (stats ? `<span class="sub">Size group: ${stats.bandText} (${stats.peers} other providers)</span>` : "");

  const measureCell = (m, stats, key, format) => {
    let html = `<span class="val">${format(m[key])}</span>`;
    if (stats) {
      const s = stats.measures[key];
      html += `<span class="sub">Typical for its size: ${s.typical}</span><span class="sub">${s.position}</span>`;
    }
    return html;
  };

  const rows = [`<tr>
      <th scope="row">Students<br><span class="verdict">${year}</span></th>
      <td data-label="${escapeHtml(name)}">${sizeCell(a, sa)}</td>
      <td data-label="${escapeHtml(otherName)}">${sizeCell(b, sb)}</td>
      <td data-label="Difference">${differenceText(a.size, b.size, true)}</td>
    </tr>`,
    ...benchmarkRows().map(({ label, detail, key, format }) => `<tr>
      <th scope="row">${label}<br><span class="verdict">${detail}</span></th>
      <td data-label="${escapeHtml(name)}">${measureCell(a, sa, key, format)}</td>
      <td data-label="${escapeHtml(otherName)}">${measureCell(b, sb, key, format)}</td>
      <td data-label="Difference">${differenceText(a[key], b[key], false)}</td>
    </tr>`),
  ].join("");

  // Percentage changes at providers of very different sizes aren't like-for-like
  let warning = "";
  if (a.size && b.size) {
    const ratio = Math.max(a.size, b.size) / Math.min(a.size, b.size);
    if (ratio >= 5) {
      const bigger = a.size > b.size ? name : otherName;
      warning = `<p class="size-warning">${escapeHtml(bigger)} is about ${Math.round(ratio)} times the size, so treat percentage changes with care: a small change in student numbers moves a small provider's percentages much more.</p>`;
    }
  }

  return `
    <p class="note">Each provider is also compared with others of a similar size. “Typical for its size” is the median of those providers.</p>
    <div class="table-wrap"><table class="pair-table">
      <caption class="visually-hidden">${escapeHtml(name)} compared with ${escapeHtml(otherName)}</caption>
      <thead><tr>
        <th scope="col">Measure</th>
        <th scope="col"><span class="key key-main" aria-hidden="true"></span>${escapeHtml(name)}</th>
        <th scope="col"><span class="key key-compare" aria-hidden="true"></span>${escapeHtml(otherName)}</th>
        <th scope="col">Difference</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>${warning}`;
}

function renderBenchmark(id, name, otherId, otherName) {
  const title = document.getElementById("bench-title");
  const container = document.getElementById("bench-body");
  if (!otherId) {
    title.textContent = "How it compares with similar-sized providers";
    container.innerHTML = peerComparison(id, name);
  } else {
    title.textContent = "How they compare";
    container.innerHTML = comparisonTable(id, name, otherId, otherName);
  }
}

// ---------- dates, sharing and downloads ----------

// Fills in every piece of text that depends on which years the data covers,
// so nothing needs editing by hand when a new year is added
function showPeriod() {
  const first = DATA.years[0];
  const last = DATA.years[latest()];
  document.getElementById("site-title").textContent = `UK university student numbers, ${first} to ${last}`;
  document.getElementById("intro").textContent =
    `See how student numbers at any UK university or college have changed over ${DATA.years.length} years, ` +
    "and how that compares with similar-sized providers. All figures are official data from HESA.";

  const counts = DATA.provider_counts || {};
  if (counts[first] && counts[last]) {
    const range = `from ${fmt.format(counts[first])} in ${first} to ${fmt.format(counts[last])} in ${last}`;
    document.getElementById("coverage").textContent = counts[last] > counts[first]
      ? `HESA’s data has grown to cover more providers over time, ${range}.`
      : `The number of providers in HESA’s data has changed over time, ${range}.`;
  }
}

function showUpdateDates() {
  const parts = [];
  if (DATA.hesa_updated) parts.push(`Figures last updated by HESA in ${DATA.hesa_updated}.`);
  if (DATA.built) parts.push(`This dashboard was last updated on ${DATA.built}.`);
  document.getElementById("updated").textContent = parts.join(" ");
}

// Keeps the address bar in step with the selection, so the current URL can be shared
function updateUrl() {
  const params = new URLSearchParams();
  params.set("uni", currentId);
  if (compareId && compareId !== currentId) params.set("compare", compareId);
  window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
}

let statusTimer;
function showStatus(message) {
  actionStatus.textContent = message;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { actionStatus.textContent = ""; }, 4000);
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(window.location.href);
    showStatus("Link copied. Anyone who opens it will see this view.");
  } catch {
    showStatus("Couldn't copy automatically. Copy the address from your browser's address bar instead.");
  }
}

const MEASURE_NAMES = {
  total: "Total students", entrants: "New entrants",
  level: "Level of study", mode: "Mode of study", domicile: "Permanent address",
};

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function downloadCsv() {
  const ids = [currentId, ...(compareId && compareId !== currentId ? [compareId] : [])];
  const lines = [["Provider", "UKPRN", "Academic year", "Measure", "Group", "Students"]];

  for (const id of ids) {
    const uni = DATA.data[id];
    for (const [measure, label] of Object.entries(MEASURE_NAMES)) {
      const series = uni[measure];
      if (!series) continue;
      const groups = Array.isArray(series) ? { All: series } : series;
      for (const [group, values] of Object.entries(groups)) {
        DATA.years.forEach((year, i) => {
          if (values[i] != null) lines.push([nameOf(id), id, year, label, group, values[i]]);
        });
      }
    }
  }

  // The byte-order mark at the start makes Excel read the file as UTF-8
  const csv = "\uFEFF" + lines.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${ids.map((id) => slug(nameOf(id))).join("-vs-")}-student-numbers.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
  showStatus("Downloaded. Figures are from HESA and must be credited if you reuse them (CC BY 4.0).");
}

// ---------- charts ----------

function draw(canvasId, config) {
  if (charts[canvasId]) charts[canvasId].destroy();
  charts[canvasId] = new Chart(document.getElementById(canvasId), config);
}

function lineChart(canvasId, values, compareValues, name, compareName) {
  const datasets = [{
    label: name, data: values || [], borderColor: PRIMARY, backgroundColor: PRIMARY,
    borderWidth: 2.5, pointRadius: 3, tension: 0.2,
  }];
  if (compareValues) {
    datasets.push({
      label: compareName, data: compareValues, borderColor: COMPARE, backgroundColor: COMPARE,
      borderWidth: 2.5, pointRadius: 3, tension: 0.2, borderDash: [6, 4],
    });
  }
  draw(canvasId, {
    type: "line",
    data: { labels: DATA.years, datasets },
    options: {
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: Boolean(compareValues), labels: { usePointStyle: true, pointStyle: "line" } },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.raw == null ? "no data" : fmt.format(c.raw)}` } },
      },
      // Starting at zero stops small changes looking dramatic
      scales: {
        x: { ticks: { maxRotation: 0, autoSkip: true, autoSkipPadding: 16 } },
        y: { beginAtZero: true, ticks: { callback: (v) => fmt.format(v) } },
      },
    },
  });

  const headers = ["Year", name, ...(compareValues ? [compareName] : [])];
  const rows = DATA.years.map((year, i) => [
    year,
    values?.[i] == null ? "–" : fmt.format(values[i]),
    ...(compareValues ? [compareValues[i] == null ? "–" : fmt.format(compareValues[i])] : []),
  ]);
  fillTable(canvasId, [{ headers, rows }]);
}

function shares(groups, order) {
  groups = groups || {};
  const totals = DATA.years.map((_, i) => order.reduce((sum, g) => sum + (groups[g]?.[i] ?? 0), 0));
  const present = order.filter((g) => groups[g]);
  return present.map((g) => ({
    group: g,
    counts: groups[g],
    percents: groups[g].map((v, i) => (v == null || totals[i] === 0 ? null : (v / totals[i]) * 100)),
  }));
}

function shareChart(canvasId, groups, order, otherGroups, name, otherName) {
  const comparing = Boolean(otherGroups);
  const mainShares = shares(groups, order);
  const otherShares = comparing ? shares(otherGroups, order) : [];

  const toDatasets = (list, stack, who, faded) => list.map((s) => ({
    label: s.group, who, stack, counts: s.counts, data: s.percents,
    backgroundColor: GROUP_COLOURS[s.group] + (faded ? "80" : ""),  // "80" = 50% opacity
    borderWidth: 0,
  }));
  const datasets = [...toDatasets(mainShares, "main", name, false), ...toDatasets(otherShares, "other", otherName, true)];

  // Explain which bar is which when two universities are shown
  const note = document.getElementById(canvasId).closest(".panel").querySelector(".pair-note");
  note.hidden = !comparing;
  if (comparing) {
    note.innerHTML =
      `<span class="swatch" style="background:${PRIMARY}"></span>Left bar: ${escapeHtml(name)}. ` +
      `<span class="swatch" style="background:${PRIMARY}80"></span>Right bar: ${escapeHtml(otherName)}.`;
  }

  draw(canvasId, {
    type: "bar",
    data: { labels: DATA.years, datasets },
    options: {
      interaction: { mode: "index", intersect: false },
      plugins: {
        // Show each category once in the legend, not once per university
        legend: { labels: { filter: (item, data) => data.datasets[item.datasetIndex].stack === "main" } },
        tooltip: {
          callbacks: {
            label: (c) => {
              const prefix = comparing ? `${c.dataset.who}, ` : "";
              return c.raw == null ? `${prefix}${c.dataset.label}: no data`
                : `${prefix}${c.dataset.label}: ${c.raw.toFixed(1)}% (${fmt.format(c.dataset.counts[c.dataIndex])})`;
            },
          },
        },
      },
      scales: {
        x: { stacked: true, ticks: { maxRotation: 0, autoSkip: true, autoSkipPadding: 16 } },
        y: { stacked: true, max: 100, ticks: { callback: (v) => `${v}%` } },
      },
    },
  });

  const toTable = (list, caption) => ({
    caption,
    headers: ["Year", ...list.map((s) => s.group)],
    rows: DATA.years.map((year, i) => [
      year,
      ...list.map((s) => (s.counts[i] == null ? "–" : `${fmt.format(s.counts[i])} (${s.percents[i].toFixed(1)}%)`)),
    ]),
  });
  fillTable(canvasId, comparing
    ? [toTable(mainShares, name), toTable(otherShares, otherName)]
    : [toTable(mainShares)]);
}

// Writes the "Show the data as a table" contents for the panel holding this chart
function fillTable(canvasId, tables) {
  const wrap = document.getElementById(canvasId).closest(".panel").querySelector(".data-table .table-wrap");
  wrap.innerHTML = tables.map(({ caption, headers, rows }) => `
    <table>
      ${caption ? `<caption>${escapeHtml(caption)}</caption>` : ""}
      <thead><tr>${headers.map((h, i) => `<th scope="col"${i ? ' class="num"' : ""}>${escapeHtml(h)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((cell, i) => i
        ? `<td class="num">${cell}</td>` : `<th scope="row">${cell}</th>`).join("")}</tr>`).join("")}</tbody>
    </table>`).join("");
}

// ---------- draw everything for the current selection ----------

function render() {
  const id = currentId;
  const otherId = compareId && compareId !== id ? compareId : null;
  const uni = DATA.data[id];
  const other = otherId ? DATA.data[otherId] : null;
  const name = nameOf(id);
  const otherName = otherId ? nameOf(otherId) : null;
  clearCompare.hidden = !compareId;

  document.title = `${name}: student numbers, ${DATA.years[0]} to ${DATA.years[latest()]}`;
  updateUrl();
  renderSummary(uni, name, other, otherName);
  renderBenchmark(id, name, otherId, otherName);
  lineChart("totalChart", uni.total, other?.total, name, otherName);
  lineChart("entrantChart", uni.entrants, other?.entrants, name, otherName);
  document.querySelector(".grid").classList.toggle("comparing", Boolean(other));
  shareChart("levelChart", uni.level, ORDER.level, other?.level, name, otherName);
  shareChart("domicileChart", uni.domicile, ORDER.domicile, other?.domicile, name, otherName);
  shareChart("modeChart", uni.mode, ORDER.mode, other?.mode, name, otherName);
}

init();
