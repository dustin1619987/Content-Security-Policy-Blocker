// Visual states:
//   ON  = extension is actively stripping or injecting CSP for the tab
//   OFF = the tab is untouched

const ICONS = {
  on: {
    16: "icons/icon-on-16.png",
    32: "icons/icon-on-32.png",
    48: "icons/icon-on-48.png",
    128: "icons/icon-on-128.png"
  },
  off: {
    16: "icons/icon-off-16.png",
    32: "icons/icon-off-32.png",
    48: "icons/icon-off-48.png",
    128: "icons/icon-off-128.png"
  }
};

const COLOR_ON = "#27ae60"; // green
const COLOR_OFF = "#c0392b"; // red

const CSP_HEADERS = [
  "content-security-policy",
  "content-security-policy-report-only",
  "x-webkit-csp",
  "x-content-security-policy"
];

const RESOURCE_TYPES = [
  "main_frame",
  "sub_frame",
  "stylesheet",
  "script",
  "image",
  "font",
  "object",
  "xmlhttprequest",
  "ping",
  "media",
  "websocket",
  "webtransport",
  "webbundle",
  "other"
];

// ---------------------------------------------------------------------------
// Per-tab state
//
// tabState : Map<tabId, { strip, inject: { enabled, value, mode } }>
//   strip            — boolean, the Configuration ON/OFF toggle
//   inject.enabled   — boolean, the Custom CSP toggle
//   inject.value     — string, the CSP the user typed
//   inject.mode      — "header" | "meta" | "both"
//
// A tab is considered "ON" (green icon) when either strip is on or
// inject is on. Both pieces of state live in chrome.storage.session
// so they survive service-worker restarts within the browser session.

const tabState = new Map();

function defaultState() {
  return {
    strip: false,
    inject: { enabled: false, value: "", mode: "header" }
  };
}

function getState(tabId) {
  return tabState.get(tabId) || defaultState();
}

function isOn(state) {
  return Boolean(state.strip || state.inject.enabled);
}

const stateKey = (tabId) => `state_tab_${tabId}`;

async function saveState(tabId, state) {
  if (!isOn(state) && !state.inject.value) {
    tabState.delete(tabId);
    try {
      await chrome.storage.session.remove(stateKey(tabId));
    } catch (e) {}
    return;
  }
  tabState.set(tabId, state);
  try {
    await chrome.storage.session.set({ [stateKey(tabId)]: state });
  } catch (e) {}
}

// On every worker boot, rehydrate from session storage and from any
// surviving DNR session rules. Every event handler waits on this
// promise before reading tabState.
const rehydrated = (async () => {
  try {
    const all = await chrome.storage.session.get(null);
    for (const [k, v] of Object.entries(all)) {
      if (k.startsWith("state_tab_") && v && typeof v === "object") {
        const tabId = Number(k.slice("state_tab_".length));
        if (Number.isFinite(tabId)) tabState.set(tabId, v);
      }
    }
  } catch (e) {}
  // Defensive fallback: if a DNR rule exists for a tab but we have no
  // stored state, treat it as a strip-only tab so the badge is honest.
  try {
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    for (const r of rules) {
      const ids = r.condition && r.condition.tabIds;
      if (Array.isArray(ids)) {
        for (const id of ids) {
          if (!tabState.has(id)) {
            const s = defaultState();
            s.strip = true;
            tabState.set(id, s);
          }
        }
      }
    }
  } catch (e) {}
})();

// ---------------------------------------------------------------------------
// DNR rule management
//
// Each tab gets at most ONE session rule. The rule's responseHeaders
// list is built from the current state:
//   - inject (header mode)  → set CSP to user value, remove other variants
//   - strip only            → remove all four CSP-family headers
//   - neither               → no rule
//
// Combining strip + inject in one rule avoids ordering questions
// between two separate rules.

const RULE_BASE = 1000;

function ruleIdFor(tabId) {
  return RULE_BASE + tabId;
}

