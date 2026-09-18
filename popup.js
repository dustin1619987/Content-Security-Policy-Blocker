const els = {
  body: document.body,
  html: document.documentElement,

  statusPill: document.getElementById("status-pill"),
  statusLabel: document.getElementById("status-label"),
  themeBtn: document.getElementById("theme-btn"),

  tabs: Array.from(document.querySelectorAll(".tab")),
  panels: {
    config: document.getElementById("panel-config"),
    custom: document.getElementById("panel-custom"),
    policy: document.getElementById("panel-policy"),
    logs: document.getElementById("panel-logs"),
    about: document.getElementById("panel-about")
  },

  // Configuration tab
  stripBtn: document.getElementById("strip-btn"),
  stripLabel: document.getElementById("strip-label"),
  stateSub: document.getElementById("state-sub"),

  cspPre: document.getElementById("csp-pre"),
  cspUrl: document.getElementById("csp-url"),
  copyBtn: document.getElementById("copy-btn"),
  copyCurlBtn: document.getElementById("copy-curl-btn"),

  metaPre: document.getElementById("meta-pre"),
  copyMetaBtn: document.getElementById("copy-meta-btn"),

  // Custom CSP tab
  injectBtn: document.getElementById("inject-btn"),
  injectLabel: document.getElementById("inject-label"),
  injectTextarea: document.getElementById("inject-textarea"),
  modeRadios: Array.from(
    document.querySelectorAll('input[name="inject-mode"]')
  ),
  applyBtn: document.getElementById("apply-btn"),
  resetBtn: document.getElementById("reset-btn"),

  // Browser Policy tab
  policyBrowserName: document.getElementById("policy-browser-name"),
  policyBrowserVersion: document.getElementById("policy-browser-version"),
  policyOs: document.getElementById("policy-os"),
  policyArch: document.getElementById("policy-arch"),
  policyUa: document.getElementById("policy-ua"),
  policyInstallType: document.getElementById("policy-install-type"),
  policyManagementNote: document.getElementById("policy-management-note"),
  policyManagedPre: document.getElementById("policy-managed-pre"),
  policyRefreshBtn: document.getElementById("policy-refresh-btn"),
  policyCopyBtn: document.getElementById("policy-copy-btn"),
  policyOpenBtn: document.getElementById("policy-open-btn"),

  // Logs tab
  logsSummarySub: document.getElementById("logs-summary-sub"),
  logCategoryGrid: document.getElementById("log-category-grid"),
  logViolationsList: document.getElementById("log-violations-list"),
  logConsoleList: document.getElementById("log-console-list"),
  logsRefreshBtn: document.getElementById("logs-refresh-btn"),
  logsClearBtn: document.getElementById("logs-clear-btn"),
  exportDebugBtn: document.getElementById("export-debug-btn"),
  exportOriginalCspBtn: document.getElementById("export-original-csp-btn"),
  exportSuggestedCspBtn: document.getElementById("export-suggested-csp-btn"),
  exportJsonBtn: document.getElementById("export-json-btn"),
  exportHarBtn: document.getElementById("export-har-btn"),
  exportCspLogsBtn: document.getElementById("export-csp-logs-btn"),
  exportConsoleLogsBtn: document.getElementById("export-console-logs-btn"),

  // About
  aboutVersion: document.getElementById("about-version")
};

const state = {
  tabId: null,
  url: null,
  on: false,
  strip: false,
  inject: { enabled: false, value: "", mode: "header" },
  capturedCspText: "",
  capturedMetaText: "",
  capturedUrl: "",
  capturedPolicyText: "",
  detectedBrowserName: null,
  detectedBrowserVersion: null,
  rawCsp: "",
  rawMeta: "",
  logs: { violations: [], console: [] }
};

// ---------------------------------------------------------------------------
// Visual state

function applyOnOff(on) {
  state.on = on;
  els.body.dataset.state = on ? "on" : "off";
  els.statusLabel.textContent = on ? "ON" : "OFF";
}

function applyStrip(strip) {
  state.strip = strip;
  els.stripBtn.classList.toggle("is-on", strip);
  els.stripLabel.textContent = strip ? "Turn OFF" : "Turn ON";
  els.stateSub.textContent = strip
    ? "CSP headers are being stripped from this tab's responses."
    : "CSP headers are working normally.";
}

function applyInject(inject) {
  state.inject = { ...state.inject, ...inject };
  els.injectBtn.classList.toggle("is-on", state.inject.enabled);
  els.injectLabel.textContent = state.inject.enabled ? "Turn OFF" : "Turn ON";
  if (typeof inject.value === "string") {
    if (els.injectTextarea.value !== inject.value) {
      els.injectTextarea.value = inject.value;
    }
  }
  if (typeof inject.mode === "string") {
    for (const r of els.modeRadios) {
      r.checked = r.value === inject.mode;
    }
  }
}

