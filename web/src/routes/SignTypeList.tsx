import { useEffect, useState } from 'react';
import { getRepos } from '../lib/repo.ts';
import type { SignType } from '../platform/index.ts';

interface Props {
  projectId: string;
  onCreate: () => void;
  onEdit: (signTypeId: string) => void;
}

function formatDims(w: number, h: number, d?: number): string {
  const base = `${w} × ${h}`;
  return d ? `${base} × ${d}` : base;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function SignTypeList({ projectId, onCreate, onEdit }: Props) {
  const [signTypes, setSignTypes] = useState<SignType[]>([]);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    // Live subscription — fires synchronously with current value, then on
    // every save/archive. Unsubscribe on unmount.
    const unsub = getRepos().signTypes.subscribe(projectId, setSignTypes);
    return unsub;
  }, [projectId]);

  const visible = showArchived
    ? signTypes
    : signTypes.filter((t) => !t.archivedAt);

  const sorted = [...visible].sort((a, b) => a.code.localeCompare(b.code));

  return (
    <>
      <div className="toolbar">
        <button className="primary" onClick={onCreate}>
          + New sign type
        </button>
        <div className="spacer" />
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            fontSize: '0.85rem',
            color: '#8a8f96',
          }}
        >
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            style={{ width: 'auto' }}
          />
          Show archived
        </label>
      </div>

      {sorted.length === 0 ? (
        <div className="empty-state">
          No sign types yet. Click <strong>+ New sign type</strong> to create
          one.
        </div>
      ) : (
        <table className="sign-table">
          <thead>
            <tr>
              <th style={{ width: '7rem' }}>Code</th>
              <th>Name</th>
              <th>Copy</th>
              <th style={{ width: '9rem' }}>Category</th>
              <th style={{ width: '9rem' }}>W × H (mm)</th>
              <th style={{ width: '8rem' }}>Updated</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => (
              <tr
                key={t.id}
                className={t.archivedAt ? 'archived' : ''}
                onClick={() => onEdit(t.id)}
              >
                <td className="code">{t.code}</td>
                <td>{t.name || <em style={{ color: '#8a8f96' }}>(unnamed)</em>}</td>
                <td>
                  {t.copy.length > 0 ? (
                    <span className="copy-preview">
                      {t.copy.map((l) => l.text).join(' · ')}
                    </span>
                  ) : (
                    <em style={{ color: '#5a5f66', fontSize: '0.75rem' }}>—</em>
                  )}
                </td>
                <td>{t.category}</td>
                <td>
                  {formatDims(t.dimensionsMM.w, t.dimensionsMM.h, t.dimensionsMM.d)}
                </td>
                <td>{formatTimestamp(t.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
