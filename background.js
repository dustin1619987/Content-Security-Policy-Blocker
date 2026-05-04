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

// Tabs where CSP is currently being stripped. Lives only for the browser
// session — session rules and this Set are both cleared on browser restart.
const disabledTabs = new Set();

function ruleIdFor(tabId) {
  // Session rule IDs must be positive 32-bit integers; tab IDs are positive,
  // but bump by one to keep the namespace clean.
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

async function updateIcon(tabId) {
  const disabled = disabledTabs.has(tabId);
  try {
    await chrome.action.setIcon({
      tabId,
      path: disabled ? ICONS.on : ICONS.off
    });
    await chrome.action.setTitle({
      tabId,
      title: disabled
        ? "Content-Security-Policy is DISABLED for this tab — click to re-enable"
        : "Disable Content-Security-Policy for this tab"
    });
    await chrome.action.setBadgeText({
      tabId,
      text: disabled ? "OFF" : ""
    });
    await chrome.action.setBadgeBackgroundColor({
      tabId,
      color: "#c0392b"
    });
  } catch (e) {
    // Tab may have closed mid-update; ignore.
  }
}

async function setTabDisabled(tabId, disabled) {
  if (disabled) {
    disabledTabs.add(tabId);
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [ruleIdFor(tabId)],
      addRules: [makeRule(tabId)]
    });
  } else {
    disabledTabs.delete(tabId);
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [ruleIdFor(tabId)]
    });
  }
  await updateIcon(tabId);
}

chrome.action.onClicked.addListener(async (tab) => {
  if (typeof tab.id !== "number" || tab.id < 0) return;
  const next = !disabledTabs.has(tab.id);
  await setTabDisabled(tab.id, next);
  // Reload so the new response (with or without CSP) is fetched.
  try {
    await chrome.tabs.reload(tab.id, { bypassCache: false });
  } catch (e) {
    // Tab may not be reloadable (e.g., chrome:// pages); ignore.
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (!disabledTabs.has(tabId)) return;
  disabledTabs.delete(tabId);
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [ruleIdFor(tabId)]
    });
  } catch (e) {
    // Already gone.
  }
});

// Reset state on install / update / browser startup so we don't leak rules
// pointing at tab IDs that no longer exist.
async function resetAll() {
  disabledTabs.clear();
  const existing = await chrome.declarativeNetRequest.getSessionRules();
  if (existing.length) {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: existing.map((r) => r.id)
    });
  }
}

chrome.runtime.onInstalled.addListener(resetAll);
chrome.runtime.onStartup.addListener(resetAll);
