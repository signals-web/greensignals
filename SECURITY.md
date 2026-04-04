# Signal — Security Audit (Sprint 1.6)

## Summary

Signal uses Firebase Realtime Database for multi-reviewer sync (activity feed,
sign state, per-sign comments, building-name overrides). Prior to this sprint,
**no security rules existed in the repository**, meaning the production database
was running on whatever was configured manually in the Firebase console —
with no code review, no version history, and no deployment story.

This audit adds:
- `database.rules.json` — structural validation rules checked into source
- `firebase.json` — so `firebase deploy --only database` works from repo root
- This document — risk model, schema, deploy steps, and follow-ups

## Threat model

Signal is **intentionally auth-less**. Reviewers identify themselves by typing a
display name into a localStorage prompt; there is no Google sign-in, no account
creation, no server-side session. Admin users authenticate separately through
Google Sheets OAuth, but that flow never touches Firebase. As a result,
**every Firebase write is effectively anonymous** — anyone who can load the
site can write anything to the database.

This was a deliberate product decision (low-friction review for guest faculty
and PM consultants) and is not changing in Sprint 1. The audit's goal is not
to gate writes behind auth, but to limit the blast radius of the open-write
design:

| Risk                            | Mitigation in these rules                              |
| ------------------------------- | ------------------------------------------------------ |
| Arbitrary top-level writes      | Root `.write: false`; only `projects/*` is writeable   |
| Unknown sub-tree pollution      | `$otherSubtree.validate: false`                        |
| Schema corruption               | `.validate` on every leaf, `$other.validate: false`    |
| Oversized spam (notes/comments) | String length caps (2000–4000 chars)                   |
| Future-dated timestamps         | `ts <= now + 60000` (60s clock skew tolerance)         |
| Action taxonomy drift           | `activity.action` matched against an explicit regex    |
| Unknown project IDs             | `$projectId.length > 0 && < 64`                        |

Risks **not** mitigated (requires auth or server logic — out of scope):

- **Impersonation**: a reviewer can post under any name. The display name is
  self-declared and never verified.
- **Rate limiting**: Firebase RTDB rules can't limit writes per IP/session. A
  determined attacker can still fill the database up to billing limits.
- **Historical data deletion**: rules allow any writer to overwrite or delete
  `signState` / `comments` entries. We rely on Google Sheets as the source of
  truth for sign data, so Firebase is treated as an ephemeral cache.
- **Project enumeration**: anyone can read any `projects/{id}/*` subtree. This
  is intentional — reviewers need to read without auth — but means project
  IDs should not be treated as secrets.

## Schema (authoritative)

```
projects/{projectId}/
  activity/{entryId}      { signId, action, reviewer, ts }
  signState/{safeId}      { id, status, notes?, dests?, reviewedBy, updatedAt }
  comments/{signId}/{id}  { text, author, ts, resolved? }
  buildingNames/{key}     { originalName, updatedBy, updatedAt, status?, shortName?, notes? }
```

`safeId` is `signId.replace(/[.#$/[\]]/g, '_')` — Firebase RTDB reserves those
characters.

Allowed values for `activity.action`:
`approved | flagged | edited | unflagged | unapproved | commented`

If you add a new action type in `app.js`, update the regex in
`database.rules.json` in the same commit.

## Deploying the rules

First-time setup (one-time per developer):

```
npm install -g firebase-tools
firebase login
firebase use --add          # select the greensignals / cub-sign-review project
```

Deploy after editing rules:

```
cd signal
firebase deploy --only database
```

The CI/CD path (Vercel auto-deploy on push to main) does **not** deploy these
rules — Vercel only ships the static site. Rules must be deployed manually
until someone wires `firebase deploy` into a GitHub Action.

## Follow-ups

These were out of scope for the 2-hour Sprint 1.6 budget but should be picked
up in a future sprint:

1. **Rules unit tests** with `@firebase/rules-unit-testing`. Signal is a
   vanilla-JS project with no build step or npm test harness today; adding
   the emulator + vitest would be its own setup task. A minimal harness
   living in `signal/tests/` that runs against `firebase emulators:exec`
   would verify each validator against both passing and failing fixtures.
2. **GitHub Action** to deploy rules on merge to main, gated on a manual
   approval or a `[deploy-rules]` commit tag.
3. **Periodic snapshot export** of `projects/*/signState` to object storage
   so a malicious overwrite is recoverable. Sheets is the source of truth
   but the Firebase deltas (notes, comments) are not currently backed up.
4. **Monitoring** for write-rate spikes via Firebase usage alerts — the
   current rules limit shape but not volume.

## Verification checklist (manual, until tests land)

After deploying new rules, verify with the Firebase console Rules simulator:

- [ ] Writing `{ text: "x", author: "y", ts: <server>, resolved: false }` to
      `projects/cuboulder/comments/S001/xyz` succeeds.
- [ ] Writing the same comment with `text` longer than 2000 chars is rejected.
- [ ] Writing `{ action: "hacked" }` to `projects/cuboulder/activity/xyz` is
      rejected (not in the action regex).
- [ ] Writing to `projects/cuboulder/newSubtree/x` is rejected.
- [ ] Reading `projects/cuboulder/activity` succeeds anonymously.
- [ ] Writing directly to `/` root is rejected.
