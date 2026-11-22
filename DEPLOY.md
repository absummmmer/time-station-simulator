# Deployment

Serve the project directory over HTTP; `file://` will not work because the
page fetches audio assets and the time API. The server must serve `.js`,
`.css`, `.woff2`, `.woff`, `.mp3`, `.svg` and `.ico` with normal MIME types.

## Required runtime files

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
```

## Licenses only

The deployment bundle includes only these non-runtime files:

```text
THIRD_PARTY_WWV_LICENSE.txt
DSEG7-LICENSE.txt
DSEG7-MINI-LICENSE.txt
```

Repository documentation (`README.md`, `MANUAL.md`, etc.) is intentionally not
part of the deploy bundle.

## Do not deploy

```text
tests/
archive/
wwv-master/
package.json
tailwind.config.cjs
tailwind.input.css
*.pdf
RWM - Wikipedia.mhtml
*.mp3 reference recordings not under audio/
```

## Build-only steps

Only needed when changing utility classes:

```bash
cd time-station-simulator
npm install
npm run build:css
```

The generated `tailwind.css` is already committed and is the file deployed.

## Cache

The internal deployment build stamps the deployed `index.html` with a
content-derived `?v=` value for every CSS/JS reference, so a changed runtime file
automatically invalidates the browser cache without a manual version bump. The
build also mirrors the result to the configured SMB site and verifies every file
by SHA256; use `-SkipSmbMirror` only for a local-only bundle.

When serving a checkout directly (including the public repository), hard-refresh
once after changing the files or configure the web server to send
`Cache-Control: no-cache` for `index.html`. The page loads several separate
scripts, so an old cached `index.html` must not be mixed with a new
`app.js`/`core.js` set.

## Backend

No active backend URL is embedded in the static bundle. The first AUTO, manual
SYNC or DUT1 AUTO opens a small setup dialog that asks for the `time-api` base
URL and stores it in that browser's `localStorage`. The backend must allow the
page origin through CORS; an HTTPS page cannot call an HTTP endpoint except
localhost. A path prefix is supported, and pasted `/v1/time` endpoints are
normalized.

Existing browsers with old settings get a one-time migration prompt that asks
for the new backend address; no old address is prefilled. After that, use the
🔌 button in the sync audit header or `?setup=backend` to change it. The
frontend can still be deployed before or after the `time-api` update; unknown
correction fields simply appear blank until the API returns them. Rebuild the
`time-api` image and keep `NTP_CORRECTION_MODE=first` (or `off`) as described in
`time-api/README.md`. No NAS chrony configuration change is required.
