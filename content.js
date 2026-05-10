// Runs at document_start on every page. Asks the background worker
// whether this tab should have a custom CSP injected as a <meta> tag,
// and if so, prepends it to <head> as early as possible.

(async () => {
  let reply;
  try {
    reply = await chrome.runtime.sendMessage({ type: "getMetaInject" });
  } catch (e) {
    return;
  }
  if (!reply || !reply.metaCsp || typeof reply.metaCsp !== "string") return;

  const value = reply.metaCsp;

  function inject() {
    const head = document.head || document.documentElement;
    if (!head) return false;
    if (head.querySelector('meta[data-csp-disabler-injected="1"]')) return true;
    const meta = document.createElement("meta");
    meta.setAttribute("http-equiv", "Content-Security-Policy");
    meta.setAttribute("content", value);
    meta.setAttribute("data-csp-disabler-injected", "1");
    head.insertBefore(meta, head.firstChild);
    return true;
  }

  if (inject()) return;

  // <head> doesn't exist yet at document_start. Watch the DOM tree
  // until it appears, then inject before the parser sees any other
  // CSP meta tag.
  const observer = new MutationObserver(() => {
    if (inject()) observer.disconnect();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();
