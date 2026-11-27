# Pocket Demo Bot — Firefox Extension (Manifest V2, Android)

Demo-only Pocket Option bot as a Firefox extension for Android.
Version 1.1.0 — auth is intercepted from the page's own `42["auth"]`
message (like BinaryOptionsToolsV2's official SSID Fetcher), with the
cookies API as fallback, and automatic re-auth on expiry/failure.

## Why an extension (and not the Tampermonkey script)?

The Tampermonkey userscript (v1.2.2) cannot read the price on mobile
Firefox: the price is drawn on `<canvas>` (no price in the DOM, decimals 0,
SVG 0, Shadow 0), there are no CALL/PUT buttons in the DOM, and its
in-page WebSocket hook only ever sees Socket.IO handshake messages
(`sid`, `upgrades`, `pingInterval`, …) — zero `42[...]` price events in
75 s — because the page socket was opened and authenticated before the
hook was injected, so the platform sends no price events to an
unauthenticated socket, and because price events also arrive as binary
`451-` frames that the script's parser drops.

This extension has three privileges a userscript does not:

1. **Auth interception** — `auth-hook.js` runs at `document_start` and
   wraps `WebSocket.send` / XHR / `fetch` in the page context. When the
   page itself sends `42["auth", {...}]`, the session, uid and isDemo
   are captured from it (same idea as BinaryOptionsToolsV2's official
   SSID Fetcher userscript). The value stays in-memory only, is never
   logged, stored, displayed or sent anywhere outside the browser.
2. **`browser.cookies`** — reads the session cookie from the user's own
   logged-in Firefox (including `httpOnly`), watches it with
   `cookies.onChanged`, and re-reads it on reconnect / re-auth. The
   session is short-lived; the extension fetches the new one
   automatically. If the user is fully logged out, no extension can
   invent a session — he logs in himself, then it is picked up.
   Auth source priority: intercepted page auth first, cookies second.
   On auth failure / socket close, the extension automatically asks
   the page for a fresh intercepted auth, re-reads cookies, and
   reconnects — no user action while still logged in.
3. **Its own Socket.IO client** — the background script opens its own
   connection to the price socket
   `wss://demo-api-eu.po.market/socket.io/?EIO=4&transport=websocket`,
   authenticates with the in-browser session, waits for `successauth`
   in any payload shape, subscribes explicitly to the current asset
   (`subscribeSymbol` + `changeSymbol`), and reads the `updateStream`
   price event (`{asset, timestamp, value}`) in both `42[...]` and
   binary `451-` forms.

## What it contains

| File | What it does |
|---|---|
| `manifest.json` | Manifest V2 (Firefox Android), version 1.1.0, permissions: `cookies`, `storage`, `tabs`, `activeTab`, hosts `*.pocketoption.com`, `*.po.market` only. No other hosts, no remote code. |
| `auth-hook.js` | Runs at `document_start` in the page context: wraps `WebSocket.send` / XHR / `fetch`, captures the page's own `42["auth"]` frame (session, uid, isDemo) and the URLs of sockets the page opens (host+path only). Forwards both to the content script via `postMessage`. |
| `background.js` | Socket.IO client (Engine.IO handshake `0` → `40`, ping `2` → `3`, `42`/`451-` events incl. namespaced `42/ns,...`), auth with the intercepted session first, cookies second (`42["auth", {"session", "isDemo": 1, "uid", "platform": 2, "isFastHistory": true, "isOptimized": true}]`), `subscribeSymbol` / `changeSymbol`, price ticks forwarded to content scripts, `openOrder` trade execution (demo only, only after `successopenOrder` confirmation), automatic re-auth on expiry/failure. |
| `content.js` | The v1.2.2 trading engine copied verbatim (11 strategies, Balanced/Conservative/Aggressive, editable stake / daily profit / daily loss / max trades / stop-after-N-losses, multi-strategy checkboxes, same Arabic panel) with the price source replaced by extension ticks (`priceSource = 'extension-socket'`). Execution: DOM CALL/PUT click first; if no DOM button exists, socket `openOrder`. |
| `popup.html` / `popup.js` | Status + START/STOP. Never shows any session value. |

## Session safety

- The session value is **never logged, never stored, never sent
  anywhere**. It lives only in the background script's memory, inside
  the user's own browser. Logs record cookie *names and lengths only*.
- No network access except `*.pocketoption.com` and `*.po.market`.
- Demo only: a trade is refused unless `isDemo == 1` **and** the page
  shows Demo. If the platform ever says the account is real, trading
  locks until the extension is reloaded.

## Known unverified parts (read before the first live run)

- The `openOrder` frame name/payload and its `successopenOrder` /
  `failopenOrder` replies come from open-source-repo research
  (2026-11-27) and have **not** been tested live yet. The first live
  run must watch the panel log for `0` handshake → `successauth` →
  first `updateStream` tick **before** pressing START, and a socket
  trade is only counted after the platform confirms it.
- The install path was verified from Mozilla's documentation and
  third-party READMEs, **not** on a real phone — see `INSTALL_AR.md`.
- Automation violates Pocket Option's terms and can get the account
  banned even on demo. No profit guarantee: the best backtest of the
  strategy engine was 47.8% vs a ~52.1% break-even.

## Install

See `INSTALL_AR.md` (Arabic, step by step). Short version: Firefox
Nightly on Android → debug menu (tap the logo 5 times in About) →
`about:config`, set `xpinstall.signatures.required = false` → Settings →
"Install add-on from file" → pick `pocket-demo-bot-firefox.xpi`.
Disable the Tampermonkey v1.2.2 script for Pocket Option while testing
this extension — both build the same panel and would fight each other.
