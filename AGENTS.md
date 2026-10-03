# AGENTS.md

## Purpose

This repo is a browser reference for Sign in with Orb.
The page uses the browser-site protocol.
The page has no server.
The sign-in client lives in `src/siwo-browser.js`.

## Directory map

- `src/siwo-browser.js` calls the Orb sign-in endpoints.
- `src/App.jsx` renders the sign-in page.
- `src/main.tsx` mounts the page.
- `src/styles.css` styles the page.
- `scripts/siwo-manifest.js` writes the build-time manifest.
- `vite.config.js` registers that plugin.
- `index.html` is the page shell.
- `src/siwo-browser.test.js` tests the client.
- `scripts/siwo-manifest.test.js` tests the manifest plugin.

## Constraints

Tokens stay in React state.
The page writes no cookies and no browser storage.
The production origin serves `/.well-known/orb-siwo.json`.
A production build sets `ORB_SIWO_ORIGIN`.
`bun run dev` shows the UI on localhost.
Localhost sign-in is refused.
Sign-in works on the production origin named in the manifest.
Protocol details stay in `README.md`.

## Commands

Install packages with `bun install`.
`bun run dev` serves the UI at `http://127.0.0.1:5173/`.
`bun test` runs the client and manifest tests.
`bun run build` writes `dist/`.
`bun run preview` serves `dist/`, including the manifest.
