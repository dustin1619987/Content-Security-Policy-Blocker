const els = {
  body: document.body,
  statusPill: document.getElementById("status-pill"),
  statusLabel: document.getElementById("status-label"),
  stateSub: document.getElementById("state-sub"),
  toggleBtn: document.getElementById("toggle-btn"),
  toggleLabel: document.getElementById("toggle-label"),
  cspPre: document.getElementById("csp-pre"),
  cspUrl: document.getElementById("csp-url"),
  copyBtn: document.getElementById("copy-btn"),
  aboutVersion: document.getElementById("about-version"),
  tabs: Array.from(document.querySelectorAll(".tab")),
  panels: {
    config: document.getElementById("panel-config"),
    about: document.getElementById("panel-about")
  }
};

let currentTabId = null;
let currentCspText = "";

function applyState(on) {
  els.body.dataset.state = on ? "on" : "off";
  els.statusLabel.textContent = on ? "ON" : "OFF";
  els.toggleLabel.textContent = on ? "Turn OFF" : "Turn ON";
  els.stateSub.textContent = on
    ? "CSP headers are being stripped from this tab's responses."
    : "CSP headers are working normally.";
}

function setCspContent(record) {
  if (!record || !Array.isArray(record.headers) || record.headers.length === 0) {
    els.cspPre.textContent =
      "No CSP captured for this tab yet.\n\n" +
      "Reload the page (or visit a CSP-protected site) to capture\n" +
      "the headers the server sent.";
    els.cspPre.classList.add("is-empty");
    els.cspUrl.textContent = "—";
    els.cspUrl.title = "";
    els.copyBtn.disabled = true;
    currentCspText = "";
    return;
  }

  els.cspPre.classList.remove("is-empty");
  els.cspUrl.textContent = record.url || "—";
  els.cspUrl.title = record.url || "";

  const lines = record.headers.map(({ name, value }) => `${name}: ${value}`);
  currentCspText = lines.join("\n");

  // Render with the directive name highlighted on each line.
  els.cspPre.textContent = "";
  for (const { name, value } of record.headers) {
    const nameSpan = document.createElement("span");
    nameSpan.className = "csp-directive";
    nameSpan.textContent = `${name}: `;
    els.cspPre.appendChild(nameSpan);
    els.cspPre.appendChild(document.createTextNode(value));
    els.cspPre.appendChild(document.createTextNode("\n"));
  }
  els.copyBtn.disabled = false;
}

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

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  return tab || null;
}

async function refresh() {
  if (currentTabId == null) return;
  try {
    const reply = await chrome.runtime.sendMessage({
      type: "getState",
      tabId: currentTabId
    });
    if (!reply || reply.error) return;
    applyState(Boolean(reply.on));
    setCspContent(reply.csp);
  } catch (e) {
    // service worker may have just started; retry once after a tick.
  }
}

async function onToggleClick() {
  if (currentTabId == null || els.toggleBtn.disabled) return;
  els.toggleBtn.disabled = true;
  // Optimistically flip the visual state so the popup feels snappy.
  const optimistic = els.body.dataset.state !== "on";
  applyState(optimistic);
  try {
    const reply = await chrome.runtime.sendMessage({
      type: "toggle",
      tabId: currentTabId
    });
    if (reply && typeof reply.on === "boolean") {
      applyState(reply.on);
    }
  } catch (e) {
    // ignore — popup will close on tab reload anyway.
  } finally {
    els.toggleBtn.disabled = false;
  }
}

async function onCopyClick() {
  if (!currentCspText) return;
  try {
    await navigator.clipboard.writeText(currentCspText);
    els.copyBtn.classList.add("copied");
    els.copyBtn.textContent = "Copied";
    setTimeout(() => {
      els.copyBtn.classList.remove("copied");
      els.copyBtn.textContent = "Copy";
    }, 1200);
  } catch (e) {
    els.copyBtn.textContent = "Failed";
    setTimeout(() => {
      els.copyBtn.textContent = "Copy";
    }, 1200);
  }
}

function wireTabs() {
  for (const t of els.tabs) {
    t.addEventListener("click", () => selectTab(t.dataset.tab));
  }
}

async function init() {
  wireTabs();

  els.aboutVersion.textContent = chrome.runtime.getManifest().version;
  els.toggleBtn.addEventListener("click", onToggleClick);
  els.copyBtn.addEventListener("click", onCopyClick);

  const tab = await getActiveTab();
  if (!tab || typeof tab.id !== "number") {
    applyState(false);
    setCspContent(null);
    els.toggleBtn.disabled = true;
    els.stateSub.textContent =
      "Open a regular website tab to use the extension.";
    return;
  }
  currentTabId = tab.id;
  await refresh();
}

document.addEventListener("DOMContentLoaded", init);