// ---------------------------------------------------------------------------
// Captured CSP rendering

function renderHeaders(record) {
  if (!record || !Array.isArray(record.headers) || record.headers.length === 0) {
    els.cspPre.textContent =
      "No CSP captured for this tab yet.\n\n" +
      "Reload the page (or visit a CSP-protected site) to capture\n" +
      "the headers the server sent.";
    els.cspPre.classList.add("is-empty");
    els.cspUrl.textContent = "—";
    els.cspUrl.title = "";
    els.copyBtn.disabled = true;
    els.copyCurlBtn.disabled = true;
    state.capturedCspText = "";
    state.capturedUrl = "";
    state.rawCsp = "";
    return;
  }

  els.cspPre.classList.remove("is-empty");
  els.cspUrl.textContent = record.url || "—";
  els.cspUrl.title = record.url || "";
  state.capturedUrl = record.url || "";

  state.capturedCspText = record.headers
    .map(({ name, value }) => `${name}: ${value}`)
    .join("\n");

  const enforced = record.headers.find(
    (h) => (h.name || "").toLowerCase() === "content-security-policy"
  );
  state.rawCsp = (enforced || record.headers[0]).value || "";

  els.cspPre.textContent = "";
  for (const { name, value } of record.headers) {
    const span = document.createElement("span");
    span.className = "csp-directive";
    span.textContent = `${name}: `;
    els.cspPre.appendChild(span);
    els.cspPre.appendChild(document.createTextNode(value));
    els.cspPre.appendChild(document.createTextNode("\n"));
  }
  els.copyBtn.disabled = false;
  els.copyCurlBtn.disabled = !state.capturedUrl;
}

function renderMeta(record) {
  if (!record || !Array.isArray(record.metas) || record.metas.length === 0) {
    els.metaPre.textContent =
      'No <meta http-equiv="Content-Security-Policy"> tags found in this page.';
    els.metaPre.classList.add("is-empty");
    els.copyMetaBtn.disabled = true;
    state.capturedMetaText = "";
    state.rawMeta = "";
    return;
  }
  els.metaPre.classList.remove("is-empty");

  state.capturedMetaText = record.metas
    .map((m) => `${m.name}: ${m.value}${m.injected ? "  (injected)" : ""}`)
    .join("\n");

  const nonInjected = record.metas.find((m) => !m.injected);
  state.rawMeta = (nonInjected || record.metas[0]).value || "";

  els.metaPre.textContent = "";
  for (const m of record.metas) {
    const span = document.createElement("span");
    span.className = "csp-directive";
    span.textContent = `${m.name}: `;
    els.metaPre.appendChild(span);
    els.metaPre.appendChild(document.createTextNode(m.value));
    if (m.injected) {
      const tag = document.createElement("span");
      tag.style.color = "var(--accent)";
      tag.style.fontWeight = "700";
      tag.textContent = "  (injected)";
      els.metaPre.appendChild(tag);
    }
    els.metaPre.appendChild(document.createTextNode("\n"));
  }
  els.copyMetaBtn.disabled = false;
}

// ---------------------------------------------------------------------------
// Tabs / theme

function selectTab(name) {
  for (const t of els.tabs) {
    const isActive = t.dataset.tab === name;
    t.classList.toggle("is-active", isActive);
    t.setAttribute("aria-selected", isActive ? "true" : "false");
  }
  for (const [k, panel] of Object.entries(els.panels)) {
    const isActive = k === name;
    panel.classList.toggle("is-active", isActive);
    panel.toggleAttribute("hidden", !isActive);
  }
}

function applyTheme(theme) {
  const t = theme === "dark" ? "dark" : "light";
  els.html.dataset.theme = t;
}

async function toggleTheme() {
  const next =
    (els.html.dataset.theme || "light") === "light" ? "dark" : "light";
  applyTheme(next);
  try {
    await chrome.runtime.sendMessage({ type: "setTheme", theme: next });
  } catch (e) {}
}

// ---------------------------------------------------------------------------
// Background messaging

async function send(msg) {
  try {
    return await chrome.runtime.sendMessage(msg);
  } catch (e) {
    return null;
  }
}

async function refresh() {
  if (state.tabId == null) return;
  const reply = await send({ type: "getState", tabId: state.tabId });
  if (!reply || reply.error) return;
  applyTheme(reply.theme);
  applyOnOff(Boolean(reply.on));
  applyStrip(Boolean(reply.strip));
  applyInject(reply.inject || {});
  renderHeaders(reply.csp);
  renderMeta(reply.meta);
}

