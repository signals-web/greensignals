import { useEffect, useState, type FormEvent } from 'react';
import { getRepos } from '../lib/repo.ts';
import {
  blankSignType,
  buildHandoffUrl,
  nextSignCode,
  parseSignType,
  type SignCategory,
  type MountType,
  type SignType,
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
    openInTarget(SOLID_URL);
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
        window.open(url, '_blank', 'noopener');
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
            title="Open this sign type in Solid for a 3D preview"
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
