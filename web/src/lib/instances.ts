/**
 * Instance store — manages SignInstance records for the messaging review.
 *
 * Until the platform gets a dedicated InstancesRepo (analogous to SignTypesRepo),
 * Signal manages instances in localStorage. Starts empty — instances are
 * created by placing signs on the map or via handoff.
 */

import type { ApprovalState, SignInstance } from '../platform/index.ts';
import { isValidTransition } from '../platform/index.ts';

const STORAGE_KEY = 'sosisu:signal:instances:v1';

type Listener = (instances: SignInstance[]) => void;

let _instances: SignInstance[] | null = null;
const _listeners = new Set<Listener>();

function load(): SignInstance[] {
  if (_instances) return _instances;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SignInstance[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        _instances = parsed;
        return _instances;
      }
    }
  } catch {
    // Corrupt data — reseed
  }
  // First boot or corrupt — start empty
  _instances = [];
  persist();
  return _instances;
}

function persist() {
  if (_instances) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_instances));
  }
}

function notify() {
  // Emit a fresh array reference each time so React subscribers (which
  // bail out on `Object.is(prevState, nextState)`) actually re-render.
  // The mutating helpers below (`updateInstance`, `addInstance`,
  // `deleteInstance`) edit `_instances` in place, so without this
  // copy a setState would short-circuit and the UI would lag the
  // persisted store — Chris hit this with the lock toggle:
  // `directionLocked` flipped in localStorage but the padlock icon
  // never re-rendered.
  const current = load();
  const snapshot = [...current];
  for (const cb of _listeners) {
    cb(snapshot);
  }
}

/** Get all instances — INCLUDING soft-deleted (archived) ones. The store
 *  is the full ledger; UI consumers filter `!inst.archivedAt` the same way
 *  App.tsx filters archived sign types from the repo subscription. */
export function getInstances(): SignInstance[] {
  return load();
}

/** Get a single instance by ID. */
export function getInstance(id: string): SignInstance | undefined {
  return load().find((i) => i.id === id);
}

/** Update an instance in place. Returns the updated instance.
 *
 *  Stage 0.3 — approval state transitions route through canonical's
 *  `isValidTransition` validator. When `update.reviewStatus` is set,
 *  the current instance's `reviewStatus` is consulted; if the
 *  transition is not allowed by the canonical state machine
 *  (`platform/canonical/approval.ts`), the update is rejected with a
 *  console warning and the function returns `undefined`.
 *
 *  Today no UI flow dispatches a transition that canonical rejects —
 *  the three call sites in `SignCard.tsx` (approve / flag / save-as-
 *  edited) all map to allowed transitions from every state. The wrap
 *  is purely additive enforcement, catching future regressions or
 *  programmatic mis-use rather than changing current behavior. */
export function updateInstance(
  id: string,
  update: Partial<SignInstance>,
): SignInstance | undefined {
  const instances = load();
  const idx = instances.findIndex((i) => i.id === id);
  if (idx < 0) return undefined;
  // Approval-state guard. Only check when reviewStatus is actually
  // being changed; updates that don't touch reviewStatus are always
  // allowed regardless of current state.
  if (update.reviewStatus !== undefined) {
    const from = instances[idx]!.reviewStatus as ApprovalState;
    const to = update.reviewStatus as ApprovalState;
    if (!isValidTransition(from, to)) {
      console.warn(
        `[instances] rejected invalid approval transition ${from} -> ${to} ` +
          `on instance ${id}. See canonical/approval.ts for the allowed graph.`,
      );
      return undefined;
    }
  }
  instances[idx] = {
    ...instances[idx]!,
    ...update,
    updatedAt: new Date().toISOString(),
  };
  persist();
  notify();
  return instances[idx];
}

/** Subscribe to instance changes. Returns unsubscribe function. */
export function subscribeInstances(cb: Listener): () => void {
  _listeners.add(cb);
  // Fire immediately with current value
  cb(load());
  return () => _listeners.delete(cb);
}

/** Soft-delete a single instance by ID. Sets `archivedAt` (matching the
 *  platform's SignType / DestinationPlace archive semantics) instead of
 *  removing the record, so the ID stays reserved and the record survives
 *  for audit / un-delete tooling. Returns false when the instance doesn't
 *  exist or is already archived. */
export function deleteInstance(id: string): boolean {
  const instances = load();
  const idx = instances.findIndex((i) => i.id === id);
  if (idx < 0) return false;
  if (instances[idx]!.archivedAt) return false;
  const now = new Date().toISOString();
  instances[idx] = { ...instances[idx]!, archivedAt: now, updatedAt: now };
  persist();
  notify();
  return true;
}

/** Clear all instances (fresh start). */
export function resetInstances(): void {
  _instances = [];
  persist();
  notify();
}

/** Wholesale-replace the instance store. Used by the CU Boulder demo seed
 *  to drop in 118 records with deterministic IDs in one shot, bypassing
 *  the per-instance ID generation in `addInstance`. */
export function setInstances(instances: SignInstance[]): void {
  _instances = [...instances];
  persist();
  notify();
}

/** Create a new instance at the given coordinates. Returns the new instance.
 *  Pass `typeCode` (e.g. "MAP", "PED") to generate a readable ID like "MAP-01". */
export function addInstance(
  signTypeId: string,
  lat: number,
  lng: number,
  typeCode?: string,
  extra?: Partial<SignInstance>,
): SignInstance {
  const now = new Date().toISOString();
  const instances = load();
  const prefix = typeCode?.toUpperCase() || 'SIGN';
  // Find the highest existing number for this prefix. Archived instances
  // count too — a soft-deleted MAP-03 keeps its ID reserved so the next
  // placement becomes MAP-04, never a duplicate of the archived record.
  let maxNum = 0;
  for (const inst of instances) {
    const match = inst.id.match(new RegExp(`^${prefix}-(\\d+)$`, 'i'));
    if (match) maxNum = Math.max(maxNum, parseInt(match[1]!, 10));
  }
  const nextNum = String(maxNum + 1).padStart(2, '0');
  const inst: SignInstance = {
    id: `${prefix}-${nextNum}`,
    signTypeId,
    location: '',
    lat,
    lng,
    sides: [],
    reviewStatus: 'pending',
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
  instances.push(inst);
  persist();
  notify();
  return inst;
}
