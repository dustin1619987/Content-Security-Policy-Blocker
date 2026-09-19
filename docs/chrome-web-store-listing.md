# Chrome Web Store listing — copy-paste reference

Draft text for the Developer Dashboard fields. Edit to taste, but this
covers what each field is actually asking for.

## Store listing description (long, not the manifest's 132-char one)

> CSP Disabler is a developer toolkit for testing and debugging
> Content-Security-Policy on any website.
>
> Toggle or strip a page's CSP response headers per tab, inject your own
> custom policy (as a header, a `<meta>` tag, or both), and see exactly
> what the server originally sent before you touch it.
>
> The Logs tab captures real CSP violations and console activity as they
> happen — categorized by directive (scripts, images, frames,
> connections, inline/eval violations, and more) — plus any Service
> Workers registered on the page. Export everything as JSON, a HAR-like
> report, or plain-text logs, or copy a suggested CSP built from what was
> actually observed being blocked.
>
> The Iframe tab brings all of the above to a specific iframe on the
> page instead of just the top frame — pick one from a dropdown and
> inspect, toggle, or inject its CSP independently.
>
> The Browser Policy tab shows your browser/OS, how the extension itself
> was installed, and any enterprise policy an administrator has pushed to
> it — everything an extension is actually allowed to see, since
> `chrome://policy` itself is off-limits to extension code.
>
> Built for web developers, security testers, and QA — not for browsing
> with CSP permanently disabled. Re-enable CSP (or close the tab) when
> you're done testing.

## Category
Developer Tools

## Single purpose statement
> A CSP (Content-Security-Policy) testing and debugging toolkit for web
> developers: toggle, inspect, and inject CSP policies, and view the
> resulting violations, console activity, and service worker state, for
> the current tab or a specific iframe on it.

## Privacy practices tab — data usage disclosures
For each category the dashboard asks about, the honest answer is **"No,
I do not collect this data"**: Personally identifiable information,
Health info, Financial/payment info, Authentication info, Personal
communications, Location, Web history, User activity, Website content.

Certification checkboxes that apply:
- ✅ I do not sell or transfer user data to third parties, outside of the approved use cases.
- ✅ I do not use or transfer user data for purposes unrelated to the item's single purpose.
- ✅ I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL**: `https://<your-github-username>.github.io/Content-Security-Policy-Blocker/privacy-policy.html`
(see `docs/privacy-policy.html` in this repo — enable GitHub Pages, serving from `/docs` on this branch, to get that URL live.)

## Permission justifications
The dashboard asks you to justify each "powerful" permission. Copy-paste starting points:

**Host permission — `<all_urls>`**
> This is a CSP testing tool. Web developers need to test CSP behavior on
> whatever site they're actively working on, which is unknown in advance
> — so the extension needs to be able to run on any site the user
> chooses to test, not a fixed list of domains.

**`declarativeNetRequest`**
> Used to strip or replace the Content-Security-Policy (and related
> legacy CSP) response headers for the specific tab or iframe the user
> has chosen to test, via session-scoped rules that only apply to that
> tab.

**`webRequest`**
> Used in read-only fashion (not blocking) to capture the original
> Content-Security-Policy header values from a page's response headers,
> so the user can inspect what the server actually sent before any
> modification.

**`webNavigation`**
> Used to detect page loads and reloads so the toolbar icon/badge state,
> and captured/logged CSP data, correctly reset per navigation instead of
> showing stale data from a previous page.

**`scripting`**
> Used to read `<meta http-equiv="Content-Security-Policy">` tags from
> the page or a chosen iframe, to inject a user-authored CSP as a
> `<meta>` tag for testing, and to query/register/unregister Service
> Workers for the page or iframe being debugged.

**`storage`**
> Used to persist the user's per-tab toggle state and light/dark theme
> preference locally in the browser. No data leaves the device.

**`downloads`**
> Used only when the user explicitly clicks an "Export" button, to save a
> JSON/HAR/log file of captured CSP violations or console activity
> directly to their own Downloads folder.

## Assets checklist
- [ ] Icon: 128×128 PNG — already in `icons/icon-off-128.png`, the store pulls this from the package automatically.
- [ ] At least 1 screenshot, 1280×800 or 640×400 — see `docs/store-screenshots/` (composited to 1280×800, ready to upload as-is).
- [ ] Optional: small promo tile 440×280, marquee 1400×560 (only needed if requesting featured placement).
