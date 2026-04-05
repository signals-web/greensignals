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
      // decode, persist a new program-level SignType record (its
      // `solidTypeId` points back at the originating Solid type), strip the
      // query param so a reload doesn't re-import, and drop the user
      // straight into the edit form so they can fill in category / copy.
      // Schema / envelope failures fall through to the normal list view —
      // a broken URL shouldn't lock the app.
      try {
        const handoff = readSolidHandoffFromLocation();
        if (handoff && handoff.ok) {
          const { signType } = handoff.value;
          await getRepos().signTypes.save(proj.id, signType);
          const url = new URL(window.location.href);
          url.searchParams.delete(HANDOFF_FROM_SOLID_QUERY_PARAM);
          window.history.replaceState({}, '', url.toString());
          setProject(proj);
          setRoute({ kind: 'edit', signTypeId: signType.id });
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
