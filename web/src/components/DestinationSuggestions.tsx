// ─── Destination suggestions — Phase 3 reviewer-facing ranking ─────────────
//
// Inline panel that runs `scoreDestinations` against the project's
// DestinationPlace records and renders a ranked top-N list for the
// current sign face. Clicking a suggestion adds a linked row to the
// SignCard's editDests with `arrow` pre-computed from the destination's
// bearing relative to the sign's facing.
//
// The panel is collapsed by default — reviewers opt in via the button.
// Computing scores is cheap (pure math, no IO) but the list is noisy
// until the reviewer asks for it.

import { useMemo, useState } from 'react';
import { scoreDestinations } from '@sosisu/platform/scoring';
import type { DestinationPlace, SignInstance } from '../platform/index.ts';
import { bearingToArrow, walkTimeEstimate } from '../lib/sideMath.ts';

interface Props {
  instance: SignInstance;
  destinations: DestinationPlace[];
  signDistrict?: string;
  /** Already-linked destinationPlaceIds — suggestions already on the
   *  sign are greyed out so the user doesn't double-add. */
  existingLinkedIds: readonly string[];
  onAdd: (input: {
    name: string;
    destinationPlaceId: string;
    arrow: number;
    walkTime?: string;
  }) => void;
}

const TOP_N = 5;

export function DestinationSuggestions({
  instance,
  destinations,
  signDistrict,
  existingLinkedIds,
  onAdd,
}: Props) {
  const [open, setOpen] = useState(false);

  // Recompute on every render — the work is cheap and candidates change
  // as the reviewer adds / removes rows (already-linked set changes).
  // useMemo is here for the score array identity, not for perf.
  const ranked = useMemo(() => {
    if (!open) return [];
    return scoreDestinations({
      projectId: '', // unused by the algorithm
      signInstance: instance,
      ...(signDistrict && { signDistrict }),
      candidates: destinations.filter((d) => !d.archivedAt),
    }).slice(0, TOP_N);
  }, [open, instance, destinations, signDistrict]);

  // The sign needs coords + facing before scoring can run; otherwise
  // the button is disabled with an explanatory tooltip.
  const hasRequiredState =
    instance.lat != null && instance.lng != null && instance.facing != null;

  if (!hasRequiredState && !open) {
    return (
      <div className="dest-suggestions">
        <button
          className="dest-suggest-btn"
          type="button"
          disabled
          title="Needs a sign location + facing direction first"
        >
          Suggest destinations
        </button>
      </div>
    );
  }

  return (
    <div className="dest-suggestions">
      <button
        className={`dest-suggest-btn${open ? ' active' : ''}`}
        type="button"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'Hide suggestions' : 'Suggest destinations'}
      </button>

      {open && ranked.length === 0 && (
        <div className="dest-suggest-empty">
          {destinations.length === 0
            ? 'Add some destinations from the sidebar first.'
            : 'No scorable destinations for this sign.'}
        </div>
      )}

      {open && ranked.length > 0 && (
        <ol className="dest-suggest-list">
          {ranked.map((score) => {
            const dest = destinations.find(
              (d) => d.id === score.destinationId,
            );
            if (!dest) return null;
            const alreadyLinked = existingLinkedIds.includes(dest.id);
            const walkTime = walkTimeEstimate(score.distanceMetres);
            return (
              <li
                key={dest.id}
                className={`dest-suggest-item${alreadyLinked ? ' disabled' : ''}`}
              >
                <div className="dest-suggest-main">
                  <span className="dest-suggest-name">{dest.name}</span>
                  <span className="dest-suggest-meta">
                    {dest.tier}
                    {dest.district ? ` · ${dest.district}` : ''}
                    {' · '}
                    {Math.round(score.distanceMetres)} m
                  </span>
                </div>
                <div className="dest-suggest-components">
                  <span title="Distance">
                    d {score.components.distance.toFixed(2)}
                  </span>
                  <span title="Bearing alignment">
                    b {score.components.bearing.toFixed(2)}
                  </span>
                  <span title="Tier weight">
                    t {score.components.tier.toFixed(2)}
                  </span>
                  {score.components.district > 0 && (
                    <span title="District bonus">+</span>
                  )}
                </div>
                <div className="dest-suggest-total" title="Total score">
                  {score.total.toFixed(2)}
                </div>
                <button
                  type="button"
                  className="dest-suggest-add"
                  disabled={alreadyLinked}
                  onClick={() =>
                    onAdd({
                      name: dest.name,
                      destinationPlaceId: dest.id,
                      arrow: Math.round(bearingToArrow(score.bearingDegrees)),
                      ...(walkTime && { walkTime }),
                    })
                  }
                  title={
                    alreadyLinked
                      ? 'Already on this sign'
                      : 'Add to this sign face'
                  }
                >
                  {alreadyLinked ? 'Added' : '+ Add'}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
