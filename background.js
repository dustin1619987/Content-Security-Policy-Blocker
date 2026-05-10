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
  try {
    await chrome.storage.session.remove([
      cspKey(tabId),
      metaKey(tabId),
      stateKey(tabId)
    ]);
  } catch (e) {}
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [ruleIdFor(tabId)]
    });
  } catch (e) {}
});

// ---------------------------------------------------------------------------
// CSP capture (response headers + meta tags)

const cspByTab = new Map(); // tabId -> { url, headers, capturedAt }
const metaByTab = new Map(); // tabId -> { url, metas, capturedAt }

const cspKey = (tabId) => `csp_tab_${tabId}`;
const metaKey = (tabId) => `meta_tab_${tabId}`;

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.type !== "main_frame") return;
    if (typeof details.tabId !== "number" || details.tabId < 0) return;

    const csp = (details.responseHeaders || [])
      .filter((h) => CSP_HEADERS.includes((h.name || "").toLowerCase()))
      .map((h) => ({ name: h.name, value: h.value }));

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
  },
  { urls: ["<all_urls>"], types: ["main_frame"] },
  ["responseHeaders", "extraHeaders"]
);

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
// the popup doesn't have to wait on a script execute every time.
async function captureMetaCsp(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
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
      metaByTab.set(tabId, record);
      try {
        await chrome.storage.session.set({ [metaKey(tabId)]: record });
      } catch (e) {}
      return record;
    }
  } catch (e) {
    // chrome:// pages, devtools, etc. — nothing to do.
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
// Message handlers
//
// Popup → background:
//   { type: "getState",    tabId } → { on, strip, inject, csp, meta, theme }
//   { type: "setStrip",    tabId, strip:bool }            → { ok }
//   { type: "setInject",   tabId, inject:{enabled?,value?,mode?} } → { ok }
//   { type: "reload",      tabId }                        → { ok }
//   { type: "setTheme",    theme:"light"|"dark" }         → { ok }
//
// Content script → background:
//   { type: "getMetaInject" } → { metaCsp: string | null }

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
        const s = getState(tabId);
        const wantMeta =
          s.inject.enabled &&
          (s.inject.mode === "meta" || s.inject.mode === "both") &&
          s.inject.value;
        sendResponse({ metaCsp: wantMeta ? s.inject.value : null });
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
