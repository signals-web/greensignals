# SOSISU Signal (v2)

Sign program authoring + review tool for wayfinding projects. Part of the
SOSISU suite — lives next to Solid (3D) and Surface (artwork) in the
workspace at `code/`.

## Local dev

From the workspace root (`code/`), install once:

```bash
npm install
```

Then start Signal on port 5173:

```bash
npm run dev --workspace signal/web
```

Open <http://localhost:5173>.

### Environment

Copy `.env.example` to `.env.local` and fill in what you need. Everything
except `VITE_MAPTILER_KEY` has a working fallback, so you can run a
UI-only session with no real Firebase project.

| Var                       | Purpose                                                              |
| ------------------------- | -------------------------------------------------------------------- |
| `VITE_FIREBASE_CONFIG`    | JSON-stringified Firebase app config. Unset = localStorage demo mode |
| `VITE_FIREBASE_EMULATOR`  | `true` to route Auth + Firestore at the local emulators              |
| `VITE_MAPTILER_KEY`       | MapTiler API key for basemaps + geocoding                            |
| `VITE_SOLID_URL`          | Override dev handoff target for Solid (default `:5175`)              |
| `VITE_SURFACE_URL`        | Override dev handoff target for Surface (default `:5174`)            |

### Firebase emulators

Emulator ports are configured in [code/firebase.json](../../firebase.json):

- Auth — 9099
- Firestore — 8080
- Storage — 9199
- UI — <http://localhost:4000>

Start them from `code/`:

```bash
npx firebase emulators:start
```

Then set `VITE_FIREBASE_EMULATOR=true` and a placeholder
`VITE_FIREBASE_CONFIG` in `.env.local` to connect Signal to them.

### Firestore rules

Authoritative rules live at [code/firestore.rules](../../firestore.rules).
They enforce a member-based RBAC (owner / editor / reviewer / viewer)
defined in `@sosisu/platform/auth`. Deploy with
`npx firebase deploy --only firestore:rules` from `code/`.

## Scripts

- `npm run dev` — Vite dev server (HMR)
- `npm run build` — `tsc -b` + production bundle to `dist/`
- `npm run preview` — serve `dist/` on the dev port
- `npm run typecheck` — `tsc -b --noEmit`
- `npm run test` — Vitest

## Platform dependency

Signal imports models, Firestore repos, auth clients, and cross-app
handoff from `@sosisu/platform` (sibling workspace at `code/platform/`).
The Vite alias in [vite.config.ts](vite.config.ts) points directly at
`platform/src/`, so editing files in the platform package shows up with
HMR — no build step needed during dev.

Relevant subpaths:

- `@sosisu/platform/models` — `SignType`, `SignInstance`, `SosisuProject`, …
- `@sosisu/platform/firebase` — repo factories, path constants, init helpers
- `@sosisu/platform/auth` — `AuthClient`, role helpers
- `@sosisu/platform/handoff` — Solid → Signal URL encoding
- `@sosisu/platform/scoring` — Phase 3 destination scoring (stub only today)

## Legacy Signal v1

The vanilla-JS Signal app that currently serves CU Boulder still lives at
`code/signal/` (alongside this `web/` subdirectory) and deploys to Vercel
from there. Do not edit v1 files while building v2 unless you're
shipping a fix for CU Boulder — that deployment is live.