function buildRule(tabId, state) {
  const headerInject =
    state.inject.enabled &&
    (state.inject.mode === "header" || state.inject.mode === "both") &&
    state.inject.value;

  if (!state.strip && !headerInject) return null;

  const responseHeaders = [];
  if (headerInject) {
    responseHeaders.push({
      header: "content-security-policy",
      operation: "set",
      value: state.inject.value
    });
    // Remove report-only and legacy variants so only the injected CSP is in effect.
    responseHeaders.push({ header: "content-security-policy-report-only", operation: "remove" });
    responseHeaders.push({ header: "x-webkit-csp", operation: "remove" });
    responseHeaders.push({ header: "x-content-security-policy", operation: "remove" });
  } else {
    for (const h of CSP_HEADERS) {
      responseHeaders.push({ header: h, operation: "remove" });
    }
  }

  return {
    id: ruleIdFor(tabId),
    priority: 1,
    action: { type: "modifyHeaders", responseHeaders },
    condition: { tabIds: [tabId], resourceTypes: RESOURCE_TYPES }
  };
}

async function syncRule(tabId, state) {
  const rule = buildRule(tabId, state);
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [ruleIdFor(tabId)],
      ...(rule ? { addRules: [rule] } : {})
    });
  } catch (e) {
    // Ignore — rule may already be gone.
  }
}

// ---------------------------------------------------------------------------
// Per-iframe state (Iframe tab)
//
// Keyed by (tabId, iframe URL) rather than frameId: frameId is only valid
// for the current page load and is reassigned on every reload, but the
// point of this feature is a rule that keeps applying to "that iframe"
// across the reload needed to make a header/meta change take effect. The
// DNR rule below matches by exact URL instead, so it survives that.
//
// frameId is still used, live, for things that only make sense against
// the frame as it exists right now: filtering captured logs to just this
// frame, and targeting chrome.scripting.executeScript for meta/service-
// worker reads (both take a frameId, not a URL).

const frameState = new Map(); // `${tabId}::${url}` -> { strip, inject }
const iframeRuleIdByKey = new Map(); // `${tabId}::${url}` -> ruleId
const IFRAME_RULE_BASE = 500000;
let nextIframeRuleSeq = 1;

const frameConfigKey = (tabId, url) => `${tabId}::${url}`;

function defaultFrameConfig() {
  return { strip: false, inject: { enabled: false, value: "", mode: "header" } };
}

function getFrameConfig(tabId, url) {
  return frameState.get(frameConfigKey(tabId, url)) || defaultFrameConfig();
}

function isFrameOn(cfg) {
  return Boolean(cfg.strip || cfg.inject.enabled);
}

function ruleIdForIframe(tabId, url) {
  const key = frameConfigKey(tabId, url);
  if (!iframeRuleIdByKey.has(key)) {
    iframeRuleIdByKey.set(key, IFRAME_RULE_BASE + nextIframeRuleSeq++);
  }
  return iframeRuleIdByKey.get(key);
}

// DNR's urlFilter has its own mini-syntax (*, ^, | are special) — escape
// them, then anchor both ends with | so this matches that exact URL only.
function exactUrlFilter(url) {
  return "|" + url.replace(/[\\*^|]/g, (c) => "\\" + c) + "|";
}

function buildFrameRule(tabId, url, cfg) {
  const headerInject =
    cfg.inject.enabled &&
    (cfg.inject.mode === "header" || cfg.inject.mode === "both") &&
    cfg.inject.value;
  if (!cfg.strip && !headerInject) return null;

  const responseHeaders = [];
  if (headerInject) {
    responseHeaders.push({ header: "content-security-policy", operation: "set", value: cfg.inject.value });
    responseHeaders.push({ header: "content-security-policy-report-only", operation: "remove" });
    responseHeaders.push({ header: "x-webkit-csp", operation: "remove" });
    responseHeaders.push({ header: "x-content-security-policy", operation: "remove" });
  } else {
    for (const h of CSP_HEADERS) {
      responseHeaders.push({ header: h, operation: "remove" });
    }
  }

  return {
    id: ruleIdForIframe(tabId, url),
    // Higher than the tab-wide rule (priority 1) so a per-iframe setting
    // can override the tab-wide strip/inject for that one iframe's URL.
    priority: 2,
    action: { type: "modifyHeaders", responseHeaders },
    condition: { urlFilter: exactUrlFilter(url), tabIds: [tabId], resourceTypes: ["sub_frame"] }
  };
}

async function syncFrameRule(tabId, url, cfg) {
  const ruleId = ruleIdForIframe(tabId, url);
  const rule = buildFrameRule(tabId, url, cfg);
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [ruleId],
      ...(rule ? { addRules: [rule] } : {})
    });
  } catch (e) {}
}

