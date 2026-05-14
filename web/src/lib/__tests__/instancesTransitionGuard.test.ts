// Stage 0.3 Commit 1 — approval transition guardrails.
//
// `updateInstance` in lib/instances.ts now routes any `reviewStatus`
// change through canonical's `isValidTransition` validator. Valid
// transitions persist as before; invalid transitions are rejected
// with a console warning and the function returns `undefined`.
//
// Today's UI flows (SignCard.tsx:645/652/739 → approved / flagged /
// edited) all dispatch transitions canonical allows from every state,
// so the wrap is additive enforcement — these tests pin the guard
// behavior so a future canonical change can't silently break Signal,
// and a future Signal change can't silently regress allowed
// transitions.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SignInstance } from '../../platform/index.ts';

class LocalStorageShim implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

const shim = new LocalStorageShim();
(globalThis as { localStorage?: Storage }).localStorage = shim;

const {
  setInstances,
  updateInstance,
  getInstance,
  resetInstances,
} = await import('../instances.ts');

function makeInstance(
  id: string,
  reviewStatus: SignInstance['reviewStatus'],
): SignInstance {
  const now = new Date().toISOString();
  return {
    id,
    signTypeId: 'st-1',
    location: 'Test',
    sides: [],
    reviewStatus,
    createdAt: now,
    updatedAt: now,
  };
}

describe('updateInstance — approval transition guard', () => {
  beforeEach(() => {
    shim.clear();
    resetInstances();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Allowed transitions — Signal's three live call sites ────────

  it('allows pending → approved (SignCard.tsx:645 approve action)', () => {
    setInstances([makeInstance('i-1', 'pending')]);
    const result = updateInstance('i-1', { reviewStatus: 'approved' });
    expect(result).toBeDefined();
    expect(getInstance('i-1')!.reviewStatus).toBe('approved');
  });

  it('allows pending → flagged (SignCard.tsx:652 flag action)', () => {
    setInstances([makeInstance('i-2', 'pending')]);
    const result = updateInstance('i-2', { reviewStatus: 'flagged' });
    expect(result).toBeDefined();
    expect(getInstance('i-2')!.reviewStatus).toBe('flagged');
  });

  it('allows approved → edited (SignCard.tsx:739 save-edits-on-approved)', () => {
    setInstances([makeInstance('i-3', 'approved')]);
    const result = updateInstance('i-3', { reviewStatus: 'edited' });
    expect(result).toBeDefined();
    expect(getInstance('i-3')!.reviewStatus).toBe('edited');
  });

  it('allows edited → approved (re-approval)', () => {
    setInstances([makeInstance('i-4', 'edited')]);
    const result = updateInstance('i-4', { reviewStatus: 'approved' });
    expect(result).toBeDefined();
    expect(getInstance('i-4')!.reviewStatus).toBe('approved');
  });

  it('allows self-transitions (no-op state assertion)', () => {
    setInstances([makeInstance('i-5', 'approved')]);
    const result = updateInstance('i-5', { reviewStatus: 'approved' });
    expect(result).toBeDefined();
    expect(getInstance('i-5')!.reviewStatus).toBe('approved');
  });

  // ─── Rejected transitions — canonical-forbidden paths ────────────

  it('rejects approved → pending (must un-lock via edit first per canonical)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setInstances([makeInstance('i-6', 'approved')]);
    const result = updateInstance('i-6', { reviewStatus: 'pending' });
    expect(result).toBeUndefined();
    expect(getInstance('i-6')!.reviewStatus).toBe('approved'); // unchanged
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toMatch(/approved -> pending/);
  });

  // ─── Non-reviewStatus updates always pass ────────────────────────

  it('allows arbitrary non-status updates regardless of current state', () => {
    setInstances([makeInstance('i-7', 'approved')]);
    const result = updateInstance('i-7', { location: 'Updated location' });
    expect(result).toBeDefined();
    expect(getInstance('i-7')!.location).toBe('Updated location');
    expect(getInstance('i-7')!.reviewStatus).toBe('approved');
  });

  it('allows combined non-status update + valid transition', () => {
    setInstances([makeInstance('i-8', 'pending')]);
    const result = updateInstance('i-8', {
      reviewStatus: 'approved',
      reviewedBy: 'Chris',
    });
    expect(result).toBeDefined();
    expect(getInstance('i-8')!.reviewStatus).toBe('approved');
    expect(getInstance('i-8')!.reviewedBy).toBe('Chris');
  });

  it('rejects combined non-status update + invalid transition (atomic)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setInstances([makeInstance('i-9', 'approved')]);
    const result = updateInstance('i-9', {
      reviewStatus: 'pending',
      reviewedBy: 'Chris',
    });
    expect(result).toBeUndefined();
    // Both fields preserved
    expect(getInstance('i-9')!.reviewStatus).toBe('approved');
    expect(getInstance('i-9')!.reviewedBy).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });
});
