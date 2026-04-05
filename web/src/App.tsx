import { useEffect, useState } from 'react';
import { SignTypeList } from './routes/SignTypeList.tsx';
import { SignTypeEdit } from './routes/SignTypeEdit.tsx';
import { ensureDemoProject } from './lib/repo.ts';
import type { SosisuProject } from './platform/index.ts';

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
    ensureDemoProject().then(setProject);
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
