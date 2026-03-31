# GreenSignals

## Project overview
Sign messaging review tool for university wayfinding projects (CU Boulder, Harvard). Built by SIGNALS Studio. Live at greensignals.vercel.app.

## Stack
- Vanilla JS — no framework, no bundler, no build step (except env.js injection)
- HTML: index.html (shell), config.js, app.js, sheets.js, firebase.js, style.css
- Maps: MapLibre GL JS + MapTiler tiles (streets-v2-light/dark)
- Backend: Google Sheets (source of truth), Firebase Realtime DB (activity feed + comments)
- Deploy: Vercel, auto-deploys on push to main
- Repo: signals-web/greensignals

## Architecture
- Multi-project via projects.json — URL param `?project=cuboulder` selects config
- Admin (`?admin=true`): Google OAuth, read/write to Sheets
- Reviewer (no admin param): API key read-only from Sheets, no Google login needed
- Secrets: Vercel env vars → build.sh generates env.js at deploy time (gitignored)
- Required env vars: FIREBASE_*, MAPTILER_KEY, SHEETS_API_KEY
- Session persistence: localStorage (convenience), Sheets is source of truth

## Key files
- `app.js` — state, rendering, sign card, map, CSV parsing, all UI logic, comment UI
- `sheets.js` — Google Sheets OAuth (admin) + public read (reviewer), sync functions
- `config.js` — project picker, branding, admin/reviewer routing, load screen UI
- `firebase.js` — Firebase RTDB for activity feed, reviewer identity, and per-sign comments
- `style.css` — all styles, light/dark mode, responsive layout
- `projects.json` — project configs (sheet IDs, branding, OAuth client IDs)
- `build.sh` — generates env.js from Vercel env vars at deploy time
- `env.example.js` — template for local dev (copy to env.js, fill in values)

## GCP / API keys
- API key for Sheets public read must be from the **greensignals** GCP project (greensignals-490611)
- Do NOT use the cub-sign-review GCP project for API keys — it has a blocking issue
- The Sheets API must be enabled in the same GCP project as the key
- OAuth client ID (for admin) is in projects.json per-project

## Conventions
- No frameworks or abstractions — keep it vanilla JS
- CSS variables for theming (--cu-gold, --cu-dark, etc.)
- Functions are plain, globally scoped — no modules
- Commit style: `feat:`, `fix:`, lowercase, concise
- Push to `claude/gracious-newton` branch, create PR, squash merge to main
- Always rebase on origin/main before pushing to avoid merge conflicts

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
- **Admin** (`?admin=true`): sees Google Sheets connect button + CSV upload, OAuth for read/write
- **Reviewer** (default): auto-loads data via Sheets API key (no login), read-only from Sheets
- Both paths require setting a reviewer name (stored in localStorage) before any action
- Reviewer actions (approve, flag, edit) sync to Firebase in real-time for multi-user visibility
- Admin actions additionally sync back to Google Sheets via OAuth

## Current state (2026-03-31)
- CU Boulder project active with 119 signs, 5 reviewers using it live
- Comment system deployed and in use (Stacy, Richelle actively commenting)
- Harvard project configured but not yet active
- Light/dark mode working with MapTiler tile style switching
