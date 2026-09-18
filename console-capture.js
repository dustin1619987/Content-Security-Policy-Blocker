// Runs in the page's own MAIN world (not the isolated content-script world)
// so it can see the page's real console.* calls and uncaught errors, not
// just ones made by our own code. Forwards everything to content.js via a
// DOM CustomEvent, since MAIN-world scripts can't call chrome.runtime
// directly.

(function () {
  if (window.__cspDisablerConsoleHooked) return;
  window.__cspDisablerConsoleHooked = true;

  const LEVELS = ["log", "info", "warn", "error", "debug"];
  const original = {};

  function stringifyArg(a) {
    if (typeof a === "string") return a;
    if (a instanceof Error) return a.stack || a.message || String(a);
    try {
      return JSON.stringify(a);
    } catch (e) {
      return String(a);
    }
  }

  function post(entry) {
    try {
      window.dispatchEvent(
        new CustomEvent("__csp_disabler_console__", { detail: entry })
      );
    } catch (e) {}
  }

  for (const level of LEVELS) {
    const fn = console[level];
    if (typeof fn !== "function") continue;
    original[level] = fn.bind(console);
    console[level] = function (...args) {
      post({
        level,
        message: args.map(stringifyArg).join(" "),
        time: Date.now()
      });
      return original[level](...args);
    };
  }

  window.addEventListener("error", (e) => {
    post({
      level: "error",
      kind: "uncaught-exception",
      message: e.message || "Uncaught error",
      sourceFile: e.filename || "",
      lineNumber: e.lineno || 0,
      columnNumber: e.colno || 0,
      time: Date.now()
    });
  });

  window.addEventListener("unhandledrejection", (e) => {
    let reason;
    try {
      reason =
        e.reason instanceof Error
          ? e.reason.stack || e.reason.message
          : typeof e.reason === "string"
          ? e.reason
          : JSON.stringify(e.reason);
    } catch (err) {
      reason = String(e.reason);
    }
    post({
      level: "error",
      kind: "unhandled-rejection",
      message: `Unhandled promise rejection: ${reason}`,
      time: Date.now()
    });
  });
})();
