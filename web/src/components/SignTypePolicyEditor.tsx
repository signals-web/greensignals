// ─── Per-type scoring policy editor — Phase 5 + 5b ────────────────────────
//
// Sits inside Sidebar's TYPES tab, beneath each SignType row. Exposes
// the four policy fields for per-project tuning:
//
//   - capacityPerSide          (Phase 5, generation-time)
//   - anchorsOnly              (Phase 5, generation-time)
//   - maxWalkMinutes           (Phase 5, generation-time)
//   - useShortName             (Phase 5b, render-time — does NOT
//                               affect schedule generation)
//
// Each input shows the *code default* as a placeholder when the field
// is unset on the SignType record — clearing a field returns it to the
// default automatically.
//
// Why expandable: most users won't touch policies day-to-day; the
// defaults are good. Hiding the editor behind a "Policy ▸" disclosure
// keeps the TYPES tab visually quiet, while still surfacing the
// affordance when a designer needs to tune.

import { useState } from 'react';
import {
  DEFAULTS_BY_CODE,
  policyForSignType,
  type SignType,
  type SignTypePolicy,
} from '../platform/index.ts';

interface Props {
  signType: SignType;
  /** Persist the updated SignType. The second arg is true when one of
   *  the policy fields actually changed; the parent uses it to decide
   *  whether to prompt for re-generation of affected signs. */
  onUpdate: (next: SignType, policyChanged: boolean) => Promise<void> | void;
}

/** Diff a pair of SignTypes by the *generation-time* policy fields.
 *  Used to decide whether the parent should surface a regenerate
 *  prompt. `useShortName` is intentionally excluded — it's a
 *  render-time concern only, so changing it doesn't require
 *  regenerating sign schedules; the next render picks up the new
 *  policy automatically. */
function policyChanged(a: SignType, b: SignType): boolean {
  return (
    a.capacityPerSide !== b.capacityPerSide ||
    a.anchorsOnly !== b.anchorsOnly ||
    a.maxWalkMinutes !== b.maxWalkMinutes
  );
}

/** Coerce a free-form numeric input value back to a typed field. Empty
 *  / non-finite means "fall back to default" (undefined on the record).
 *  Negative or zero is treated as undefined too — those values would
 *  break scoring (e.g. capacity=0 → no rows ever) and the user
 *  probably meant "clear". */
function parseNumericField(raw: string): number | undefined {
  if (raw.trim() === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

export function SignTypePolicyEditor({ signType, onUpdate }: Props) {
  const [open, setOpen] = useState(false);
  // Resolved policy — what the algorithm *actually* sees for this
  // SignType right now. Used for placeholder text on each input so
  // the user knows what value is currently in effect.
  const resolved: SignTypePolicy = policyForSignType(signType);
  // Code-based defaults — what the field falls back to when cleared.
  // Surfaces as the placeholder hint: "(default: N)".
  const codeDefault = DEFAULTS_BY_CODE[signType.code];

  const commit = async (
    next: Partial<
      Pick<
        SignType,
        'capacityPerSide' | 'anchorsOnly' | 'maxWalkMinutes' | 'useShortName'
      >
    >,
  ) => {
    const merged: SignType = { ...signType, ...next };
    await onUpdate(merged, policyChanged(signType, merged));
  };

  return (
    <div className="signtype-policy-editor">
      <button
        type="button"
        className="signtype-policy-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? '▾' : '▸'} Policy
      </button>
      {open && (
        <div className="signtype-policy-fields">
          {/* Capacity per side — empty falls back to code default. */}
          <label className="signtype-policy-field">
            <span className="signtype-policy-label">Capacity per side</span>
            <input
              type="number"
              min={1}
              step={1}
              defaultValue={signType.capacityPerSide ?? ''}
              placeholder={
                codeDefault
                  ? `${codeDefault.capacityPerSide} (default)`
                  : `${resolved.capacityPerSide}`
              }
              onBlur={(e) => {
                const next = parseNumericField(e.target.value);
                if (next !== signType.capacityPerSide) {
                  void commit({ capacityPerSide: next });
                }
              }}
            />
          </label>

          {/* Anchors-only — checkbox plus a tri-state hint that says
              what the code default is when the field is unset. */}
          <label className="signtype-policy-field signtype-policy-checkbox">
            <input
              type="checkbox"
              checked={resolved.anchorsOnly}
              onChange={(e) => {
                // Tri-state: unchecking when the code default is true
                // sets the override to false (explicit). Toggling to
                // match the default returns it to undefined (inherit).
                const wantTrue = e.target.checked;
                const def = codeDefault?.anchorsOnly ?? false;
                const nextValue = wantTrue === def ? undefined : wantTrue;
                if (nextValue !== signType.anchorsOnly) {
                  void commit({ anchorsOnly: nextValue });
                }
              }}
            />
            <span className="signtype-policy-label">
              Anchors only
              {codeDefault && (
                <span className="signtype-policy-hint">
                  {' '}
                  ({codeDefault.anchorsOnly ? 'default: on' : 'default: off'})
                </span>
              )}
            </span>
          </label>

          {/* Max walk minutes — empty falls back to default. The hint
              shows the default in minutes, or "no cap" for Map signs. */}
          <label className="signtype-policy-field">
            <span className="signtype-policy-label">Max walk minutes</span>
            <input
              type="number"
              min={0}
              step={1}
              defaultValue={signType.maxWalkMinutes ?? ''}
              placeholder={
                codeDefault
                  ? codeDefault.maxWalkMinutes !== undefined
                    ? `${codeDefault.maxWalkMinutes} (default)`
                    : 'no cap (default)'
                  : `${resolved.maxWalkMinutes ?? 'no cap'}`
              }
              onBlur={(e) => {
                const next = parseNumericField(e.target.value);
                if (next !== signType.maxWalkMinutes) {
                  void commit({ maxWalkMinutes: next });
                }
              }}
            />
          </label>

          {/* Phase 5b: useShortName — render-time concern. Does NOT
              trigger a regenerate prompt when toggled (next render
              picks up the new policy automatically). Same tri-state
              pattern as anchorsOnly: matching the code default
              clears the override; otherwise stores explicit
              true/false. */}
          <label className="signtype-policy-field signtype-policy-checkbox">
            <input
              type="checkbox"
              checked={resolved.useShortName}
              onChange={(e) => {
                const wantTrue = e.target.checked;
                const def = codeDefault?.useShortName ?? false;
                const nextValue = wantTrue === def ? undefined : wantTrue;
                if (nextValue !== signType.useShortName) {
                  void commit({ useShortName: nextValue });
                }
              }}
            />
            <span className="signtype-policy-label">
              Use short name
              {codeDefault && (
                <span className="signtype-policy-hint">
                  {' '}
                  ({codeDefault.useShortName ? 'default: on' : 'default: off'})
                </span>
              )}
            </span>
          </label>

          <div className="signtype-policy-foot">
            Empty = use default for this type code.
          </div>
        </div>
      )}
    </div>
  );
}
