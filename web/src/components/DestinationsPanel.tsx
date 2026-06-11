// ─── Destinations panel ─────────────────────────────────────────────────────
//
// Inline list + create form for a project's destination places. Rendered
// from Sidebar when the user selects the "Destinations" tab.
//
// Phase 1 shipped the list + manual-coords add form. Phase 2 layers on:
//   - "Place on map" — exits the sidebar into placement mode on MapOverview;
//     a map click prefills the form via `prefilledCoords` and re-opens it.
//   - "Look up address" — MapTiler forward-geocoding on a dedicated address
//     field (kept separate from `name` because destination names like
//     "Front desk" or "Loading dock" aren't geocodable).
//
// Not here: drag-to-move (owned by MapOverview), edit name/tier/district
// (deferred to Phase 2b — archive + recreate is the workaround), or
// unarchive from a hidden archived-view (Phase 2b).

import { useEffect, useState } from 'react';
import type {
  DestinationPlace,
  DestinationTier,
} from '../platform/index.ts';
import { geocodeAddress } from '../lib/geocodeAddress.ts';

interface Props {
  destinations: DestinationPlace[];
  onCreate: (input: {
    name: string;
    lat: number;
    lng: number;
    tier: DestinationTier;
    district?: string;
    /** Phase 5: Anchor flag — when true, the destination is part of the
     *  curated set that appears on Map (overview) signs.
     *
     *  Phase 5b: this field is no longer set from the DestinationsPanel
     *  add form — anchor editing moved to BuildingNames. The field
     *  stays in the prop type for back-compat with any other caller
     *  that still wants to pre-set anchors at creation. */
    isAnchor?: boolean;
  }) => Promise<void> | void;
  onArchive: (destinationPlaceId: string) => Promise<void> | void;
  /** Role gate for the archive (×) affordance. The Sidebar resolves the
   *  current user's capabilities and passes the verdict down; defaults
   *  to true so older callers keep the button. */
  canArchive?: boolean;
  /** Phase 5b: open the BuildingNames admin sheet. Wired to the
   *  panel-header "Edit anchors in Building Names →" link. Optional
   *  so older parents still compile; the link hides when missing. */
  onOpenBuildingNames?: () => void;
  /** Optional initial centre used to pre-fill the add form's coordinates
   *  via a "Use current map centre" helper. Passive — user has to click. */
  mapCenter?: { lat: number; lng: number };
  /** When set, auto-opens the form with lat/lng pre-populated. The parent
   *  clears this via `onClearPrefilled` once the form closes. Active —
   *  higher priority than `mapCenter` (which is a passive shortcut). */
  prefilledCoords?: { lat: number; lng: number } | null;
  /** Called after a prefilled form closes so the parent can null out
   *  `prefilledCoords` — otherwise a subsequent `+ Add destination` would
   *  unexpectedly re-open with stale coords. */
  onClearPrefilled?: () => void;
  /** Enter placement mode — app-level state that switches MapOverview into
   *  destination-placement mode. */
  onPlaceOnMap: () => void;
  /** MapTiler key. Empty string = no key set; the "Look up address"
   *  button is hidden in that case. */
  maptilerKey: string;
}

const TIER_LABELS: Record<DestinationTier, string> = {
  campus: 'Campus',
  building: 'Building',
  room: 'Room',
};

