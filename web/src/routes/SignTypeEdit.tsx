import { useEffect, useState, useCallback, type FormEvent } from 'react';
import { getRepos } from '../lib/repo.ts';
import {
  blankSignType,
  buildHandoffUrl,
  nextSignCode,
  parseSignType,
  type SignCategory,
  type MountType,
  type SignType,
  type LineSpec,
} from '../platform/index.ts';

// Dev-time targets for the three apps. Override via Vite env (`VITE_SURFACE_URL`,
// `VITE_SOLID_URL`) when running preview builds or pointing at a deployed
// environment. Ports are pinned in each app's vite.config.ts.
const SURFACE_URL =
  (import.meta.env.VITE_SURFACE_URL as string | undefined) ??
  'http://localhost:5174';
const SOLID_URL =
  (import.meta.env.VITE_SOLID_URL as string | undefined) ??
  'http://localhost:5175';

interface Props {
  projectId: string;
  /** null = create mode, string = edit existing */
  signTypeId: string | null;
  onDone: () => void;
}

const CATEGORIES: SignCategory[] = [
  'identification',
  'directional',
  'regulatory',
  'informational',
];

const MOUNT_TYPES: MountType[] = [
  'ground',
  'wall',
  'ceiling',
  'post',
  'freestanding',
  'overhead',
];

/** Pick an appropriate code prefix from the category so "+ New sign type"
 *  yields ID-01 / D-01 / R-01 / I-01 rather than a generic ST-01. */
function prefixFor(category: SignCategory): string {
  switch (category) {
    case 'identification':
      return 'ID';
    case 'directional':
      return 'D';
    case 'regulatory':
      return 'R';
    case 'informational':
      return 'I';
  }
}

