import { useEffect, useState } from 'react';
import { SignTypeList } from './routes/SignTypeList.tsx';
import { SignTypeEdit } from './routes/SignTypeEdit.tsx';
import { ensureDemoProject, getRepos } from './lib/repo.ts';
import {
  HANDOFF_FROM_SOLID_QUERY_PARAM,
  readSolidHandoffFromLocation,
  type SosisuProject,
} from './platform/index.ts';

// Minimal internal router. Signal's CRUD only needs list ↔ edit, so a
// proper routing library is deferred until Tasks 3/4 wire the Signal →
// Surface / Signal → Solid handoff routes.
type Route =
  | { kind: 'list' }
  | { kind: 'edit'; signTypeId: string | null /* null = new */ };

export function App() {
  const [project, setProject] = useState<SosisuProject | null>(null);
  const [route, setRoute] = useState<Route>({ kind: 'list' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const proj = await ensureDemoProject();
      if (cancelled) return;

      // Canonical Solid → Signal handoff: Solid encodes a parametric SignType
      // into a `?fromSolid=` envelope and opens Signal in a new tab. We
      // decode, check for an existing record linked to the same Solid type,
      // and either merge fresh dimensions into it or create a new record.
      //
      // Dedup: if a SignType with the same `solidTypeId` already exists, we
      // update its geometry-related fields (dimensionsMM, mountType) from the
      // incoming handoff but preserve Signal-owned fields (code, name,
      // category, copy, materials) so the user's messaging edits survive.
      // This means clicking "Open in Signal" from Solid after editing dims
      // does the right thing — dimensions sync, copy stays.
      //
      // Schema / envelope failures fall through to the normal list view —
      // a broken URL shouldn't lock the app.
      try {
        const handoff = readSolidHandoffFromLocation();
        if (handoff && handoff.ok) {
          const { signType: inbound } = handoff.value;
          const repos = getRepos();

          // Check for an existing record linked to this Solid type.
          const existing = inbound.solidTypeId
            ? await repos.signTypes.findBySolidTypeId(proj.id, inbound.solidTypeId)
            : null;

          let targetId: string;
          if (existing) {
            // Merge: update geometry from Solid, keep Signal-owned fields.
            const merged = {
              ...existing,
              dimensionsMM: inbound.dimensionsMM,
              mountType: inbound.mountType,
              updatedAt: new Date().toISOString(),
            };
            await repos.signTypes.save(proj.id, merged);
            targetId = existing.id;
          } else {
            // First handoff of this Solid type — save as new.
            await repos.signTypes.save(proj.id, inbound);
            targetId = inbound.id;
          }

          const url = new URL(window.location.href);
          url.searchParams.delete(HANDOFF_FROM_SOLID_QUERY_PARAM);
          window.history.replaceState({}, '', url.toString());
          setProject(proj);
          setRoute({ kind: 'edit', signTypeId: targetId });
          return;
        }
      } catch (err) {
        // Structural decode error (base64 garbage, bad envelope). Log and
        // fall through — the user still gets a working app.
        console.warn('[signal] fromSolid handoff failed to decode', err);
      }

      setProject(proj);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>SOSISU Signal</h1>
        {project && (
          <span className="project-meta">
            {project.name} · {project.client || 'no client'}
          </span>
        )}
      </header>
      <main className="app-body">
        {!project ? (
          <div className="empty-state">Loading project…</div>
        ) : route.kind === 'list' ? (
          <SignTypeList
            projectId={project.id}
            onCreate={() => setRoute({ kind: 'edit', signTypeId: null })}
            onEdit={(signTypeId) => setRoute({ kind: 'edit', signTypeId })}
          />
        ) : (
          <SignTypeEdit
            projectId={project.id}
            signTypeId={route.signTypeId}
            onDone={() => setRoute({ kind: 'list' })}
          />
        )}
      </main>
    </div>
  );
}