async function setFrameConfig(tabId, url, cfg) {
  const key = frameConfigKey(tabId, url);
  if (!isFrameOn(cfg) && !cfg.inject.value) {
    frameState.delete(key);
  } else {
    frameState.set(key, cfg);
  }
  await syncFrameRule(tabId, url, cfg);
}

async function setFrameStrip(tabId, url, strip) {
  await setFrameConfig(tabId, url, { ...getFrameConfig(tabId, url), strip });
}

async function setFrameInject(tabId, url, inject) {
  const cur = getFrameConfig(tabId, url);
  await setFrameConfig(tabId, url, { ...cur, inject: { ...cur.inject, ...inject } });
}

async function getFramesForTab(tabId) {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    return (frames || [])
      .filter((f) => f.parentFrameId !== -1 && !f.errorOccurred && f.url)
      .map((f) => ({ frameId: f.frameId, url: f.url, parentFrameId: f.parentFrameId }));
  } catch (e) {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Action / icon painting

function buildPaintOps(on, target) {
  const ops = [
    chrome.action.setIcon({ ...target, path: on ? ICONS.on : ICONS.off }),
    chrome.action.setTitle({
      ...target,
      title: on
        ? "CSP Disabler is active for this tab — click to open"
        : "CSP Disabler — click to open"
    }),
    chrome.action.setBadgeText({ ...target, text: on ? "ON" : "OFF" }),
    chrome.action.setBadgeBackgroundColor({
      ...target,
      color: on ? COLOR_ON : COLOR_OFF
    })
  ];
  if (chrome.action.setBadgeTextColor) {
    ops.push(chrome.action.setBadgeTextColor({ ...target, color: "#ffffff" }));
  }
  return ops;
}

async function paintTab(tabId, on) {
  try {
    await Promise.all(buildPaintOps(on, { tabId }));
  } catch (e) {}
}

async function paintGlobal(on) {
  try {
    await Promise.all(buildPaintOps(on, {}));
  } catch (e) {}
}

async function paintCurrentState(tabId) {
  await rehydrated;
  await paintTab(tabId, isOn(getState(tabId)));
}

// ---------------------------------------------------------------------------
// State-mutation entry points

async function applyState(tabId, state, { reload } = { reload: true }) {
  await saveState(tabId, state);
  const on = isOn(state);
  await Promise.all([paintTab(tabId, on), syncRule(tabId, state)]);
  if (reload) {
    try {
      await chrome.tabs.reload(tabId, { bypassCache: false });
    } catch (e) {}
  }
}

async function setStrip(tabId, strip) {
  await rehydrated;
  const state = { ...getState(tabId), strip };
  // The popup sends an explicit { type: "reload" } after this so it
  // can decide when to reload — don't reload here.
  await applyState(tabId, state, { reload: false });
}

async function setInject(tabId, inject) {
  await rehydrated;
  const cur = getState(tabId);
  const next = {
    ...cur,
    inject: { ...cur.inject, ...inject }
  };
  await applyState(tabId, next, { reload: false });
}

// ---------------------------------------------------------------------------
// Tab/navigation listeners

chrome.tabs.onCreated.addListener((tab) => {
  if (typeof tab.id === "number") paintCurrentState(tab.id);
});

chrome.tabs.onUpdated.addListener((tabId) => {
  paintCurrentState(tabId);
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await rehydrated;
  const on = isOn(getState(tabId));
  await Promise.all([paintTab(tabId, on), paintGlobal(on)]);
});

chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return;
  await rehydrated;
  const on = isOn(getState(details.tabId));
  await Promise.all([paintGlobal(on), paintTab(details.tabId, on)]);
  await clearLogs(details.tabId);
});

chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return;
  await rehydrated;
  const on = isOn(getState(details.tabId));
  await Promise.all([paintGlobal(on), paintTab(details.tabId, on)]);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  // Drop captured CSP and per-tab state for closed tabs.
  cspByTab.delete(tabId);
  metaByTab.delete(tabId);
  tabState.delete(tabId);
  logsByTab.delete(tabId);
  try {
    await chrome.storage.session.remove([
      cspKey(tabId),
      metaKey(tabId),
      stateKey(tabId),
      logKey(tabId)
    ]);
  } catch (e) {}

  const prefix = `${tabId}:`;
  for (const key of Array.from(cspByFrame.keys())) {
    if (key.startsWith(prefix)) cspByFrame.delete(key);
  }
  const framePrefix = `${tabId}::`;
  const iframeRuleIdsToRemove = [];
  for (const [key, ruleId] of iframeRuleIdByKey) {
    if (key.startsWith(framePrefix)) {
      iframeRuleIdsToRemove.push(ruleId);
      iframeRuleIdByKey.delete(key);
    }
  }
  for (const key of Array.from(frameState.keys())) {
    if (key.startsWith(framePrefix)) frameState.delete(key);
  }

  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [ruleIdFor(tabId), ...iframeRuleIdsToRemove]
    });
  } catch (e) {}
});

// ---------------------------------------------------------------------------
// CSP capture (response headers + meta tags)

const cspByTab = new Map(); // tabId -> { url, headers, capturedAt }
const metaByTab = new Map(); // tabId -> { url, metas, capturedAt }
// Per-frame capture for the Iframe tab. In-memory only (not persisted to
// storage.session) — frameId is only meaningful for the current page
// load anyway, so there's nothing useful to rehydrate after a restart.
const cspByFrame = new Map(); // `${tabId}:${frameId}` -> { url, headers, capturedAt, frameId }

const cspKey = (tabId) => `csp_tab_${tabId}`;
const metaKey = (tabId) => `meta_tab_${tabId}`;
const frameKey = (tabId, frameId) => `${tabId}:${frameId}`;

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (typeof details.tabId !== "number" || details.tabId < 0) return;
    if (details.type !== "main_frame" && details.type !== "sub_frame") return;

    const csp = (details.responseHeaders || [])
      .filter((h) => CSP_HEADERS.includes((h.name || "").toLowerCase()))
      .map((h) => ({ name: h.name, value: h.value }));

    if (details.type === "main_frame") {
      if (csp.length > 0) {
        const record = { url: details.url, headers: csp, capturedAt: Date.now() };
        cspByTab.set(details.tabId, record);
        try {
          chrome.storage.session.set({ [cspKey(details.tabId)]: record });
        } catch (e) {}
      } else {
        cspByTab.delete(details.tabId);
        try {
          chrome.storage.session.remove(cspKey(details.tabId));
        } catch (e) {}
      }
      return;
    }

    // sub_frame
    const key = frameKey(details.tabId, details.frameId);
    if (csp.length > 0) {
      cspByFrame.set(key, {
        url: details.url,
        headers: csp,
        capturedAt: Date.now(),
        frameId: details.frameId
      });
    } else {
      cspByFrame.delete(key);
    }
  },
  { urls: ["<all_urls>"], types: ["main_frame", "sub_frame"] },
  ["responseHeaders", "extraHeaders"]
);

function getCspForFrame(tabId, frameId) {
  return cspByFrame.get(frameKey(tabId, frameId)) || null;
}

async function getCspForTab(tabId) {
  if (cspByTab.has(tabId)) return cspByTab.get(tabId);
  try {
    const r = await chrome.storage.session.get(cspKey(tabId));
    const rec = r[cspKey(tabId)];
    if (rec) {
      cspByTab.set(tabId, rec);
      return rec;
    }
  } catch (e) {}
  return null;
}

// On-demand: read CSP <meta> tags from the current document. Cached so
// the popup doesn't have to wait on a script execute every time. Pass a
// frameId to read a specific iframe instead of the tab's top frame — that
// path is never cached, since frameId only makes sense for this load.
async function captureMetaCsp(tabId, frameId) {
  try {
    const target = typeof frameId === "number" ? { tabId, frameIds: [frameId] } : { tabId };
    const results = await chrome.scripting.executeScript({
      target,
      func: () => {
        const re = /^(content-security-policy|content-security-policy-report-only|x-webkit-csp|x-content-security-policy)$/i;
        const out = [];
        for (const m of document.querySelectorAll("meta[http-equiv]")) {
          const name = m.getAttribute("http-equiv") || "";
          if (re.test(name)) {
            out.push({
              name,
              value: m.getAttribute("content") || "",
              injected: m.getAttribute("data-csp-disabler-injected") === "1"
            });
          }
        }
        return { url: location.href, metas: out };
      }
    });
    const result = results && results[0] && results[0].result;
    if (result) {
      const record = {
        url: result.url,
        metas: result.metas,
        capturedAt: Date.now()
      };
      if (typeof frameId !== "number") {
        metaByTab.set(tabId, record);
        try {
          await chrome.storage.session.set({ [metaKey(tabId)]: record });
        } catch (e) {}
      }
      return record;
    }
  } catch (e) {
    // chrome:// pages, devtools, etc., or a sandboxed/opaque-origin iframe
    // the extension can't inject into — nothing to do.
  }
  return null;
}

