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
  capturedUrl: ""
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
    return;
  }

  els.cspPre.classList.remove("is-empty");
  els.cspUrl.textContent = record.url || "—";
  els.cspUrl.title = record.url || "";
  state.capturedUrl = record.url || "";

  state.capturedCspText = record.headers
    .map(({ name, value }) => `${name}: ${value}`)
    .join("\n");

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
    return;
  }
  els.metaPre.classList.remove("is-empty");

  state.capturedMetaText = record.metas
    .map((m) => `${m.name}: ${m.value}${m.injected ? "  (injected)" : ""}`)
    .join("\n");

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
    t.addEventListener("click", () => selectTab(t.dataset.tab));
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
}

async function init() {
  els.aboutVersion.textContent = chrome.runtime.getManifest().version;
  wireEvents();

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
}

document.addEventListener("DOMContentLoaded", init);
