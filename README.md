# orb-qr-login

Minimal Bun + React demo for Orb QR login using `@orbclub/modules`.

The app shows the smallest useful QR-login flow:

- choose which Orb credentials to request
- generate an Orb QR login request
- scan or open the QR approval link in Orb
- display only the credential fields requested by the selected scope

## Credential Scopes

The default request is `credentials=id`, which asks Orb for an ID token only.

Available options:

- `id`: ID token only
- `id_access`: ID token plus access token
- `id_access_refresh`: ID token plus access and refresh tokens

The demo does not persist returned tokens to browser storage. They are held only in React state for display.

## Requirements

- Bun
- Orb app for scanning or opening the login approval link

## Install

```bash
bun install
```

## Run

```bash
bun run dev
```

Open:

```text
http://127.0.0.1:5173/
```

## Build

```bash
bun run build
```

## Project Shape

This repo is intentionally minimal:

- `src/App.jsx`: QR login UI and flow
- `src/main.tsx`: React entrypoint
- `src/styles.css`: app styling
- `index.html`: Vite HTML entry
- `package.json`: Bun/Vite scripts and dependencies

Generated output such as `dist` and installed dependencies such as `node_modules` are ignored.