async function getMetaForTab(tabId) {
  // Prefer fresh capture; fall back to cache.
  const fresh = await captureMetaCsp(tabId);
  if (fresh) return fresh;
  if (metaByTab.has(tabId)) return metaByTab.get(tabId);
  try {
    const r = await chrome.storage.session.get(metaKey(tabId));
    if (r[metaKey(tabId)]) return r[metaKey(tabId)];
  } catch (e) {}
  return null;
}

// ---------------------------------------------------------------------------
// Service workers
//
// Queried/registered/unregistered on demand by running a small function
// in the tab's own page context via chrome.scripting.executeScript —
// navigator.serviceWorker is scoped to the page's origin, so this can't
// be done from the extension's own background/popup pages.

async function getServiceWorkersForTab(tabId, frameId) {
  try {
    const target = typeof frameId === "number" ? { tabId, frameIds: [frameId] } : { tabId };
    const results = await chrome.scripting.executeScript({
      target,
      func: async () => {
        if (!("serviceWorker" in navigator)) {
          return { supported: false, url: location.href, registrations: [] };
        }
        const toInfo = (sw) =>
          sw ? { scriptURL: sw.scriptURL, state: sw.state } : null;
        const regs = await navigator.serviceWorker.getRegistrations();
        return {
          supported: true,
          url: location.href,
          registrations: regs.map((r) => ({
            scope: r.scope,
            updateViaCache: r.updateViaCache,
            active: toInfo(r.active),
            waiting: toInfo(r.waiting),
            installing: toInfo(r.installing)
          }))
        };
      }
    });
    return (
      (results && results[0] && results[0].result) || {
        supported: false,
        url: null,
        registrations: []
      }
    );
  } catch (e) {
    return {
      supported: false,
      url: null,
      registrations: [],
      error: String(e && e.message ? e.message : e)
    };
  }
}

