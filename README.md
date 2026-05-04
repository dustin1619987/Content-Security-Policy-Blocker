# Disable Content-Security-Policy

A Manifest V3 Chrome extension that disables the
`Content-Security-Policy` response header on a **per-tab** basis.

Click the toolbar icon to disable CSP for the current tab and reload it.
Click again to re-enable CSP and reload. Other tabs are unaffected.

Modeled after the
["Disable Content-Security-Policy"](https://chromewebstore.google.com/detail/disable-content-security/ieelmcmcagommplceebfedjlakkhpden)
extension on the Chrome Web Store.

## What it removes

When CSP is disabled for a tab, the following response headers are stripped
from every request made by that tab:

- `Content-Security-Policy`
- `Content-Security-Policy-Report-Only`
- `X-WebKit-CSP`
- `X-Content-Security-Policy`

`X-Frame-Options` and the COOP / COEP / CORP isolation headers are **not**
touched, matching the upstream extension's narrower scope.

## How it works

- Uses the `declarativeNetRequest` **session rules** API. When you click the
  toolbar action, the background service worker installs a `modifyHeaders`
  rule scoped to that tab via `condition.tabIds`, then reloads the tab.
- Clicking again removes the rule and reloads the tab so the original CSP
  takes effect.
- The toolbar icon and a small `OFF` badge show per-tab state, so you can
  always see at a glance which tabs have CSP disabled.
- Per-tab rules and state are cleared automatically when a tab is closed,
  the extension is reloaded, or the browser restarts (session rules do not
  persist across browser restarts).

## Install (developer mode)

1. Open `chrome://extensions`.
2. Toggle **Developer mode** on (top-right).
3. Click **Load unpacked** and select this directory.
4. Pin the extension from the puzzle-piece menu so the toolbar icon is
   visible.
5. Open a page, click the icon, and the tab will reload with CSP stripped.
   Click again to restore CSP.

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | MV3 manifest. `<all_urls>` host access; `declarativeNetRequest` permission. |
| `background.js` | Service worker. Toggles per-tab session rules, updates icon/badge, cleans up on tab close. |
| `icons/` | Toolbar icons in on / off states at 16, 32, 48, 128 px. |
| `scripts/make_icons.py` | Regenerates the PNG icons from code (requires Pillow). |

## Security note

CSP is a real defense-in-depth protection against XSS and clickjacking.
Disable it only on tabs you trust, for development or testing, and re-enable
it (or just close the tab) when you're done.
