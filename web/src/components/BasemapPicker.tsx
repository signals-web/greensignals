// ─── Basemap picker — Phase I1 settings UI ───────────────────────────────────
//
// Mounts inside ProjectDashboard's Advanced Settings disclosure alongside the
// scoring-config rows. Lists the basemaps whose provider has an API key
// configured (grouped by provider), persisting the pick to Project.basemapId.
// The default option clears basemapId → the registry default (MapTiler
// Streets), preserving pre-I1 behaviour.

import {
  getAvailableBasemaps,
  getBasemapById,
  PROVIDERS,
  type ProviderId,
} from '../lib/basemap-registry.ts';

const PROVIDER_LABELS: Record<ProviderId, string> = {
  maptiler: 'MapTiler',
  arcgis: 'ArcGIS',
};
const PROVIDER_ORDER: ProviderId[] = ['maptiler', 'arcgis'];

/** Map a <select> option value to the persisted basemapId. The default
 *  option uses value="" → undefined (clears Project.basemapId). Exported so
 *  the node-env test suite can verify the mapping without a DOM event. */
export function optionValueToBasemapId(value: string): string | undefined {
  return value === '' ? undefined : value;
}

export interface BasemapPickerProps {
  /** Currently-selected basemap id from project.basemapId. */
  value: string | undefined;
  onChange: (basemapId: string | undefined) => void;
}

export function BasemapPicker({ value, onChange }: BasemapPickerProps) {
  const available = getAvailableBasemaps();
  const selected = value ? getBasemapById(value) : undefined;
  // The persisted id references a basemap whose provider is no longer
  // configured (e.g. ArcGIS selected, then the key removed). Resolution
  // falls back to the default; flag it so the designer knows why.
  const selectedUnavailable =
    !!value && (!selected || !PROVIDERS[selected.providerId].isConfigured());

  const groups = PROVIDER_ORDER.map((pid) => ({
    pid,
    entries: available.filter((e) => e.providerId === pid),
  })).filter((g) => g.entries.length > 0);

  return (
    <div className="dash-advanced-section" data-testid="basemap-picker">
      <div className="dash-advanced-label">Basemap</div>
      <div className="dash-advanced-caption" style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>
        Choose the basemap rendered behind sign markers.
      </div>

      {available.length === 0 ? (
        <div data-testid="basemap-empty" style={{ fontSize: 12, opacity: 0.85 }}>
          No basemap providers configured. Set <code>VITE_MAPTILER_KEY</code> or{' '}
          <code>VITE_ARCGIS_API_KEY</code> in your deployment env.
        </div>
      ) : (
        <select
          data-testid="basemap-select"
          value={value ?? ''}
          onChange={(e) => onChange(optionValueToBasemapId(e.target.value))}
        >
          <option value="">Default (MapTiler Streets)</option>
          {groups.map((g) => (
            <optgroup key={g.pid} label={PROVIDER_LABELS[g.pid]}>
              {g.entries.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      )}

      {selectedUnavailable && (
        <div data-testid="basemap-unavailable" style={{ fontSize: 12, color: '#E8B84A', marginTop: 6 }}>
          Selected basemap is unavailable — using default.
        </div>
      )}
    </div>
  );
}