async function registerServiceWorkerInTab(tabId, scriptUrl, scope, frameId) {
  try {
    const target = typeof frameId === "number" ? { tabId, frameIds: [frameId] } : { tabId };
    const results = await chrome.scripting.executeScript({
      target,
      func: async (rawUrl, rawScope) => {
        if (!("serviceWorker" in navigator)) {
          return {
            ok: false,
            error: "Service workers aren't supported on this page."
          };
        }
        try {
          const resolvedUrl = new URL(rawUrl, location.href).href;
          const options = {};
          if (rawScope) options.scope = new URL(rawScope, location.href).href;
          const reg = await navigator.serviceWorker.register(resolvedUrl, options);
          return { ok: true, scope: reg.scope };
        } catch (e) {
          return { ok: false, error: String(e && e.message ? e.message : e) };
        }
      },
      args: [scriptUrl, scope || ""]
    });
    return (
      (results && results[0] && results[0].result) || {
        ok: false,
        error: "No response from the page."
      }
    );
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

async function unregisterServiceWorkerInTab(tabId, scope, frameId) {
  try {
    const target = typeof frameId === "number" ? { tabId, frameIds: [frameId] } : { tabId };
    const results = await chrome.scripting.executeScript({
      target,
      func: async (targetScope) => {
        if (!("serviceWorker" in navigator)) {
          return {
            ok: false,
            error: "Service workers aren't supported on this page."
          };
        }
        try {
          const regs = await navigator.serviceWorker.getRegistrations();
          const match = regs.find((r) => r.scope === targetScope);
          if (!match) {
            return { ok: false, error: "That registration no longer exists." };
          }
          const ok = await match.unregister();
          return { ok };
        } catch (e) {
          return { ok: false, error: String(e && e.message ? e.message : e) };
        }
      },
      args: [scope]
    });
    return (
      (results && results[0] && results[0].result) || {
        ok: false,
        error: "No response from the page."
      }
    );
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

// ---------------------------------------------------------------------------
// Logs (CSP violations + page console activity)
//
// logsByTab : Map<tabId, { violations: [], console: [] }>
// Reset at the start of every main-frame navigation so the Logs tab
// always reflects the page currently loaded in the tab. Capped per
// array to keep memory/storage bounded on noisy pages.

const logsByTab = new Map();
const LOG_CAP = 300;
const logKey = (tabId) => `logs_tab_${tabId}`;

function getLogsRecord(tabId) {
  if (!logsByTab.has(tabId)) {
    logsByTab.set(tabId, { violations: [], console: [] });
  }
  return logsByTab.get(tabId);
}

function pushCapped(arr, item) {
  arr.push(item);
  if (arr.length > LOG_CAP) arr.splice(0, arr.length - LOG_CAP);
}

async function persistLogs(tabId) {
  try {
    await chrome.storage.session.set({ [logKey(tabId)]: logsByTab.get(tabId) });
  } catch (e) {}
}

function addViolation(tabId, violation) {
  const rec = getLogsRecord(tabId);
  pushCapped(rec.violations, violation);
  persistLogs(tabId);
}

function addConsoleEntry(tabId, entry) {
  const rec = getLogsRecord(tabId);
  pushCapped(rec.console, entry);
  persistLogs(tabId);
}

async function getLogsForTab(tabId) {
  if (logsByTab.has(tabId)) return logsByTab.get(tabId);
  try {
    const r = await chrome.storage.session.get(logKey(tabId));
    if (r[logKey(tabId)]) {
      logsByTab.set(tabId, r[logKey(tabId)]);
      return r[logKey(tabId)];
    }
  } catch (e) {}
  return { violations: [], console: [] };
}

async function clearLogs(tabId) {
  logsByTab.set(tabId, { violations: [], console: [] });
  try {
    await chrome.storage.session.remove(logKey(tabId));
  } catch (e) {}
}

// ---------------------------------------------------------------------------
// Theme persistence

const THEME_KEY = "ui_theme";

async function getTheme() {
  try {
    const r = await chrome.storage.local.get(THEME_KEY);
    return r[THEME_KEY] === "dark" ? "dark" : "light";
  } catch (e) {
    return "light";
  }
}

async function setTheme(theme) {
  try {
    await chrome.storage.local.set({ [THEME_KEY]: theme });
  } catch (e) {}
}

// ---------------------------------------------------------------------------
// data: URL encoding for downloads
//
// chrome.downloads.download() needs a URL it can fetch. Blob object URLs
// (URL.createObjectURL) aren't available in every MV3 service worker
// build, so exports are encoded as data: URLs instead — self-contained,
// no cleanup required.

function toDataUrl(content, mime) {
  const bytes = new TextEncoder().encode(content);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

// ---------------------------------------------------------------------------
// Message handlers
//
// Popup → background:
//   { type: "getState",    tabId } → { on, strip, inject, csp, meta, theme }
//   { type: "setStrip",    tabId, strip:bool }            → { ok }
//   { type: "setInject",   tabId, inject:{enabled?,value?,mode?} } → { ok }
//   { type: "reload",      tabId }                        → { ok }
//   { type: "setTheme",    theme:"light"|"dark" }         → { ok }
//   { type: "getLogs",     tabId }                        → { violations, console }
//   { type: "clearLogs",   tabId }                        → { ok }
//   { type: "downloadFile", filename, content, mime }     → { ok, downloadId }
//   { type: "getServiceWorkers", tabId, frameId? }         → { supported, url, registrations }
//   { type: "registerServiceWorker", tabId, scriptUrl, scope, frameId? } → { ok, scope? , error? }
//   { type: "unregisterServiceWorker", tabId, scope, frameId? } → { ok, error? }
//   { type: "getFrames",      tabId }                     → { frames: [{frameId,url,parentFrameId}] }
//   { type: "getFrameInfo",   tabId, frameId, frameUrl }   → { csp, meta, strip, inject, on }
//   { type: "setFrameStrip",  tabId, frameUrl, strip:bool }→ { ok }
//   { type: "setFrameInject", tabId, frameUrl, inject:{enabled?,value?,mode?} } → { ok }
//
// Content script → background:
//   { type: "getMetaInject", frameUrl }    → { metaCsp: string | null }
//   { type: "cspViolationLog", violation } → { ok }
//   { type: "consoleLog", entry }          → { ok }

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (!msg || typeof msg.type !== "string") {
        sendResponse({ error: "bad message" });
        return;
      }

      if (msg.type === "getMetaInject") {
        await rehydrated;
        const tabId = sender.tab && sender.tab.id;
        if (typeof tabId !== "number") {
          sendResponse({ metaCsp: null });
          return;
        }
        if (sender.frameId === 0) {
          const s = getState(tabId);
          const wantMeta =
            s.inject.enabled &&
            (s.inject.mode === "meta" || s.inject.mode === "both") &&
            s.inject.value;
          sendResponse({ metaCsp: wantMeta ? s.inject.value : null });
          return;
        }
        // Sub-frame: only applies if this frame's URL matches an iframe
        // the user has configured on the Iframe tab.
        const url = msg.frameUrl || sender.url || "";
        const cfg = getFrameConfig(tabId, url);
        const wantMeta =
          cfg.inject.enabled &&
          (cfg.inject.mode === "meta" || cfg.inject.mode === "both") &&
          cfg.inject.value;
        sendResponse({ metaCsp: wantMeta ? cfg.inject.value : null });
        return;
      }

      const tabId =
        typeof msg.tabId === "number"
          ? msg.tabId
          : sender.tab && sender.tab.id;

      if (msg.type === "setTheme") {
        await setTheme(msg.theme === "dark" ? "dark" : "light");
        sendResponse({ ok: true });
        return;
      }

      if (msg.type === "downloadFile") {
        try {
          if (!chrome.downloads || typeof chrome.downloads.download !== "function") {
            sendResponse({
              error:
                "chrome.downloads is unavailable. This extension was updated to " +
                "need the \"downloads\" permission — reload it from " +
                "chrome://extensions (or edge://extensions), then try again."
            });
            return;
          }
          // MV3 service workers don't support Blob object URLs
          // (URL.createObjectURL doesn't exist there), so encode the
          // content as a data: URL instead — no cleanup needed either.
          const downloadId = await chrome.downloads.download({
            url: toDataUrl(msg.content || "", msg.mime || "application/json"),
            filename: msg.filename || "export.json",
            saveAs: false
          });
          if (typeof downloadId !== "number") {
            const lastError = chrome.runtime.lastError;
            sendResponse({
              error: lastError ? lastError.message : "Download did not start."
            });
            return;
          }
          sendResponse({ ok: true, downloadId });
        } catch (e) {
          sendResponse({ error: String(e && e.message ? e.message : e) });
        }
        return;
      }

      // These arrive from the content script and don't need a response.
      if (msg.type === "cspViolationLog") {
        const id = sender.tab && sender.tab.id;
        if (typeof id === "number") {
          addViolation(id, {
            ...(msg.violation || {}),
            frameId: sender.frameId,
            frameUrl: sender.url
          });
        }
        sendResponse({ ok: true });
        return;
      }

      if (msg.type === "consoleLog") {
        const id = sender.tab && sender.tab.id;
        if (typeof id === "number") {
          addConsoleEntry(id, {
            ...(msg.entry || {}),
            frameId: sender.frameId,
            frameUrl: sender.url
          });
        }
        sendResponse({ ok: true });
        return;
      }

      if (typeof tabId !== "number" || tabId < 0) {
        sendResponse({ error: "no tab" });
        return;
      }

      if (msg.type === "getState") {
        await rehydrated;
        const s = getState(tabId);
        const [csp, meta, theme] = await Promise.all([
          getCspForTab(tabId),
          getMetaForTab(tabId),
          getTheme()
        ]);
        sendResponse({
          on: isOn(s),
          strip: s.strip,
          inject: s.inject,
          csp,
          meta,
          theme
        });
        return;
      }

      if (msg.type === "setStrip") {
        await setStrip(tabId, Boolean(msg.strip));
        sendResponse({ ok: true });
        return;
      }

      if (msg.type === "getLogs") {
        const logs = await getLogsForTab(tabId);
        sendResponse(logs);
        return;
      }

      if (msg.type === "clearLogs") {
        await clearLogs(tabId);
        sendResponse({ ok: true });
        return;
      }

      if (msg.type === "getServiceWorkers") {
        const frameId = typeof msg.frameId === "number" ? msg.frameId : undefined;
        sendResponse(await getServiceWorkersForTab(tabId, frameId));
        return;
      }

      if (msg.type === "registerServiceWorker") {
        const frameId = typeof msg.frameId === "number" ? msg.frameId : undefined;
        sendResponse(
          await registerServiceWorkerInTab(tabId, msg.scriptUrl || "", msg.scope || "", frameId)
        );
        return;
      }

      if (msg.type === "unregisterServiceWorker") {
        const frameId = typeof msg.frameId === "number" ? msg.frameId : undefined;
        sendResponse(await unregisterServiceWorkerInTab(tabId, msg.scope || "", frameId));
        return;
      }

      if (msg.type === "getFrames") {
        sendResponse({ frames: await getFramesForTab(tabId) });
        return;
      }

      if (msg.type === "getFrameInfo") {
        const frameId = msg.frameId;
        const url = msg.frameUrl || "";
        const meta = await captureMetaCsp(tabId, frameId);
        const csp = typeof frameId === "number" ? getCspForFrame(tabId, frameId) : null;
        const cfg = getFrameConfig(tabId, url);
        sendResponse({
          csp,
          meta,
          strip: cfg.strip,
          inject: cfg.inject,
          on: isFrameOn(cfg)
        });
        return;
      }

      if (msg.type === "setFrameStrip") {
        await setFrameStrip(tabId, msg.frameUrl || "", Boolean(msg.strip));
        sendResponse({ ok: true });
        return;
      }

      if (msg.type === "setFrameInject") {
        await setFrameInject(tabId, msg.frameUrl || "", msg.inject || {});
        sendResponse({ ok: true });
        return;
      }

      if (msg.type === "setInject") {
        await setInject(tabId, msg.inject || {});
        sendResponse({ ok: true });
        return;
      }

      if (msg.type === "reload") {
        try {
          await chrome.tabs.reload(tabId, { bypassCache: false });
        } catch (e) {}
        sendResponse({ ok: true });
        return;
      }

      sendResponse({ error: "unknown message type" });
    } catch (e) {
      sendResponse({ error: String(e && e.message ? e.message : e) });
    }
  })();
  return true;
});

