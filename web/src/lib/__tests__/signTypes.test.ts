// Smoke tests for Signal's sign-type CRUD plumbing.
//
// These exercise the @sosisu/platform alias end-to-end (proves both the
// Vite resolve.alias wiring and the tsconfig.app.json paths entry are in
// sync) and the core list → create → edit → archive flow against the
// in-memory repo. No React tree is mounted — the UI is thin glue on top
// of these primitives, so testing the primitives is what matters.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  blankSignType,
  nextSignCode,
  parseSignType,
  createInMemoryRepos,
  type InMemoryRepos,
  type SignType,
} from '../../platform/index.ts';

describe('signal sign-type crud', () => {
  let repos: InMemoryRepos;
  const projectId = 'proj-1';

  beforeEach(() => {
    repos = createInMemoryRepos();
  });

  it('starts empty', async () => {
    const list = await repos.signTypes.list(projectId);
    expect(list).toEqual([]);
  });

  it('creates a new sign type with an auto-incremented code', async () => {
    const existing = await repos.signTypes.list(projectId);
    const code = nextSignCode(existing, 'D');
    expect(code).toBe('D-01');

    const draft = blankSignType(code);
    draft.name = 'Parking wayfinding';
    draft.category = 'directional';

    const saved = await repos.signTypes.save(projectId, draft);
    expect(saved.id).toBe(draft.id);
    expect(saved.code).toBe('D-01');

    const list = await repos.signTypes.list(projectId);
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe('Parking wayfinding');
  });

  it('next code fills gaps in the sequence', async () => {
    const existing: Pick<SignType, 'code'>[] = [
      { code: 'D-01' },
      { code: 'D-03' },
    ];
    expect(nextSignCode(existing, 'D')).toBe('D-02');
  });

  it('rejects an invalid draft via the shared parser', () => {
    const draft = blankSignType('D-01');
    // Negative dimensions are type-legal but semantically invalid — the
    // shared zod schema uses .nonnegative() to catch this before it hits
    // the repo.
    draft.dimensionsMM = { w: -1, h: 900, d: 50 };
    const result = parseSignType(draft);
    expect(result.ok).toBe(false);
  });

  it('updates an existing sign type via save', async () => {
    const draft = blankSignType('ID-01');
    draft.name = 'Building A';
    const saved = await repos.signTypes.save(projectId, draft);

    const edited = { ...saved, name: 'Building A — West Lobby' };
    const resaved = await repos.signTypes.save(projectId, edited);

    expect(resaved.id).toBe(saved.id);
    expect(resaved.name).toBe('Building A — West Lobby');
    const list = await repos.signTypes.list(projectId);
    expect(list).toHaveLength(1);
  });

  it('archive is a soft delete — record stays, archivedAt is set', async () => {
    const draft = blankSignType('R-01');
    const saved = await repos.signTypes.save(projectId, draft);

    await repos.signTypes.archive(projectId, saved.id);

    const list = await repos.signTypes.list(projectId);
    expect(list).toHaveLength(1);
    expect(list[0]!.archivedAt).toBeTruthy();
  });

  it('subscribe fires the current value immediately, then on changes', async () => {
    const calls: SignType[][] = [];
    const unsub = repos.signTypes.subscribe(projectId, (list) => {
      calls.push(list);
    });

    // Initial fire: empty.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([]);

    await repos.signTypes.save(projectId, blankSignType('D-01'));
    expect(calls).toHaveLength(2);
    expect(calls[1]).toHaveLength(1);

    unsub();

    await repos.signTypes.save(projectId, blankSignType('D-02'));
    // No new call after unsubscribe.
    expect(calls).toHaveLength(2);
  });
});
