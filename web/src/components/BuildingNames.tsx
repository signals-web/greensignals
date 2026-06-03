// ─── Building Names admin — Phase 5b ──────────────────────────────────────
//
// Tabular admin surface for the project's DestinationPlace records.
// Replaces the v1 standalone localStorage-backed admin (the
// `sosisu:signal:buildingNames` blob) — DestinationPlace is now the
// single source of truth, so editing a building means editing the
// DestinationPlace it represents.
//
// Phase 5b moved anchor editing here (DestinationsPanel now shows a
// read-only ★) and added the `shortName` field. The "Generate short
// names" header button bulk-populates shortNames using the rules-based
// generator ported from the v1 Signal app — opt-in, never overwrites
// existing reviewer edits.
//
// Aliases / status / notes from the v1 admin are deferred. The
// localStorage blob is abandoned (not migrated); reviewers re-enter
// any anchor / shortName / etc. via this UI. Per the Phase 5b spec
// stop-and-flag rules, if migration of v1 RTDB BuildingName data is
// needed it'll be a separate one-shot task.

import { useMemo, useState, useCallback } from 'react';
import type {
  DestinationPlace,
  DestinationTier,
  SignInstance,
} from '../platform/index.ts';
import { suggestShortNames } from '../lib/generateShortNames.ts';

const TIER_LABELS: Record<DestinationTier, string> = {
  campus: 'Campus',
  building: 'Building',
  room: 'Room',
};

interface Props {
  /** Live destination places for the active project. The parent
   *  subscribes to `destinationPlacesRepo` and passes the array down;
   *  every edit persists via `onUpdate`, so this component never
   *  reads/writes localStorage directly. */
  destinations: DestinationPlace[];
  /** Sign instances — used only to count how many signs reference
   *  each destination via `destinationPlaceId`. The "# signs" column
   *  surfaces this count so reviewers can see at a glance which
   *  buildings carry messaging weight. */
  instances: SignInstance[];
  /** Persist a single field-level edit on a DestinationPlace. Parent
   *  forwards the merged record to `destinationPlacesRepo.save`. */
  onUpdate: (dest: DestinationPlace) => Promise<void> | void;
  onClose: () => void;
}

interface Row {
  dest: DestinationPlace;
  signCount: number;
}

