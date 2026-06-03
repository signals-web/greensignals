# SOSISU Signal

## Project overview
Sign messaging review tool for university wayfinding projects (CU Boulder, Harvard). Part of the SOSISU platform (sosisu.app). Built by Send Out Signals.

## Stack
- Vanilla JS — no framework, no bundler, no build step (except env.js injection)
- HTML: index.html (shell), config.js, app.js, sheets.js, firebase.js, style.css
- Maps: MapLibre GL JS + MapTiler tiles (streets-v2-light/dark)
- Backend: Firebase RTDB (activity feed + comments), CSV import (sign data). Google Sheets integration deprecated 2026-04-09.
- Deploy: Vercel, auto-deploys on push to main

## Architecture
- Multi-project via projects.json — URL param `?project=cuboulder` selects config
- Admin (`?admin=true`): CSV upload, full edit capabilities
- Reviewer (no admin param): data loaded from internal DB, read-only review
- Secrets: Vercel env vars → build.sh generates env.js at deploy time (gitignored)
- Required env vars: FIREBASE_*, MAPTILER_KEY
- Session persistence: localStorage + Firebase RTDB (source of truth)

## Key files
- `app.js` — state, rendering, sign card, map, CSV parsing, all UI logic, comment UI
- `sheets.js` — DEPRECATED: Google Sheets integration disabled (USE_LEGACY_SHEETS flag), provides no-op stubs
- `config.js` — project picker, branding, admin/reviewer routing, load screen UI
- `firebase.js` — Firebase RTDB for activity feed, reviewer identity, and per-sign comments
- `style.css` — all styles, light/dark mode, responsive layout
- `projects.json` — project configs (branding, Firebase paths). Sheet IDs/OAuth moved to _deprecated_ keys.
- `build.sh` — generates env.js from Vercel env vars at deploy time
- `env.example.js` — template for local dev (copy to env.js, fill in values)

## GCP / API keys
- Google Sheets integration deprecated (2026-04-09). No Sheets API key needed.
- Legacy sheet IDs preserved in projects.json under _deprecated_ keys for reference.
- Firebase config is the only required external service config.

## Conventions
- No frameworks or abstractions — keep it vanilla JS
- CSS variables for theming (--cu-gold, --cu-dark, etc.)
- Functions are plain, globally scoped — no modules
- Commit style: `feat:`, `fix:`, lowercase, concise

## Sign card UI rules
- Arrows: 14px SVGs in 60px column, centered between edge and destination text
- Same-direction destinations sorted together, arrow shown on every row (no rowspan)
- Side A/B columns have darker background tint (rgba .06 dark, .04 light) with extra padding
- Facing direction picker sits at the bottom of the header-left (margin-top: auto)
- Map: hide all POI/landmark icons (whitelist approach — keep roads, places, buildings only)
- Map lines: dashed, inserted before first symbol layer for correct z-order

## Comment / discussion system
- Per-sign comment thread below the actions bar, collapsible
- Red-tinted UI (flag-bg background, flag-red text and borders)
- Firebase path: `projects/{projectPath}/comments/{signId}/`
- Each comment: `{ text, author, ts, resolved? }`
- Actions: resolve (dims + strikethrough, can reopen), delete (permanent)
- Comment count badge shows only unresolved comments
- Real-time sync — all reviewers see comments instantly via Firebase onValue listener
- Requires reviewer name before posting (same requireReviewer gate as approve/flag)

## Firebase data structure
```
projects/{projectPath}/
  activity/        — action log entries { signId, action, reviewer, ts }
  signState/{id}/  — per-sign state { id, status, notes, dests, reviewedBy, updatedAt }
  comments/{id}/   — per-sign comment threads { text, author, ts, resolved }
```

## Auth flows
- **Admin** (`?admin=true`): sees CSV upload interface, full edit capabilities
- **Reviewer** (default): data loaded from internal database, read-only review mode
- Both paths require setting a reviewer name (stored in localStorage) before any action
- All actions (approve, flag, edit) sync to Firebase RTDB in real-time for multi-user visibility

## Platform integration
Signal is part of the SOSISU platform. Solid defines sign geometry and zones → Signal populates zones with scored content → Surface renders content as production artwork. Signal's approved destinations flow into Surface for sign face layout.

## Current state (2026-04-09)
- CU Boulder project active with 119 signs, 5 reviewers using it live
- Comment system deployed and in use
- Harvard project configured but not yet active
- Light/dark mode working with MapTiler tile style switching
- Google Sheets integration fully deprecated — all data via internal DB + CSV import
