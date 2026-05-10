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

function buildPaintOps(on, target) {
  // target is either { tabId } for a per-tab override, or {} for the
  // action's global default.
  const ops = [
    chrome.action.setIcon({ ...target, path: on ? ICONS.on : ICONS.off }),
    chrome.action.setTitle({
      ...target,
      title: on
        ? "CSP DISABLER: ON — click to turn off (CSP will work normally)"
        : "CSP DISABLER: OFF — click to turn on (CSP will be stripped)"
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
  } catch (e) {
    // Tab may have closed mid-update; ignore.
  }
}

// Set the action's GLOBAL default state. This is what Chrome briefly
// renders during a tab's navigation transition, before the per-tab
// override is reapplied. By snapping the global default to match the
// navigating tab's state right before navigation, we eliminate the
// flash to the wrong state on refresh.
async function paintGlobal(on) {
  try {
    await Promise.all(buildPaintOps(on, {}));
  } catch (e) {
    // Best effort.
  }
}

async function paintCurrentState(tabId) {
  await rehydrated;
  await paintTab(tabId, activeTabs.has(tabId));
}

async function setTabOn(tabId, on) {
  await rehydrated;
  if (on) activeTabs.add(tabId);
  else activeTabs.delete(tabId);

  // Run the paint and the DNR rule update in parallel. The paint is
  // a few small chrome.action IPCs and finishes in ~5-10ms; the rule
  // update is heavier. Awaiting them serially used to mean the user
  // saw the previous badge state for the entire rule-update window.
  const ruleUpdate = on
    ? chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [ruleIdFor(tabId)],
        addRules: [makeRule(tabId)]
      })
    : chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [ruleIdFor(tabId)]
      });
  await Promise.all([paintTab(tabId, on), ruleUpdate]);
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

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  // Sync the global default to the newly focused tab's state too.
  // If the user refreshes right after switching tabs, the brief
  // navigation-transition flash will already match the correct state.
  await rehydrated;
  const on = activeTabs.has(tabId);
  await Promise.all([paintTab(tabId, on), paintGlobal(on)]);
});

// webNavigation fires earlier than tabs.onUpdated. For every top-frame
// navigation we both (a) snap the action's GLOBAL default state to
// match the navigating tab's per-tab state, so the brief default
// rendering during Chrome's nav transition shows the correct state,
// and (b) re-assert the per-tab override afterward.
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return;
  await rehydrated;
  const on = activeTabs.has(details.tabId);
  await Promise.all([paintGlobal(on), paintTab(details.tabId, on)]);
});

chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return;
  await rehydrated;
  const on = activeTabs.has(details.tabId);
  await Promise.all([paintGlobal(on), paintTab(details.tabId, on)]);
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

// Sensible global defaults. We deliberately do NOT set the global default
// badge text to "OFF". Per-tab badges are set explicitly via paintTab on
// every tab event, so every tab ends up with a correct per-tab override.
// The only window where the global default applies is during a tab's
// brief navigation transition — and in that window we want NOTHING to
// flash, not "OFF". Otherwise you see ON → OFF → ON when toggling on
// a CSP-protected page that has to reload.
async function setGlobalDefaults() {
  try {
    await chrome.action.setBadgeText({ text: "" });
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

// On every service-worker boot, repaint the currently-focused tabs as
// soon as we can. If the worker was woken up by a refresh, this races
// the navigation paint: the sooner our per-tab override re-asserts,
// the less of the default-icon flash the user can see.
(async () => {
  await rehydrated;
  try {
    const tabs = await chrome.tabs.query({ active: true });
    await Promise.all(
      tabs.map((t) =>
        typeof t.id === "number"
          ? paintTab(t.id, activeTabs.has(t.id))
          : Promise.resolve()
      )
    );
    // Snap the global default to the user's focused tab so the very
    // first refresh after the worker wakes up doesn't flash either.
    const [focused] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true
    });
    if (focused && typeof focused.id === "number") {
      await paintGlobal(activeTabs.has(focused.id));
    }
  } catch (e) {
    // Best effort.
  }
})();
