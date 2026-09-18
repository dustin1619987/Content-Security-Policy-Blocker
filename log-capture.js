// Relays CSP violations and page console activity to the background
// worker for the Logs tab. Runs in every frame (all_frames: true) because
// sites like Salesforce Lightning render a lot of their UI — including
// the bits that throw CSP violations for inline/javascript: URLs — inside
// iframes, not just the top-level document.

document.addEventListener("securitypolicyviolation", (e) => {
  try {
    chrome.runtime.sendMessage({
      type: "cspViolationLog",
      violation: {
        time: Date.now(),
        documentURI: e.documentURI || location.href,
        blockedURI: e.blockedURI || "",
        violatedDirective: e.violatedDirective || "",
        effectiveDirective: e.effectiveDirective || e.violatedDirective || "",
        disposition: e.disposition || "enforce",
        sourceFile: e.sourceFile || "",
        lineNumber: e.lineNumber || 0,
        columnNumber: e.columnNumber || 0,
        sample: e.sample || "",
        statusCode: e.statusCode || 0
      }
    }).catch(() => {});
  } catch (err) {}
});

window.addEventListener("__csp_disabler_console__", (e) => {
  try {
    chrome.runtime.sendMessage({
      type: "consoleLog",
      entry: { ...e.detail, documentURI: location.href }
    }).catch(() => {});
  } catch (err) {}
});
