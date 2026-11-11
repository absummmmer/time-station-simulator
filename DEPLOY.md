# Deployment

The application is plain static files. Serve this directory over HTTP(S); do not
open `index.html` via `file://`, because audio assets and the Time API are loaded
over HTTP.

The server must serve `.html`, `.js`, `.css`, `.woff2`, `.woff`, `.mp3`, `.svg`
and `.ico` with their normal MIME types.

## Runtime files

```text
index.html
core.js
audio-engine.js
time-sync.js
observability.js
app.js
styles.css
tailwind.css
favicon.svg
favicon.ico

audio/bpm/voice.mp3
audio/wwv/output.mp3
audio/wwv/h_ident.mp3
audio/wwv/v_ident.mp3
audio/wwv/sprite.js

dseg7-classic-400-normal.woff2
dseg7-classic-400-normal.woff
dseg7-classic-700-normal.woff2
dseg7-classic-700-normal.woff
dseg7-classic-mini-400-normal.woff2
dseg7-classic-mini-400-normal.woff
dseg7-classic-mini-700-normal.woff2
dseg7-classic-mini-700-normal.woff

THIRD_PARTY_WWV_LICENSE.txt
DSEG7-LICENSE.txt
DSEG7-MINI-LICENSE.txt
```

Tests and Markdown documentation are not required in the static deployment.
There is no build step for the committed runtime files.

## Backend

The backend is the companion
[`time-api`](https://github.com/absummmmer/time-api) project; its README
documents API configuration, NTP health, and self-hosting.

No backend URL is embedded in the page. The first `AUTO`, `SYNC` or `DUT1 AUTO`
opens a setup dialog for the Time API base URL. The value is stored in the
browser's `localStorage`; changing the host or clearing site data requires
entering it again.

Requirements:

- the backend must allow the page origin through CORS;
- an HTTPS page cannot call an HTTP backend except localhost;
- a base path prefix is supported;
- pasted `/v1/time`, `/v1/time/ntp` or `/v1/dut1` URLs are normalized to the
  base URL.

The URL can be changed later from the sync audit panel's 🔌 button or with
`?setup=backend`.

## Build-only steps

Only needed when changing Tailwind utility classes:

```bash
npm install
npm run build:css
```

`tailwind.css` is committed and is the file deployed.

## Cache

After updating a deployment, hard-refresh once or version the static asset URLs.
The page loads several separate scripts, so an old cached `index.html` must not
be mixed with a new `app.js` / `core.js` set. Replace the complete runtime set
from one package (or at least `core.js`, `app.js`, `time-sync.js`,
`observability.js` together): a newer script can call functions that do not
exist in an older companion script. If the browser still serves stale files,
verify them in the network panel or append a version query to the script URLs.

## Tests

The test suite is not deployed. To run it locally:

```bash
cd tests
npm install
npm test
```

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
