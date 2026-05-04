const RULESET_ID = "csp_ruleset";
const STORAGE_KEY = "cspDisabled";

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

async function applyState(disabled) {
  const enabledRulesets = await chrome.declarativeNetRequest.getEnabledRulesets();
  const isEnabled = enabledRulesets.includes(RULESET_ID);

  if (disabled && !isEnabled) {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: [RULESET_ID]
    });
  } else if (!disabled && isEnabled) {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      disableRulesetIds: [RULESET_ID]
    });
  }

  await chrome.action.setIcon({ path: disabled ? ICONS.on : ICONS.off });
  await chrome.action.setTitle({
    title: disabled
      ? "Content-Security-Policy is DISABLED — click to re-enable"
      : "Content-Security-Policy is ENABLED — click to disable"
  });
  await chrome.action.setBadgeText({ text: disabled ? "OFF" : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#c0392b" });
}

async function loadState() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return Boolean(result[STORAGE_KEY]);
}

async function saveState(disabled) {
  await chrome.storage.local.set({ [STORAGE_KEY]: disabled });
}

chrome.runtime.onInstalled.addListener(async () => {
  const disabled = await loadState();
  await applyState(disabled);
});

chrome.runtime.onStartup.addListener(async () => {
  const disabled = await loadState();
  await applyState(disabled);
});

chrome.action.onClicked.addListener(async () => {
  const current = await loadState();
  const next = !current;
  await saveState(next);
  await applyState(next);
});
