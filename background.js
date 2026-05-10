// Visual states:
//   ON  = extension is actively stripping CSP for the tab → green icon, "ON"  badge
//   OFF = CSP is working normally for the tab            → red   icon, "OFF" badge

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

const COLOR_ON = "#27ae60";  // green
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

// Tabs where the extension is currently ON (CSP being stripped).
const activeTabs = new Set();

// MV3 service workers are killed when idle. Session rules persist across
// those restarts, but our in-memory Set does not — so on every worker
// boot we rebuild the Set from the surviving rules. Every event handler
// awaits this promise before reading activeTabs, otherwise we'd race
// against rehydration and report a stale OFF state.
const rehydrated = (async () => {
  try {
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    for (const rule of rules) {
      const ids = rule.condition && rule.condition.tabIds;
      if (Array.isArray(ids)) {
        for (const id of ids) activeTabs.add(id);
      }
    }
  } catch (e) {
    // First boot or API unavailable — nothing to rehydrate.
  }
})();

function ruleIdFor(tabId) {
  // Session rule IDs must be positive 32-bit integers; tab IDs are
  // positive, but bump by one to keep the namespace clean.
  return tabId + 1;
}

function makeRule(tabId) {
  return {
    id: ruleIdFor(tabId),
    priority: 1,
    action: {
      type: "modifyHeaders",
      responseHeaders: CSP_HEADERS.map((header) => ({
        header,
        operation: "remove"
      }))
    },
    condition: {
      tabIds: [tabId],
      resourceTypes: RESOURCE_TYPES
    }
  };
}

async function paintTab(tabId, on) {
  try {
    await chrome.action.setIcon({
      tabId,
      path: on ? ICONS.on : ICONS.off
    });
    await chrome.action.setTitle({
      tabId,
      title: on
        ? "CSP DISABLER: ON — click to turn off (CSP will work normally)"
        : "CSP DISABLER: OFF — click to turn on (CSP will be stripped)"
    });
    await chrome.action.setBadgeText({
      tabId,
      text: on ? "ON" : "OFF"
    });
    await chrome.action.setBadgeBackgroundColor({
      tabId,
      color: on ? COLOR_ON : COLOR_OFF
    });
    if (chrome.action.setBadgeTextColor) {
      await chrome.action.setBadgeTextColor({ tabId, color: "#ffffff" });
    }
  } catch (e) {
    // Tab may have closed mid-update; ignore.
  }
}

async function paintCurrentState(tabId) {
  await rehydrated;
  await paintTab(tabId, activeTabs.has(tabId));
}

async function setTabOn(tabId, on) {
  await rehydrated;
  if (on) {
    activeTabs.add(tabId);
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [ruleIdFor(tabId)],
      addRules: [makeRule(tabId)]
    });
  } else {
    activeTabs.delete(tabId);
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [ruleIdFor(tabId)]
    });
  }
  await paintTab(tabId, on);
}

// Toolbar click toggles the current tab and reloads it so the new
// response (with or without CSP) is fetched immediately.
chrome.action.onClicked.addListener(async (tab) => {
  if (typeof tab.id !== "number" || tab.id < 0) return;
  await rehydrated;
  const next = !activeTabs.has(tab.id);
  await setTabOn(tab.id, next);
  try {
    await chrome.tabs.reload(tab.id, { bypassCache: false });
  } catch (e) {
    // Some tabs (chrome://, devtools, etc.) cannot be reloaded; ignore.
  }
});

// Always paint the *correct* state (not just OFF) on routine tab events.
// This way, even if the worker was just woken up by one of these events,
// the badge ends up matching what activeTabs actually says.
chrome.tabs.onCreated.addListener((tab) => {
  if (typeof tab.id === "number") paintCurrentState(tab.id);
});

chrome.tabs.onUpdated.addListener((tabId) => {
  paintCurrentState(tabId);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  paintCurrentState(tabId);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await rehydrated;
  if (!activeTabs.has(tabId)) return;
  activeTabs.delete(tabId);
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [ruleIdFor(tabId)]
    });
  } catch (e) {
    // Already gone.
  }
});

// Sensible global defaults so newly opened tabs never show a blank badge
// while the service worker spins up.
async function setGlobalDefaults() {
  try {
    await chrome.action.setBadgeText({ text: "OFF" });
    await chrome.action.setBadgeBackgroundColor({ color: COLOR_OFF });
    if (chrome.action.setBadgeTextColor) {
      await chrome.action.setBadgeTextColor({ color: "#ffffff" });
    }
    await chrome.action.setTitle({
      title: "CSP DISABLER: OFF — click to turn on (CSP will be stripped)"
    });
  } catch (e) {
    // Best effort.
  }
}

// Wipe state on install / update / browser startup so we never leak
// rules pointing at tab IDs that no longer exist.
async function resetAll() {
  await rehydrated;
  activeTabs.clear();
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

// First-boot defaults (covers the case where the worker started for some
// other reason and neither onInstalled nor onStartup fires).
setGlobalDefaults();