// ---------------------------------------------------------------------------
// Action handlers

async function onStripClick() {
  if (state.tabId == null) return;
  const next = !state.strip;
  // Optimistic UI
  applyStrip(next);
  applyOnOff(next || state.inject.enabled);
  els.stripBtn.disabled = true;
  await send({ type: "setStrip", tabId: state.tabId, strip: next });
  await send({ type: "reload", tabId: state.tabId });
  els.stripBtn.disabled = false;
}

function readMode() {
  const r = els.modeRadios.find((x) => x.checked);
  return r ? r.value : "header";
}

async function onInjectClick() {
  if (state.tabId == null) return;
  const next = !state.inject.enabled;
  const value = els.injectTextarea.value.trim();
  if (next && !value) {
    els.injectTextarea.focus();
    return;
  }
  applyInject({ enabled: next, value, mode: readMode() });
  applyOnOff(state.strip || next);
  els.injectBtn.disabled = true;
  await send({
    type: "setInject",
    tabId: state.tabId,
    inject: { enabled: next, value, mode: readMode() }
  });
  await send({ type: "reload", tabId: state.tabId });
  els.injectBtn.disabled = false;
}

async function onApplyClick() {
  if (state.tabId == null) return;
  const value = els.injectTextarea.value.trim();
  if (!value) {
    els.injectTextarea.focus();
    return;
  }
  applyInject({ enabled: true, value, mode: readMode() });
  applyOnOff(true);
  els.applyBtn.disabled = true;
  await send({
    type: "setInject",
    tabId: state.tabId,
    inject: { enabled: true, value, mode: readMode() }
  });
  await send({ type: "reload", tabId: state.tabId });
  els.applyBtn.disabled = false;
}

async function onResetClick() {
  if (state.tabId == null) return;
  els.injectTextarea.value = "";
  applyInject({ enabled: false, value: "", mode: "header" });
  applyOnOff(state.strip);
  await send({
    type: "setInject",
    tabId: state.tabId,
    inject: { enabled: false, value: "", mode: "header" }
  });
  await send({ type: "reload", tabId: state.tabId });
}

// ---------------------------------------------------------------------------
// Copy buttons

function flashCopy(btn, label = "Copied") {
  const original = btn.textContent;
  btn.classList.add("copied");
  btn.textContent = label;
  setTimeout(() => {
    btn.classList.remove("copied");
    btn.textContent = original;
  }, 1100);
}

async function copyText(text, btn) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    flashCopy(btn);
  } catch (e) {
    flashCopy(btn, "Failed");
  }
}

