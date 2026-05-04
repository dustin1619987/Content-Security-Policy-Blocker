# Disable Content-Security-Policy

A Manifest V3 Chrome extension that strips `Content-Security-Policy` (and related)
response headers, allowing pages that would normally be blocked by CSP to load
inline scripts, styles, and cross-origin resources.

Modeled after the popular
["Disable Content-Security-Policy"](https://chromewebstore.google.com/detail/disable-content-security/ieelmcmcagommplceebfedjlakkhpden)
extension: a single toolbar button toggles the behavior on and off, and the
state is persisted across browser sessions.

## What it removes

When toggled ON, the extension removes the following response headers from every
HTTP(S) response:

- `Content-Security-Policy`
- `Content-Security-Policy-Report-Only`
- `X-WebKit-CSP`
- `X-Content-Security-Policy`
- `X-Frame-Options`
- `Cross-Origin-Embedder-Policy`
- `Cross-Origin-Opener-Policy`
- `Cross-Origin-Resource-Policy`

When toggled OFF, no rules are active and Chrome behaves normally.

## How it works

- Uses the `declarativeNetRequest` API with a static ruleset
  (`rules.json`) that strips the headers listed above.
- The ruleset ships **disabled**. The background service worker
  (`background.js`) enables / disables it in response to clicks on the
  toolbar action.
- State is persisted in `chrome.storage.local` and restored on browser
  startup and on extension install / update.
- The toolbar icon switches between a gray shield (off) and a red shield
  with `OFF` badge (on) so the current state is always visible.

## Install (developer mode)

1. Open `chrome://extensions`.
2. Toggle **Developer mode** on (top-right).
3. Click **Load unpacked** and select this directory.
4. Pin the extension from the puzzle-piece menu so the toolbar icon is
   visible.
5. Click the icon to toggle CSP stripping on / off. The icon color and badge
   reflect the current state.

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | MV3 manifest, declares the static DNR ruleset (initially disabled). |
| `rules.json` | Static `declarativeNetRequest` ruleset that strips CSP / framing headers. |
| `background.js` | Service worker: handles toolbar clicks, persists state, updates icon. |
| `icons/` | Toolbar icons in on / off states at 16, 32, 48, 128 px. |
| `scripts/make_icons.py` | Regenerates the PNG icons from code (requires Pillow). |

## Security note

Disabling CSP removes a real defense-in-depth protection that sites use to
mitigate XSS and clickjacking. Use only on sites you trust or for development
and testing, and toggle it back off when you are done.