// Surfaces a download that started successfully but was later interrupted
// (e.g. blocked by an enterprise download policy) in this service
// worker's own console — inspectable from chrome://extensions.
if (chrome.downloads && chrome.downloads.onChanged) {
  chrome.downloads.onChanged.addListener((delta) => {
    if (delta.state && delta.state.current === "interrupted") {
      console.warn("CSP Disabler: export download was interrupted", delta);
    }
  });
}

// ---------------------------------------------------------------------------
// Lifecycle

async function setGlobalDefaults() {
  try {
    await chrome.action.setBadgeText({ text: "" });
    await chrome.action.setBadgeBackgroundColor({ color: COLOR_OFF });
    if (chrome.action.setBadgeTextColor) {
      await chrome.action.setBadgeTextColor({ color: "#ffffff" });
    }
    await chrome.action.setTitle({ title: "CSP Disabler — click to open" });
  } catch (e) {}
}

async function resetAll() {
  await rehydrated;
  tabState.clear();
  try {
    const all = await chrome.storage.session.get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith("state_tab_"));
    if (keys.length) await chrome.storage.session.remove(keys);
  } catch (e) {}
  const existing = await chrome.declarativeNetRequest.getSessionRules();
  if (existing.length) {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: existing.map((r) => r.id)
    });
  }
  await setGlobalDefaults();

  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map((t) =>
      typeof t.id === "number" ? paintTab(t.id, false) : Promise.resolve()
    )
  );
}

chrome.runtime.onInstalled.addListener(resetAll);
chrome.runtime.onStartup.addListener(resetAll);

// First-boot defaults.
setGlobalDefaults();

// On every worker boot, paint open tabs and snap the global default
// to the focused tab so the very first refresh after a wake-up
// doesn't flash.
(async () => {
  await rehydrated;
  try {
    const tabs = await chrome.tabs.query({ active: true });
    await Promise.all(
      tabs.map((t) =>
        typeof t.id === "number"
          ? paintTab(t.id, isOn(getState(t.id)))
          : Promise.resolve()
      )
    );
    const [focused] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true
    });
    if (focused && typeof focused.id === "number") {
      await paintGlobal(isOn(getState(focused.id)));
    }
  } catch (e) {}
})();