function buildCurlCommand() {
  if (!state.capturedUrl) return "";
  const url = state.capturedUrl;
  // Use single-quote-safe form: replace any ' with '"'"'.
  const safe = url.replace(/'/g, "'\"'\"'");
  const lines = [
    `curl -is '${safe}'`,
    "  # The response should include:"
  ];
  for (const line of state.capturedCspText.split("\n")) {
    if (line) lines.push(`  #   ${line}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Browser Policy tab
//
// Extensions cannot read chrome://policy/ itself — chrome:// pages are off
// limits to content scripts and the scripting API. Everything here is
// gathered from APIs an extension is actually allowed to call.

function guessBrowserFromUa(ua) {
  if (/Edg\//.test(ua)) return { name: "Microsoft Edge", match: /Edg\/([\d.]+)/ };
  if (/OPR\//.test(ua)) return { name: "Opera", match: /OPR\/([\d.]+)/ };
  if (/Vivaldi\//.test(ua)) return { name: "Vivaldi", match: /Vivaldi\/([\d.]+)/ };
  if (/Brave\//.test(ua)) return { name: "Brave", match: /Brave\/([\d.]+)/ };
  if (/Chrome\//.test(ua)) return { name: "Google Chrome", match: /Chrome\/([\d.]+)/ };
  return { name: "Chromium-based browser", match: null };
}

async function detectBrowser() {
  const ua = navigator.userAgent;
  let brands = [];
  let uaData = null;
  try {
    if (navigator.userAgentData) {
      uaData = await navigator.userAgentData.getHighEntropyValues([
        "platform",
        "platformVersion",
        "architecture",
        "bitness",
        "fullVersionList"
      ]);
      const list = uaData.fullVersionList || navigator.userAgentData.brands || [];
      brands = list
        .map((b) => ({ brand: b.brand, version: b.version }))
        .filter((b) => !/Not.*Brand/i.test(b.brand));
    }
  } catch (e) {}

  const preferredOrder = [
    "Microsoft Edge",
    "Opera",
    "Vivaldi",
    "Brave",
    "Google Chrome",
    "Chromium"
  ];
  let name = null;
  let version = null;
  for (const pref of preferredOrder) {
    const hit = brands.find((b) => b.brand === pref);
    if (hit) {
      name = hit.brand;
      version = hit.version;
      break;
    }
  }
  if (!name) {
    const fallback = guessBrowserFromUa(ua);
    name = fallback.name;
    if (fallback.match) {
      const m = ua.match(fallback.match);
      version = m ? m[1] : null;
    }
  }

  let os = null;
  let arch = uaData && uaData.architecture ? uaData.architecture : null;
  try {
    const platformInfo = await chrome.runtime.getPlatformInfo();
    os = platformInfo.os;
    if (!arch) arch = platformInfo.arch;
  } catch (e) {}

  return { name, version, os, arch, ua };
}

function renderPolicyBrowser(info) {
  state.detectedBrowserName = info.name || null;
  state.detectedBrowserVersion = info.version || null;
  els.policyBrowserName.textContent = info.name || "Unknown";
  els.policyBrowserVersion.textContent = info.version || "Unknown";
  els.policyOs.textContent = info.os || "Unknown";
  els.policyArch.textContent = info.arch || "Unknown";
  els.policyUa.textContent = info.ua;
}

async function loadInstallType() {
  try {
    const self = await chrome.management.getSelf();
    return self.installType || null;
  } catch (e) {
    return null;
  }
}

function renderPolicyManagement(installType) {
  const labels = {
    admin: "Installed by enterprise policy",
    development: "Loaded unpacked (development)",
    normal: "Installed from the Web Store",
    sideload: "Sideloaded",
    other: "Other"
  };
  els.policyInstallType.textContent = labels[installType] || "Unknown";
  els.policyManagementNote.textContent =
    installType === "admin"
      ? "This extension was force-installed and is centrally managed by an enterprise policy on this browser."
      : "This extension is not centrally managed — it was not installed by an enterprise policy.";
}

async function loadManagedPolicy() {
  try {
    const data = await chrome.storage.managed.get(null);
    return data || {};
  } catch (e) {
    return {};
  }
}

function renderManagedPolicy(data) {
  const keys = Object.keys(data || {});
  if (keys.length === 0) {
    els.policyManagedPre.textContent =
      "No enterprise policy values are configured for this extension.\n\n" +
      "An administrator can push key/value policy here via the standard " +
      "Chrome \"3rd-party extension\" ExtensionSettings policy, using this " +
      "extension's ID and the schema in managed_schema.json.";
    els.policyManagedPre.classList.add("is-empty");
    els.policyCopyBtn.disabled = true;
    state.capturedPolicyText = "";
    return;
  }
  els.policyManagedPre.classList.remove("is-empty");
  const text = JSON.stringify(data, null, 2);
  els.policyManagedPre.textContent = text;
  state.capturedPolicyText = text;
  els.policyCopyBtn.disabled = false;
}

async function refreshBrowserPolicy() {
  els.policyRefreshBtn.disabled = true;
  const [browserInfo, installType, managed] = await Promise.all([
    detectBrowser(),
    loadInstallType(),
    loadManagedPolicy()
  ]);
  renderPolicyBrowser(browserInfo);
  renderPolicyManagement(installType);
  renderManagedPolicy(managed);
  els.policyRefreshBtn.disabled = false;
}

const POLICY_URL_BY_BROWSER = {
  "Microsoft Edge": "edge://policy/",
  Opera: "opera://policy/",
  Vivaldi: "vivaldi://policy/",
  Brave: "brave://policy/",
  "Google Chrome": "chrome://policy/",
  Chromium: "chrome://policy/"
};

function openPolicyPage() {
  const url = POLICY_URL_BY_BROWSER[state.detectedBrowserName] || "chrome://policy/";
  chrome.tabs.create({ url });
}

// ---------------------------------------------------------------------------
// Logs tab
//
// Violations arrive from content.js (which listens for the browser's own
// `securitypolicyviolation` DOM event) and console activity from a
// MAIN-world console hook, both relayed through the background worker.
// Everything rendered here comes from the page, so it's built with
// textContent/DOM nodes rather than innerHTML.

const LOG_CATEGORIES = [
  ["script", "Blocked Scripts"],
  ["image", "Blocked Images"],
  ["frame", "Blocked Frames"],
  ["connection", "Blocked Connections"],
  ["inlineScript", "Inline Script Violations"],
  ["eval", "eval Violations"],
  ["style", "Blocked Styles"],
  ["inlineStyle", "Inline Style Violations"],
  ["font", "Blocked Fonts"],
  ["media", "Blocked Media"],
  ["object", "Blocked Objects"],
  ["manifest", "Blocked Manifests"],
  ["worker", "Blocked Workers"],
  ["other", "Other Violations"]
];
const LOG_CATEGORY_LABELS = Object.fromEntries(LOG_CATEGORIES);

function categorizeViolation(v) {
  const dir = (v.effectiveDirective || v.violatedDirective || "").toLowerCase();
  const blocked = (v.blockedURI || "").toLowerCase();

  if (dir.startsWith("script-src")) {
    if (blocked === "eval" || blocked === "wasm-eval") return "eval";
    if (blocked === "inline") return "inlineScript";
    return "script";
  }
  if (dir.startsWith("style-src")) {
    return blocked === "inline" ? "inlineStyle" : "style";
  }
  if (dir === "img-src") return "image";
  if (dir === "frame-src" || dir === "child-src") return "frame";
  if (dir === "connect-src") return "connection";
  if (dir === "font-src") return "font";
  if (dir === "media-src") return "media";
  if (dir === "object-src") return "object";
  if (dir === "manifest-src") return "manifest";
  if (dir === "worker-src") return "worker";
  return "other";
}

function countByCategory(violations) {
  const counts = Object.fromEntries(LOG_CATEGORIES.map(([k]) => [k, 0]));
  for (const v of violations) {
    const cat = categorizeViolation(v);
    counts[cat] = (counts[cat] || 0) + 1;
  }
  return counts;
}

function truncate(s, n) {
  if (!s) return s;
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function renderLogCategories(counts) {
  els.logCategoryGrid.textContent = "";
  for (const [key, label] of LOG_CATEGORIES) {
    const count = counts[key] || 0;
    const chip = document.createElement("div");
    chip.className = "log-chip" + (count > 0 ? " has-hits" : "");
    const labelSpan = document.createElement("span");
    labelSpan.className = "log-chip-label";
    labelSpan.textContent = label;
    const countSpan = document.createElement("span");
    countSpan.className = "log-chip-count";
    countSpan.textContent = String(count);
    chip.appendChild(labelSpan);
    chip.appendChild(countSpan);
    els.logCategoryGrid.appendChild(chip);
  }
}

function renderViolationsList(violations) {
  const el = els.logViolationsList;
  el.textContent = "";
  if (!violations.length) {
    el.classList.add("is-empty");
    el.textContent =
      "No CSP violations captured yet. Reload the page to start capturing.";
    return;
  }
  el.classList.remove("is-empty");
  for (const v of violations.slice().reverse()) {
    const entry = document.createElement("div");
    entry.className = "log-entry";

    const head = document.createElement("div");
    head.className = "log-entry-head";
    const badge = document.createElement("span");
    badge.className = "log-badge";
    badge.textContent = LOG_CATEGORY_LABELS[categorizeViolation(v)];
    head.appendChild(badge);
    const dir = document.createElement("span");
    dir.className = "log-entry-sub";
    dir.textContent =
      (v.effectiveDirective || v.violatedDirective || "") +
      (v.disposition === "report" ? "  (report-only — not actually blocked)" : "");
    head.appendChild(dir);
    entry.appendChild(head);

    const main = document.createElement("div");
    main.className = "log-entry-main";
    main.textContent = truncate(v.blockedURI || "(blocked)", 90);
    entry.appendChild(main);

    const sub = document.createElement("div");
    sub.className = "log-entry-sub";
    const loc = v.sourceFile
      ? `${truncate(v.sourceFile, 60)}:${v.lineNumber || 0}`
      : "";
    const time = new Date(v.time || Date.now()).toLocaleTimeString();
    sub.textContent = [loc, time].filter(Boolean).join("  —  ");
    entry.appendChild(sub);

    el.appendChild(entry);
  }
}

function renderConsoleList(entries) {
  const el = els.logConsoleList;
  el.textContent = "";
  if (!entries.length) {
    el.classList.add("is-empty");
    el.textContent = "No console activity captured yet.";
    return;
  }
  el.classList.remove("is-empty");
  for (const c of entries.slice().reverse()) {
    const entry = document.createElement("div");
    entry.className = "log-entry";

    const head = document.createElement("div");
    head.className = "log-entry-head";
    const badge = document.createElement("span");
    badge.className = `log-badge level-${c.level || "log"}`;
    badge.textContent = c.level || "log";
    head.appendChild(badge);
    if (c.kind) {
      const kindSpan = document.createElement("span");
      kindSpan.className = "log-entry-sub";
      kindSpan.textContent = c.kind;
      head.appendChild(kindSpan);
    }
    entry.appendChild(head);

    const main = document.createElement("div");
    main.className = "log-entry-main";
    main.textContent = truncate(c.message || "", 160);
    entry.appendChild(main);

    const sub = document.createElement("div");
    sub.className = "log-entry-sub";
    const loc = c.sourceFile
      ? `${truncate(c.sourceFile, 60)}:${c.lineNumber || 0}`
      : "";
    const time = new Date(c.time || Date.now()).toLocaleTimeString();
    sub.textContent = [loc, time].filter(Boolean).join("  —  ");
    entry.appendChild(sub);

    el.appendChild(entry);
  }
}

function renderLogs(logs) {
  state.logs = logs;
  renderLogCategories(countByCategory(logs.violations));
  renderViolationsList(logs.violations);
  renderConsoleList(logs.console);

  const vCount = logs.violations.length;
  const cCount = logs.console.length;
  if (!vCount && !cCount) {
    els.logsSummarySub.textContent = "No violations captured yet for this tab.";
  } else {
    els.logsSummarySub.textContent =
      `${vCount} CSP violation${vCount === 1 ? "" : "s"} and ` +
      `${cCount} console entr${cCount === 1 ? "y" : "ies"} captured for this tab.`;
  }
}

async function loadLogs() {
  if (state.tabId == null) return;
  const reply = await send({ type: "getLogs", tabId: state.tabId });
  renderLogs(
    reply && Array.isArray(reply.violations)
      ? reply
      : { violations: [], console: [] }
  );
}

async function onClearLogsClick() {
  if (state.tabId == null) return;
  els.logsClearBtn.disabled = true;
  await send({ type: "clearLogs", tabId: state.tabId });
  await loadLogs();
  els.logsClearBtn.disabled = false;
}

// ---------------------------------------------------------------------------
// Suggested CSP generator
//
// Parses the original policy (if any), then widens each directive just
// enough to cover what was actually observed being blocked. This is a
// starting point for a human to review, not a policy to deploy blindly —
// the output says so.

function parseCspText(policyText) {
  const map = new Map();
  if (!policyText) return map;
  for (const part of policyText.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const tokens = trimmed.split(/\s+/);
    const directive = tokens.shift().toLowerCase();
    if (!directive) continue;
    if (!map.has(directive)) map.set(directive, new Set());
    for (const t of tokens) map.get(directive).add(t);
  }
  return map;
}

function originFromUrl(u) {
  try {
    const parsed = new URL(u, state.url || undefined);
    if (["data:", "blob:", "filesystem:"].includes(parsed.protocol)) {
      return parsed.protocol;
    }
    return `${parsed.protocol}//${parsed.host}`;
  } catch (e) {
    return null;
  }
}

const CSP_DIRECTIVE_ORDER = [
  "default-src",
  "script-src",
  "script-src-elem",
  "script-src-attr",
  "style-src",
  "style-src-elem",
  "style-src-attr",
  "img-src",
  "font-src",
  "connect-src",
  "frame-src",
  "child-src",
  "frame-ancestors",
  "object-src",
  "base-uri",
  "form-action",
  "manifest-src",
  "media-src",
  "worker-src"
];

function buildSuggestedCsp(rawPolicy, violations) {
  const map = parseCspText(rawPolicy);
  const notes = new Set();

  for (const v of violations) {
    const directive = (v.effectiveDirective || v.violatedDirective || "").toLowerCase();
    if (!directive) continue;
    if (!map.has(directive)) map.set(directive, new Set());
    const set = map.get(directive);
    const blocked = (v.blockedURI || "").toLowerCase();

    if (blocked === "inline") {
      set.add("'unsafe-inline'");
      notes.add(
        `${directive}: consider a nonce or hash instead of 'unsafe-inline' for inline content.`
      );
    } else if (blocked === "eval" || blocked === "wasm-eval") {
      set.add("'unsafe-eval'");
      notes.add(
        `${directive}: 'unsafe-eval' is a broad grant — refactor away from eval()/Function() if possible.`
      );
    } else if (blocked === "self") {
      set.add("'self'");
    } else if (v.blockedURI) {
      const origin = originFromUrl(v.blockedURI);
      if (origin) set.add(origin);
    }
  }

  if (map.size === 0) {
    return (
      "# No original CSP was captured and no violations have been observed yet —\n" +
      "# nothing to suggest. Reload the page on the Configuration tab first."
    );
  }

  const keys = Array.from(map.keys()).sort((a, b) => {
    const ai = CSP_DIRECTIVE_ORDER.indexOf(a);
    const bi = CSP_DIRECTIVE_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  const lines = keys.map((d) => `${d} ${Array.from(map.get(d)).sort().join(" ")};`);
  const header = [
    `# Suggested CSP — generated from ${violations.length} captured violation(s) on ${state.url || "this page"}.`,
    "# This only reflects what this browsing session happened to trigger — review",
    "# it against the app's real requirements before using it anywhere."
  ];
  const noteLines = Array.from(notes).map((n) => `# ${n}`);
  return [...header, ...noteLines, "", ...lines].join("\n");
}

// ---------------------------------------------------------------------------
// Debug summary / JSON / HAR-like export builders

function buildDebugSummary() {
  const counts = countByCategory(state.logs.violations);
  const lines = [
    "CSP Disabler — debug summary",
    `Generated: ${new Date().toISOString()}`,
    `Tab URL: ${state.url || "—"}`,
    `Browser: ${state.detectedBrowserName || "Unknown"} ${state.detectedBrowserVersion || ""}`.trim(),
    "",
    "Original CSP (response headers):",
    state.capturedCspText || "  none captured",
    "",
    "Original CSP (<meta> tags):",
    state.capturedMetaText || "  none captured",
    "",
    `CSP violations captured: ${state.logs.violations.length}`
  ];
  for (const [key, label] of LOG_CATEGORIES) {
    if (counts[key] > 0) lines.push(`  ${label}: ${counts[key]}`);
  }
  const errCount = state.logs.console.filter((c) => c.level === "error").length;
  const warnCount = state.logs.console.filter((c) => c.level === "warn").length;
  lines.push("");
  lines.push(`Console entries captured: ${state.logs.console.length}`);
  lines.push(
    `  errors: ${errCount}, warnings: ${warnCount}, other: ${
      state.logs.console.length - errCount - warnCount
    }`
  );
  return lines.join("\n");
}

function currentOriginalCspText() {
  const parts = [];
  if (state.capturedCspText) parts.push("Response headers:\n" + state.capturedCspText);
  if (state.capturedMetaText) parts.push("<meta> tags:\n" + state.capturedMetaText);
  return parts.length ? parts.join("\n\n") : "No original CSP captured for this tab.";
}

function buildJsonExport() {
  return JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      url: state.url,
      browser: {
        name: state.detectedBrowserName,
        version: state.detectedBrowserVersion
      },
      originalCsp: {
        headers: state.capturedCspText || null,
        meta: state.capturedMetaText || null
      },
      suggestedCsp: buildSuggestedCsp(
        state.rawCsp || state.rawMeta || "",
        state.logs.violations
      ),
      violations: state.logs.violations,
      console: state.logs.console
    },
    null,
    2
  );
}

function buildHarReport() {
  const entries = state.logs.violations.map((v) => {
    const blocked = (v.blockedURI || "").toLowerCase();
    const isRealUrl = v.blockedURI && !["inline", "eval", "wasm-eval", ""].includes(blocked);
    return {
      pageref: "page_1",
      startedDateTime: new Date(v.time || Date.now()).toISOString(),
      time: 0,
      request: {
        method: "GET",
        url: isRealUrl ? v.blockedURI : v.documentURI || state.url || "",
        httpVersion: "HTTP/1.1",
        cookies: [],
        headers: [],
        queryString: [],
        headersSize: -1,
        bodySize: -1
      },
      response: {
        status: 0,
        statusText: "Blocked by Content Security Policy",
        httpVersion: "HTTP/1.1",
        cookies: [],
        headers: [],
        content: { size: 0, mimeType: "x-unknown" },
        redirectURL: "",
        headersSize: -1,
        bodySize: -1
      },
      cache: {},
      timings: { send: 0, wait: 0, receive: 0 },
      _csp: {
        category: categorizeViolation(v),
        violatedDirective: v.violatedDirective,
        effectiveDirective: v.effectiveDirective,
        disposition: v.disposition,
        sourceFile: v.sourceFile,
        lineNumber: v.lineNumber,
        columnNumber: v.columnNumber,
        blockedURI: v.blockedURI
      }
    };
  });

  return JSON.stringify(
    {
      log: {
        version: "1.2",
        creator: {
          name: "CSP Disabler",
          version: chrome.runtime.getManifest().version
        },
        pages: [
          {
            startedDateTime: new Date().toISOString(),
            id: "page_1",
            title: state.url || "",
            pageTimings: {}
          }
        ],
        entries
      }
    },
    null,
    2
  );
}

function safeHost() {
  try {
    return new URL(state.url).host.replace(/[^a-z0-9.-]/gi, "_") || "page";
  } catch (e) {
    return "page";
  }
}

async function downloadFile(filename, content, mime, btn) {
  btn.disabled = true;
  const reply = await send({ type: "downloadFile", filename, content, mime });
  btn.disabled = false;
  flashCopy(btn, reply && reply.ok ? "Saved" : "Failed");
}

async function onCopyDebugSummary() {
  await copyText(buildDebugSummary(), els.exportDebugBtn);
}

async function onCopyOriginalCsp() {
  await copyText(currentOriginalCspText(), els.exportOriginalCspBtn);
}

async function onCopySuggestedCsp() {
  const suggestion = buildSuggestedCsp(
    state.rawCsp || state.rawMeta || "",
    state.logs.violations
  );
  await copyText(suggestion, els.exportSuggestedCspBtn);
}

async function onExportJson() {
  await downloadFile(
    `csp-debug-${safeHost()}-${Date.now()}.json`,
    buildJsonExport(),
    "application/json",
    els.exportJsonBtn
  );
}

async function onExportHar() {
  await downloadFile(
    `csp-report-${safeHost()}-${Date.now()}.har`,
    buildHarReport(),
    "application/json",
    els.exportHarBtn
  );
}

async function onExportCspLogs() {
  const data = JSON.stringify(
    {
      url: state.url,
      exportedAt: new Date().toISOString(),
      violations: state.logs.violations
    },
    null,
    2
  );
  await downloadFile(
    `csp-violations-${safeHost()}-${Date.now()}.json`,
    data,
    "application/json",
    els.exportCspLogsBtn
  );
}

async function onExportConsoleLogs() {
  const data = JSON.stringify(
    {
      url: state.url,
      exportedAt: new Date().toISOString(),
      console: state.logs.console
    },
    null,
    2
  );
  await downloadFile(
    `console-logs-${safeHost()}-${Date.now()}.json`,
    data,
    "application/json",
    els.exportConsoleLogsBtn
  );
}

// ---------------------------------------------------------------------------
// Init

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  return tab || null;
}

