# orb-qr-login

Minimal Bun + React (Vite) reference for **Sign in with Orb** using the
browser-site protocol, the only web sign-in protocol enabled on Orb MAINNET.

The page:

- starts a sign-in from the browser and shows the QR code Orb returns
- on touch devices, also shows an **Open Orb app** link (a phone cannot scan its own screen)
- polls until the viewer approves in the Orb app, or the code expires (~5 minutes)
- shows the returned account, ID token and access token, and ends the session when the access token expires

Tokens are held only in React state. Nothing is written to cookies or browser storage.

> The legacy `GET /init-sign-in` + `/poll-sign-in` flow this demo used before
> (with `credentials=id|id_access|id_access_refresh`) is disabled on MAINNET
> and answers "Sign in with Orb is temporarily unavailable". So is the
> permissionless `POST /init-sign-in` + `/exchange-sign-in-code` flow. Do not
> copy either.

## How it works

Everything runs in the page (`src/siwo-browser.js`, no dependencies). There is no server.

1. Generate `state` and `codeVerifier` (32 random bytes each, base64url, 43 chars)
   and `codeChallenge = base64url(SHA-256(codeVerifier))`.
2. `POST https://orbapi.xyz/init-site-sign-in` with `{state, codeChallenge}`
   (`mode: "cors"`, `credentials: "omit"`, `cache: "no-store"`, `redirect: "error"`,
   `referrerPolicy: "no-referrer"`, 10 s timeout). The browser's `Origin` header
   identifies the site.
   - `data.phase === "PROVISIONING"`: the first sign-in from a new origin sets the
     site up. The client waits 10 s and retries, up to 6 times. Provisioning can
     take a few minutes; if it is still running, try again later.
   - `data.phase === "READY"`: `session`, `qrCode` (PNG data URL), `deepLink`
     (`orbapp://orb/approve?secret=…`) and `expiresAt`. Every field is validated
     before the QR is shown.
   - `status: "FAILED"` ("Site sign-in is unavailable…"): the manifest below is
     missing or wrong for this origin.
3. `POST https://orbapi.xyz/poll-site-sign-in` with `{session, state, codeVerifier}`
   every 2.5 s until `expiresAt`. Network errors, 5xx and 429 are retried; a
   `FAILED` answer stops. `processed: true` returns `source: "lens"`, `user_id`,
   `idToken` and `accessToken`. No refresh token is ever issued; a response
   carrying one is rejected.

### Why it runs in the browser

The backend rate-limits per **client IP**: 12 inits and 120 polls a minute per
IP, and 30 polls a minute per session. A server proxy would put every viewer
behind one shared address and get refused. Keep these calls in the page.

### Session lifetime

The access token lives about **10 minutes** and cannot be refreshed. The page
reads the token's `exp` and signs the viewer out when it passes (re-checked
when the tab becomes visible again), then offers a new sign-in.

## The opt-in manifest

The backend only issues sign-ins for origins that serve
`GET /.well-known/orb-siwo.json` with HTTP 200, `Content-Type: application/json`,
under 2 KB, and exactly:

```json
{"version":1,"origin":"https://your-exact-origin.example"}
```

`origin` must equal the page's `Origin` exactly: scheme, host and port, no path,
no trailing slash.

This repo generates that file at build time (`scripts/siwo-manifest.js`, a Vite
plugin) into `dist/.well-known/orb-siwo.json`, from:

- `ORB_SIWO_ORIGIN`, e.g. `ORB_SIWO_ORIGIN=https://qr-login.example.com bun run build`, or
- on Vercel, `https://$VERCEL_PROJECT_PRODUCTION_URL` when `ORB_SIWO_ORIGIN` is unset.

A malformed origin fails the build. With neither set, the build warns and emits
no manifest, and sign-in is refused. If you host it behind an SPA fallback or
rewrite, make sure `/.well-known/orb-siwo.json` is served as the file and not
answered with `index.html`. If the site has several production domains, pick
one canonical origin (or serve the manifest per Host from an allow-list).

### Content Security Policy

This demo sets no CSP. If your site does, add `https://orbapi.xyz` to `connect-src`.
The QR is a `data:` image, so `img-src` needs `data:`.

### Where sign-in works

- **The production origin named in the manifest only.** Preview deployments on
  other origins (e.g. per-branch Vercel URLs) cannot sign in: their `Origin`
  does not match the manifest.
- **Not on localhost.** The backend cannot fetch a manifest from
  `http://localhost` or `127.0.0.1`, so `bun run dev` renders the UI but
  `init-site-sign-in` is refused. To try the full flow, deploy the build to an
  https origin you control with `ORB_SIWO_ORIGIN` set to it. (Orb also has a
  separate local-loopback onboarding flow for localhost development; this demo
  does not implement it.)

## Requirements

- Bun
- The Orb app, to scan the QR or open the approval link

## Install, run, test, build

```bash
bun install
bun run dev        # http://127.0.0.1:5173/ (UI only; see "Where sign-in works")
bun test           # client and manifest tests
ORB_SIWO_ORIGIN=https://your-origin.example bun run build
bun run preview    # serves dist/, including /.well-known/orb-siwo.json
```

## Project shape

- `src/siwo-browser.js`: browser-site sign-in client (copy this into your site)
- `src/App.jsx`: sign-in UI, Open Orb app on touch, session expiry
- `scripts/siwo-manifest.js`: build-time `/.well-known/orb-siwo.json`
- `vite.config.js`: registers the manifest plugin
- `src/main.tsx`, `src/styles.css`, `index.html`: entry, styling, HTML

Generated output such as `dist` and installed dependencies such as `node_modules` are ignored.