export function SignTypeEdit({ projectId, signTypeId, onDone }: Props) {
  const repos = getRepos();
  const [draft, setDraft] = useState<SignType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (signTypeId) {
        const existing = await repos.signTypes.get(projectId, signTypeId);
        if (!cancelled && existing) setDraft(existing);
        return;
      }
      // Create mode: build a blank with auto-incremented code.
      const all = await repos.signTypes.list(projectId);
      const category: SignCategory = 'directional';
      const code = nextSignCode(all, prefixFor(category));
      const fresh = blankSignType(code);
      fresh.category = category;
      if (!cancelled) setDraft(fresh);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, signTypeId, repos]);

  // All hooks must be above the early return to satisfy Rules of Hooks.
  const moveCopyLine = useCallback((index: number, direction: -1 | 1) => {
    setDraft((d) => {
      if (!d) return d;
      const target = index + direction;
      if (target < 0 || target >= d.copy.length) return d;
      const copy = [...d.copy];
      [copy[index], copy[target]] = [copy[target]!, copy[index]!];
      return { ...d, copy };
    });
  }, []);

  if (!draft) {
    return <div className="empty-state">Loading…</div>;
  }

  function patch(update: Partial<SignType>) {
    setDraft((d) => (d ? { ...d, ...update } : d));
  }

  function patchDims(update: Partial<SignType['dimensionsMM']>) {
    setDraft((d) =>
      d ? { ...d, dimensionsMM: { ...d.dimensionsMM, ...update } } : d,
    );
  }

  // ── Copy line helpers ──

  function patchCopyLine(index: number, update: Partial<LineSpec>) {
    setDraft((d) => {
      if (!d) return d;
      const copy = [...d.copy];
      copy[index] = { ...copy[index]!, ...update };
      return { ...d, copy };
    });
  }

  function addCopyLine() {
    setDraft((d) => {
      if (!d) return d;
      return { ...d, copy: [...d.copy, { text: '', style: 'secondary' as const, alignment: 'left' as const }] };
    });
  }

  function removeCopyLine(index: number) {
    setDraft((d) => {
      if (!d) return d;
      return { ...d, copy: d.copy.filter((_, i) => i !== index) };
    });
  }

  async function handleSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (!draft) return;
    setError(null);
    // Run the shared parser first so the UI reports the same issues Firestore
    // rules will reject on. Repo.save() validates again server-side.
    const parsed = parseSignType(draft);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setSaving(true);
    try {
      await repos.signTypes.save(projectId, parsed.value);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  function handleOpenInSurface() {
    openInTarget(SURFACE_URL);
  }

  function handleOpenInSolid() {
    if (!draft || !signTypeId) return;
    // Canonical "jump to existing type": when this record is already linked
    // to a Solid type via solidTypeId, we don't want to rebuild a fresh
    // handoff envelope (that would cause Solid to synthesize a throwaway
    // single-type project and clobber the user's working project). Instead
    // emit ?viewType=<id> so Solid's bootstrap can select the existing
    // persisted type in place. If the record isn't linked yet, fall back
    // to the legacy handoff-envelope path so first-time "Open in Solid"
    // still works as a seed.
    getRepos()
      .signTypes.get(projectId, signTypeId)
      .then((stored) => {
        if (!stored) return;
        const url = stored.solidTypeId
          ? `${SOLID_URL}/?viewType=${encodeURIComponent(stored.solidTypeId)}`
          : buildHandoffUrl(SOLID_URL, stored, projectId);
        window.open(url, 'sosisu-solid');
      });
  }

  function openInTarget(targetOrigin: string) {
    if (!draft || !signTypeId) return;
    // Only offer the handoff once the draft has been saved at least once —
    // otherwise the target app would receive unsaved edits the user may
    // intend to discard. We read the canonical stored record from the repo
    // rather than the in-memory draft so the URL always reflects what was
    // last persisted.
    getRepos()
      .signTypes.get(projectId, signTypeId)
      .then((stored) => {
        if (!stored) return;
        const url = buildHandoffUrl(targetOrigin, stored, projectId);
        window.open(url, 'sosisu-surface');
      });
  }

  async function handleArchive() {
    if (!draft || !signTypeId) return;
    if (!confirm(`Archive sign type ${draft.code}?`)) return;
    setSaving(true);
    try {
      await repos.signTypes.archive(projectId, signTypeId);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <form className="sign-form" onSubmit={handleSubmit}>
      {/* Upstream link indicator — set when this record was seeded via a
          Solid → Signal handoff. The solidTypeId is the reference to the
          authoritative parametric type in Solid; we surface it here so
          users understand that form/dimensions are owned upstream and
          shouldn't be freely edited here (Signal owns location + copy).
          Canonical data flow: Solid → Signal → Surface. */}
      {draft.solidTypeId && (
        <div className="upstream-link" title="This sign type's form and dimensions are defined in Solid. Edit geometry there; use this form for category, copy, and messaging.">
          <span className="upstream-link__label">Linked to Solid type</span>
          <code className="upstream-link__id">{draft.solidTypeId}</code>
        </div>
      )}
      <div className="row">
        <label>
          Code
          <input
            type="text"
            value={draft.code}
            onChange={(e) => patch({ code: e.target.value })}
            required
          />
        </label>
        <label style={{ gridColumn: 'span 2' }}>
          Name
          <input
            type="text"
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="e.g. Main entry identification"
          />
        </label>
      </div>

      <div className="row">
        <label>
          Category
          <select
            value={draft.category}
            onChange={(e) => patch({ category: e.target.value as SignCategory })}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label>
          Mount type
          <select
            value={draft.mountType}
            onChange={(e) => patch({ mountType: e.target.value as MountType })}
          >
            {MOUNT_TYPES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="row">
        <label>
          Width (mm)
          <input
            type="number"
            min={0}
            value={draft.dimensionsMM.w}
            onChange={(e) => patchDims({ w: Number(e.target.value) })}
            required
          />
        </label>
        <label>
          Height (mm)
          <input
            type="number"
            min={0}
            value={draft.dimensionsMM.h}
            onChange={(e) => patchDims({ h: Number(e.target.value) })}
            required
          />
        </label>
        <label>
          Depth (mm)
          <input
            type="number"
            min={0}
            value={draft.dimensionsMM.d ?? ''}
            onChange={(e) =>
              patchDims({
                d: e.target.value === '' ? undefined : Number(e.target.value),
              })
            }
          />
        </label>
      </div>

      {/* ── Copy / Messaging ── */}
      <fieldset className="copy-editor">
        <legend>Copy / Messaging</legend>
        {draft.copy.length === 0 && (
          <div className="copy-empty">No copy lines yet. Add one below.</div>
        )}
        {draft.copy.map((line, i) => (
          <div key={i} className="copy-line">
            <div className="copy-line__reorder">
              <button
                type="button"
                className="copy-btn"
                disabled={i === 0}
                onClick={() => moveCopyLine(i, -1)}
                title="Move up"
              >
                ↑
              </button>
              <button
                type="button"
                className="copy-btn"
                disabled={i === draft.copy.length - 1}
                onClick={() => moveCopyLine(i, 1)}
                title="Move down"
              >
                ↓
              </button>
            </div>
            <input
              type="text"
              className="copy-line__text"
              value={line.text}
              onChange={(e) => patchCopyLine(i, { text: e.target.value })}
              placeholder="Sign copy text…"
            />
            <select
              className="copy-line__style"
              value={line.style ?? 'secondary'}
              onChange={(e) =>
                patchCopyLine(i, {
                  style: e.target.value as LineSpec['style'],
                })
              }
            >
              <option value="primary">Primary</option>
              <option value="secondary">Secondary</option>
              <option value="caption">Caption</option>
              <option value="ada">ADA</option>
            </select>
            <select
              className="copy-line__align"
              value={line.alignment ?? 'left'}
              onChange={(e) =>
                patchCopyLine(i, {
                  alignment: e.target.value as LineSpec['alignment'],
                })
              }
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
            <button
              type="button"
              className="copy-btn copy-btn--remove"
              onClick={() => removeCopyLine(i)}
              title="Remove line"
            >
              ×
            </button>
          </div>
        ))}
        <button type="button" className="copy-add" onClick={addCopyLine}>
          + Add line
        </button>
      </fieldset>

      {/* ── Materials ── */}
      {draft.materials.length > 0 && (
        <fieldset className="materials-section">
          <legend>Materials</legend>
          {draft.materials.map((mat) => (
            <div key={mat.id} className="material-row">
              <span className="material-label">{mat.label}</span>
              <span className="material-spec">{mat.spec}</span>
            </div>
          ))}
        </fieldset>
      )}

      {error && <div className="error">{error}</div>}

      <div className="actions">
        <button type="button" onClick={onDone} disabled={saving}>
          Cancel
        </button>
        {signTypeId && (
          <button
            type="button"
            className="danger"
            onClick={handleArchive}
            disabled={saving}
          >
            Archive
          </button>
        )}
        {signTypeId && (
          <button
            type="button"
            onClick={handleOpenInSurface}
            disabled={saving}
            title="Open this sign type in Surface to lay out artwork"
          >
            Open in Surface ↗
          </button>
        )}
        {signTypeId && (
          <button
            type="button"
            onClick={handleOpenInSolid}
            disabled={saving}
            title={
              draft.solidTypeId
                ? `Jump to the linked Solid type (${draft.solidTypeId}) for its parametric 3D model`
                : 'Open this sign type in Solid for a 3D preview'
            }
          >
            Open in Solid ↗
          </button>
        )}
        <button type="submit" className="primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