function wireEvents() {
  for (const t of els.tabs) {
    t.addEventListener("click", () => {
      selectTab(t.dataset.tab);
      if (t.dataset.tab === "logs") loadLogs();
    });
  }
  els.themeBtn.addEventListener("click", toggleTheme);

  els.stripBtn.addEventListener("click", onStripClick);

  els.injectBtn.addEventListener("click", onInjectClick);
  els.applyBtn.addEventListener("click", onApplyClick);
  els.resetBtn.addEventListener("click", onResetClick);

  els.copyBtn.addEventListener("click", () =>
    copyText(state.capturedCspText, els.copyBtn)
  );
  els.copyCurlBtn.addEventListener("click", () =>
    copyText(buildCurlCommand(), els.copyCurlBtn)
  );
  els.copyMetaBtn.addEventListener("click", () =>
    copyText(state.capturedMetaText, els.copyMetaBtn)
  );

  els.policyRefreshBtn.addEventListener("click", refreshBrowserPolicy);
  els.policyOpenBtn.addEventListener("click", openPolicyPage);
  els.policyCopyBtn.addEventListener("click", () =>
    copyText(state.capturedPolicyText, els.policyCopyBtn)
  );

  els.logsRefreshBtn.addEventListener("click", loadLogs);
  els.logsClearBtn.addEventListener("click", onClearLogsClick);
  els.exportDebugBtn.addEventListener("click", onCopyDebugSummary);
  els.exportOriginalCspBtn.addEventListener("click", onCopyOriginalCsp);
  els.exportSuggestedCspBtn.addEventListener("click", onCopySuggestedCsp);
  els.exportJsonBtn.addEventListener("click", onExportJson);
  els.exportHarBtn.addEventListener("click", onExportHar);
  els.exportCspLogsBtn.addEventListener("click", onExportCspLogs);
  els.exportConsoleLogsBtn.addEventListener("click", onExportConsoleLogs);
}

async function init() {
  els.aboutVersion.textContent = chrome.runtime.getManifest().version;
  wireEvents();
  refreshBrowserPolicy();

  // Apply theme as early as possible to avoid a flash.
  try {
    const r = await chrome.storage.local.get("ui_theme");
    applyTheme(r.ui_theme || "light");
  } catch (e) {}

  const tab = await getActiveTab();
  if (!tab || typeof tab.id !== "number") {
    els.stateSub.textContent =
      "Open a regular website tab to use the extension.";
    els.stripBtn.disabled = true;
    els.injectBtn.disabled = true;
    els.applyBtn.disabled = true;
    els.resetBtn.disabled = true;
    return;
  }
  state.tabId = tab.id;
  state.url = tab.url || null;
  await refresh();
  await loadLogs();
}

document.addEventListener("DOMContentLoaded", init);