export function BuildingNames({
  destinations,
  instances,
  onUpdate,
  onClose,
}: Props) {
  const [search, setSearch] = useState('');
  const [districtFilter, setDistrictFilter] = useState('');
  const [sortCol, setSortCol] = useState<'name' | 'signs'>('signs');
  const [sortAsc, setSortAsc] = useState(false);

  // Live = unarchived. Archived destinations don't belong on this
  // admin surface; reviewers manage archive state from
  // DestinationsPanel.
  const live = useMemo(
    () => destinations.filter((d) => !d.archivedAt),
    [destinations],
  );

  // Sign-count map: how many sign instances reference each
  // destination via destinationPlaceId. Both manual and auto rows
  // count — every reference contributes to the building's "weight"
  // on the project.
  const signCountByDpId = useMemo(() => {
    const map = new Map<string, number>();
    for (const inst of instances) {
      const seenInThisSign = new Set<string>();
      for (const side of inst.sides) {
        for (const row of side.destinations) {
          const id = row.destinationPlaceId;
          if (!id) continue;
          // Count one per sign — multi-side appearances don't double-
          // count the building's weight.
          if (seenInThisSign.has(id)) continue;
          seenInThisSign.add(id);
          map.set(id, (map.get(id) ?? 0) + 1);
        }
      }
    }
    return map;
  }, [instances]);

  const rows: Row[] = useMemo(
    () =>
      live.map((dest) => ({
        dest,
        signCount: signCountByDpId.get(dest.id) ?? 0,
      })),
    [live, signCountByDpId],
  );

  // Districts in use — drives the filter dropdown. Sorted alpha.
  const allDistricts = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      if (r.dest.district) s.add(r.dest.district);
    }
    return [...s].sort();
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) =>
          r.dest.name.toLowerCase().includes(q) ||
          (r.dest.shortName ?? '').toLowerCase().includes(q),
      );
    }
    if (districtFilter) {
      list = list.filter((r) => r.dest.district === districtFilter);
    }
    return [...list].sort((a, b) => {
      if (sortCol === 'name') {
        return sortAsc
          ? a.dest.name.localeCompare(b.dest.name)
          : b.dest.name.localeCompare(a.dest.name);
      }
      return sortAsc ? a.signCount - b.signCount : b.signCount - a.signCount;
    });
  }, [rows, search, districtFilter, sortCol, sortAsc]);

  // Header counts for the stat strip.
  const counts = useMemo(() => {
    let anchors = 0;
    let withShort = 0;
    for (const r of rows) {
      if (r.dest.isAnchor === true) anchors++;
      if (r.dest.shortName && r.dest.shortName.trim() !== '') withShort++;
    }
    return { total: rows.length, anchors, withShort };
  }, [rows]);

  const toggleSort = useCallback((col: 'name' | 'signs') => {
    setSortCol((prev) => {
      if (prev === col) {
        setSortAsc((a) => !a);
        return col;
      }
      setSortAsc(col === 'name');
      return col;
    });
  }, []);

  // ── Per-field edit helpers ─────────────────────────────────────────
  // Each one merges a single field onto a destination and forwards to
  // the parent's persistence callback. The parent rewrites
  // `updatedAt` / `updatedBy` at the repo layer, so callers don't
  // need to touch those.

  const setAnchor = useCallback(
    (dest: DestinationPlace, value: boolean) => {
      void onUpdate({ ...dest, isAnchor: value });
    },
    [onUpdate],
  );

  const setShortName = useCallback(
    (dest: DestinationPlace, value: string) => {
      const trimmed = value.trim();
      // Empty → drop the field entirely (cleaner localStorage / Firestore
      // payload, and `looseObject` doesn't care). Non-empty → store
      // verbatim (no whitespace collapse — reviewer might intentionally
      // want a leading space for some weird typographic reason).
      const next: DestinationPlace = trimmed === ''
        ? { ...dest, shortName: undefined }
        : { ...dest, shortName: value };
      void onUpdate(next);
    },
    [onUpdate],
  );

  // ── Bulk action: Generate short names ──────────────────────────────
  // Surface a confirm dialog with the affected count, then persist via
  // onUpdate per row. Skips rows with non-empty shortName so reviewer
  // edits stay sacred (suggestShortNames already enforces this; we
  // still read the count for the UX message).
  const handleGenerateShortNames = useCallback(async () => {
    const suggestions = suggestShortNames(
      live.map((d) => ({
        id: d.id,
        name: d.name,
        ...(d.shortName !== undefined && { shortName: d.shortName }),
      })),
    );
    if (suggestions.size === 0) {
      alert('All destinations already have short names. Nothing to generate.');
      return;
    }
    const skipped = live.filter((d) => d.shortName && d.shortName.trim() !== '').length;
    const ok = confirm(
      `Generate short names for ${suggestions.size} destination${
        suggestions.size === 1 ? '' : 's'
      }?\n\nThis won't overwrite existing short names${
        skipped > 0 ? ` (${skipped} will be skipped)` : ''
      }.`,
    );
    if (!ok) return;
    for (const d of live) {
      const suggestion = suggestions.get(d.id);
      if (!suggestion) continue;
      await onUpdate({ ...d, shortName: suggestion });
    }
    alert(
      `Generated short names for ${suggestions.size} destination${
        suggestions.size === 1 ? '' : 's'
      }.${skipped > 0 ? ` Skipped ${skipped} with existing values.` : ''}`,
    );
  }, [live, onUpdate]);

  return (
    <div className="bn-page">
      {/* ── Header ── */}
      <div className="bn-header">
        <button className="bn-back" onClick={onClose}>
          {'← Back to sign review'}
        </button>
        <h1 className="bn-title">Building Names</h1>

        <div className="bn-stats">
          <span className="bn-stat">{counts.total} buildings</span>
          <span className="bn-stat">⚓ {counts.anchors} anchored</span>
          <span className="bn-stat">{counts.withShort} with short name</span>
        </div>

        <div className="bn-filters">
          <input
            className="bn-search"
            type="text"
            placeholder="Search buildings or short names..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="bn-select"
            value={districtFilter}
            onChange={(e) => setDistrictFilter(e.target.value)}
          >
            <option value="">All districts</option>
            {allDistricts.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="bn-generate-btn"
            onClick={handleGenerateShortNames}
            title="Bulk-generate short names for buildings without one. Existing short names are preserved."
          >
            Generate short names
          </button>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="bn-table-wrap">
        <table className="bn-table">
          <thead>
            <tr>
              <th style={{ width: 60, textAlign: 'center' }}>Anchor</th>
              <th className="bn-sortable" onClick={() => toggleSort('name')}>
                Name {sortCol === 'name' ? (sortAsc ? '↑' : '↓') : ''}
              </th>
              <th style={{ width: 200 }}>Short name</th>
              <th style={{ width: 140 }}>District</th>
              <th style={{ width: 100 }}>Tier</th>
              <th
                className="bn-sortable"
                style={{ width: 80, textAlign: 'center' }}
                onClick={() => toggleSort('signs')}
              >
                # signs {sortCol === 'signs' ? (sortAsc ? '↑' : '↓') : ''}
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(({ dest, signCount }) => {
              const anchored = dest.isAnchor === true;
              return (
                <tr
                  key={dest.id}
                  className={`bn-row${anchored ? ' bn-anchored' : ''}`}
                >
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      className="bn-anchor-checkbox"
                      checked={anchored}
                      onChange={(e) => setAnchor(dest, e.target.checked)}
                      title={
                        anchored
                          ? 'Anchor — appears on Map signs. Click to unmark.'
                          : 'Mark as anchor — appears on Map signs.'
                      }
                    />
                  </td>
                  <td className="bn-name-cell">{dest.name}</td>
                  <td>
                    <input
                      className="bn-inline-input bn-short"
                      defaultValue={dest.shortName ?? ''}
                      placeholder="—"
                      maxLength={40}
                      onBlur={(e) => {
                        if ((e.target.value ?? '') !== (dest.shortName ?? '')) {
                          setShortName(dest, e.target.value);
                        }
                      }}
                    />
                    {dest.shortName && dest.shortName.trim() !== '' && (
                      <span className="bn-char-count">
                        {dest.shortName.length}ch
                      </span>
                    )}
                  </td>
                  <td className="bn-district">{dest.district ?? '—'}</td>
                  <td>{TIER_LABELS[dest.tier]}</td>
                  <td style={{ textAlign: 'center' }}>
                    <strong>{signCount}</strong>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="bn-empty">
                  {rows.length === 0
                    ? 'No destinations yet. Add some via the Destinations panel.'
                    : 'No destinations match the current filters.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