export function DestinationsPanel({
  destinations,
  onCreate,
  onArchive,
  canArchive = true,
  onOpenBuildingNames,
  mapCenter,
  prefilledCoords,
  onClearPrefilled,
  onPlaceOnMap,
  maptilerKey,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [tier, setTier] = useState<DestinationTier>('building');
  const [district, setDistrict] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeMessage, setGeocodeMessage] = useState<string | null>(null);

  const resetForm = () => {
    setName('');
    setAddress('');
    setLat('');
    setLng('');
    setTier('building');
    setDistrict('');
    setError(null);
    setGeocodeMessage(null);
  };

  // When parent hands us coords from a map click, open the form with lat/lng
  // pre-populated. Effect only fires when the prop *reference* changes —
  // parent passes a fresh object per placement — so a cancelled form
  // won't re-open on next render.
  useEffect(() => {
    if (!prefilledCoords) return;
    setAdding(true);
    setLat(prefilledCoords.lat.toFixed(6));
    setLng(prefilledCoords.lng.toFixed(6));
    // Clear the parent's state so a later `+ Add destination` starts blank.
    onClearPrefilled?.();
  }, [prefilledCoords, onClearPrefilled]);

  const handleCancel = () => {
    resetForm();
    setAdding(false);
  };

  const handleUseMapCenter = () => {
    if (!mapCenter) return;
    setLat(mapCenter.lat.toFixed(6));
    setLng(mapCenter.lng.toFixed(6));
  };

  const handleLookupAddress = async () => {
    const q = address.trim();
    if (!q) {
      setGeocodeMessage('Enter an address or place name first');
      return;
    }
    setGeocoding(true);
    setGeocodeMessage(null);
    try {
      const hit = await geocodeAddress(q, maptilerKey);
      if (!hit) {
        setGeocodeMessage("Couldn't find that address");
        return;
      }
      setLat(hit.lat.toFixed(6));
      setLng(hit.lng.toFixed(6));
      setGeocodeMessage(`Matched: ${hit.matchedAddress}`);
    } finally {
      setGeocoding(false);
    }
  };

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Name is required');
      return;
    }
    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (!Number.isFinite(latNum) || latNum < -90 || latNum > 90) {
      setError('Latitude must be a number between -90 and 90');
      return;
    }
    if (!Number.isFinite(lngNum) || lngNum < -180 || lngNum > 180) {
      setError('Longitude must be a number between -180 and 180');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onCreate({
        name: trimmedName,
        lat: latNum,
        lng: lngNum,
        tier,
        ...(district.trim() && { district: district.trim() }),
      });
      resetForm();
      setAdding(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  // Sort: campus tier first, then building, then room, alpha within tier.
  const sorted = [...destinations].sort((a, b) => {
    const order: Record<DestinationTier, number> = { campus: 0, building: 1, room: 2 };
    const tierDiff = order[a.tier] - order[b.tier];
    if (tierDiff !== 0) return tierDiff;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="destinations-panel">
      {!adding && (
        <>
          <div className="destination-add-row">
            <button
              className="destination-add-btn"
              onClick={() => setAdding(true)}
            >
              + Add destination
            </button>
            <button
              className="destination-place-btn"
              onClick={onPlaceOnMap}
              title="Click on the map to place a destination"
            >
              Place on map
            </button>
          </div>
          {/* Phase 5b: hand-off to the BuildingNames admin where anchor +
              shortName editing lives. Hidden if the parent didn't supply
              an opener (older callers compile clean). */}
          {onOpenBuildingNames && (
            <button
              type="button"
              className="destination-buildingnames-link"
              onClick={onOpenBuildingNames}
              title="Edit anchors and short names in the Building Names admin"
            >
              Edit anchors in Building Names →
            </button>
          )}
        </>
      )}

      {adding && (
        <div className="destination-form">
          <input
            className="destination-form-input"
            placeholder="Name (e.g. Norlin Library)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            maxLength={80}
          />
          {maptilerKey && (
            <div className="destination-form-row">
              <input
                className="destination-form-input"
                placeholder="Address or place (optional — for lookup)"
                value={address}
                onChange={(e) => {
                  setAddress(e.target.value);
                  setGeocodeMessage(null);
                }}
                maxLength={160}
                style={{ flex: 2 }}
              />
              <button
                type="button"
                className="destination-form-lookup"
                onClick={handleLookupAddress}
                disabled={geocoding}
                style={{ flex: 1 }}
              >
                {geocoding ? 'Looking up…' : 'Look up address'}
              </button>
            </div>
          )}
          {geocodeMessage && (
            <div className="destination-form-hint">{geocodeMessage}</div>
          )}
          <div className="destination-form-row">
            <input
              className="destination-form-input"
              placeholder="Latitude"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              inputMode="decimal"
            />
            <input
              className="destination-form-input"
              placeholder="Longitude"
              value={lng}
              onChange={(e) => setLng(e.target.value)}
              inputMode="decimal"
            />
          </div>
          {mapCenter && (
            <button
              type="button"
              className="destination-form-link"
              onClick={handleUseMapCenter}
            >
              Use current map centre
            </button>
          )}
          <div className="destination-form-row">
            <select
              className="destination-form-input"
              value={tier}
              onChange={(e) => setTier(e.target.value as DestinationTier)}
            >
              <option value="campus">Campus</option>
              <option value="building">Building</option>
              <option value="room">Room</option>
            </select>
            <input
              className="destination-form-input"
              placeholder="District (optional)"
              value={district}
              onChange={(e) => setDistrict(e.target.value)}
              maxLength={40}
            />
          </div>
          {/* Phase 5b: anchor checkbox removed from the add form.
              Anchor editing now lives in BuildingNames where reviewers
              can see name + shortName + anchor + district side by side
              with more horizontal space. New destinations default to
              non-anchor; mark them via the BuildingNames sheet. */}
          {error && <div className="destination-form-error">{error}</div>}
          <div className="destination-form-actions">
            <button
              type="button"
              className="destination-form-cancel"
              onClick={handleCancel}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="destination-form-save"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      <div className="destination-list">
        {sorted.length === 0 && !adding && (
          <div className="sign-list-empty">
            No destinations yet. Add buildings, landmarks, and amenities that
            signs will point to.
          </div>
        )}
        {sorted.map((dest) => {
          const anchored = dest.isAnchor === true;
          return (
            <div
              key={dest.id}
              className={`destination-item${anchored ? ' is-anchor' : ''}`}
            >
              <div className="destination-item-info">
                <div className="destination-item-text">
                  <span className="destination-item-name">
                    {/* Phase 5b: read-only star — anchor editing lives
                        in BuildingNames now. The star is purely
                        informational here so reviewers can scan the
                        list and see which rows are anchored without
                        switching tabs. */}
                    {anchored && (
                      <span
                        className="destination-item-anchor-star"
                        title="Anchor (edit in Building Names)"
                      >
                        ★{' '}
                      </span>
                    )}
                    {dest.name}
                  </span>
                  <span className="destination-item-meta">
                    {TIER_LABELS[dest.tier]}
                    {dest.district ? ` · ${dest.district}` : ''}
                  </span>
                </div>
                <span className="destination-item-coords">
                  {dest.lat.toFixed(4)}, {dest.lng.toFixed(4)}
                </span>
              </div>
              {canArchive && (
                <button
                  className="destination-delete-btn"
                  onClick={() => {
                    if (confirm(`Archive destination "${dest.name}"?`)) {
                      void onArchive(dest.id);
                    }
                  }}
                  title="Archive destination"
                >
                  {'×'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
