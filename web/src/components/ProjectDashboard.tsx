// ─── Project Dashboard — Phase 4 ───────────────────────────────────────────
//
// Project-level landing page. Replaces Phase 3's per-sign Suggest UX
// with a one-click bulk generator: hit "Generate schedules" and the
// algorithm populates ~470 destination rows across all 118 signs.
// Reviewer's job becomes Approve / Edit / Flag — never "create
// messaging from scratch."
//
// Sections (top to bottom):
//   A — Header strip (project name + client)
//   B — Status pills + review progress bar
//   C — Algorithm card (Generate / Re-generate, Advanced settings)
//   D — Coverage stats
//   E — Map overview (reuses <MapOverview />)
//   F — Resume review CTA
//
// District polygon overlays on the map are deferred (TODO Phase 4.x).

import { useMemo, useState } from 'react';
import {
  DEFAULT_SCORING_CONFIG,
  listPolicies,
  type DestinationPlace,
  type ScoringConfig,
  type SignInstance,
  type SignType,
  type SosisuProject,
} from '../platform/index.ts';
import { MapOverview } from './MapOverview.tsx';

interface Props {
  project: SosisuProject;
  instances: SignInstance[];
  signTypes: Record<string, SignType>;
  destinations: DestinationPlace[];
  isDark: boolean;
  onGenerate: (config: ScoringConfig) => Promise<void> | void;
  /** Switch the sidebar to the Instances tab + select the next sign
   *  needing review (or the given id). */
  onResumeReview: (signId?: string) => void;
  onSelectSign: (id: string) => void;
  /** Currently-running generation flag (drives button copy + disable). */
  generating?: boolean;
  /** Persist `DEFAULT_SCORING_CONFIG` onto the project, replacing whatever
   *  scoringConfig was stored. Wired to the "Reset to defaults" affordance
   *  in the Advanced settings panel. */
  onResetConfigToDefaults?: () => Promise<void> | void;
}

/** Sanitise a stored scoringConfig: fall back to default values when
 *  fields are missing or obviously broken. Sits between persistence and
 *  the algorithm so a malformed Firestore doc can't corrupt scoring.
 *  Phase 5: the per-side cap moved to the per-sign-type policy table
 *  (`policyForSignType`), so the cap-related sanitisation Phase 4 had
 *  here is gone. */
function sanitizeConfig(raw: ScoringConfig | undefined): ScoringConfig {
  if (!raw) return DEFAULT_SCORING_CONFIG;
  const def = DEFAULT_SCORING_CONFIG;
  return {
    weights: {
      distance: Number.isFinite(raw.weights?.distance)
        ? raw.weights.distance
        : def.weights.distance,
      bearing: Number.isFinite(raw.weights?.bearing)
        ? raw.weights.bearing
        : def.weights.bearing,
      tier: Number.isFinite(raw.weights?.tier)
        ? raw.weights.tier
        : def.weights.tier,
      district: Number.isFinite(raw.weights?.district)
        ? raw.weights.district
        : def.weights.district,
    },
    tierMaxDistanceMeters: {
      campus:
        Number.isFinite(raw.tierMaxDistanceMeters?.campus) &&
        raw.tierMaxDistanceMeters.campus > 0
          ? raw.tierMaxDistanceMeters.campus
          : def.tierMaxDistanceMeters.campus,
      building:
        Number.isFinite(raw.tierMaxDistanceMeters?.building) &&
        raw.tierMaxDistanceMeters.building > 0
          ? raw.tierMaxDistanceMeters.building
          : def.tierMaxDistanceMeters.building,
      room:
        Number.isFinite(raw.tierMaxDistanceMeters?.room) &&
        raw.tierMaxDistanceMeters.room > 0
          ? raw.tierMaxDistanceMeters.room
          : def.tierMaxDistanceMeters.room,
    },
  };
}

function configMatchesDefaults(c: ScoringConfig): boolean {
  return JSON.stringify(c) === JSON.stringify(DEFAULT_SCORING_CONFIG);
}

const TIER_KEYS = ['campus', 'building', 'room'] as const satisfies ReadonlyArray<
  keyof ScoringConfig['tierMaxDistanceMeters']
>;

const WEIGHT_KEYS = [
  'distance',
  'bearing',
  'tier',
  'district',
] as const satisfies ReadonlyArray<keyof ScoringConfig['weights']>;

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'unknown';
  const diffMs = Date.now() - then;
  const min = Math.round(diffMs / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const days = Math.round(hr / 24);
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}

export function ProjectDashboard({
  project,
  instances,
  signTypes,
  destinations,
  isDark,
  onGenerate,
  onResumeReview,
  onSelectSign,
  generating = false,
  onResetConfigToDefaults,
}: Props) {
  // Local config edits live in component state until the user hits
  // "Generate schedules". The committed config is on the project,
  // sanitised through `sanitizeConfig` so a stored value with a
  // wider cap (e.g. an old project saved with topNPerSide=8 before
  // the default dropped to 4) doesn't silently override the safety
  // bounds.
  const sanitizedStored = sanitizeConfig(project.scoringConfig);
  const [config, setConfig] = useState<ScoringConfig>(sanitizedStored);
  // Compare the *raw* stored config to defaults so the "differs from
  // defaults" notice only fires when there's a real persisted
  // divergence — not when sanitisation already corrected an out-of-
  // bounds value back to the default.
  const storedDiffersFromDefaults =
    project.scoringConfig !== undefined &&
    !configMatchesDefaults(project.scoringConfig);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // ── Stats ──────────────────────────────────────────────────────────────
  const counts = useMemo(() => {
    const c = { approved: 0, edited: 0, flagged: 0, pending: 0 };
    for (const inst of instances) c[inst.reviewStatus]++;
    return c;
  }, [instances]);
  const total = instances.length;
  const reviewed = total - counts.pending;
  const reviewedPct = total > 0 ? Math.round((reviewed / total) * 100) : 0;

  const rowStats = useMemo(() => {
    let auto = 0;
    let manual = 0;
    for (const inst of instances) {
      for (const side of inst.sides) {
        for (const row of side.destinations) {
          if (row.auto === true) auto++;
          else manual++;
        }
      }
    }
    return { auto, manual };
  }, [instances]);

  const coverage = useMemo(() => {
    const referencedIds = new Set<string>();
    let signsWithEmpty = 0;
    for (const inst of instances) {
      const flat = inst.sides.flatMap((s) => s.destinations);
      if (flat.length === 0) signsWithEmpty++;
      for (const row of flat) {
        if (row.destinationPlaceId) referencedIds.add(row.destinationPlaceId);
      }
    }
    const liveDest = destinations.filter((d) => !d.archivedAt);
    return {
      referenced: referencedIds.size,
      total: liveDest.length,
      unreferenced: liveDest.filter((d) => !referencedIds.has(d.id)).length,
      signsWithEmpty,
    };
  }, [instances, destinations]);

  const nextPendingSignId = useMemo(() => {
    return instances.find((i) => i.reviewStatus === 'pending')?.id;
  }, [instances]);

  const allCaughtUp = !nextPendingSignId;

  // Pre-flight estimate (Phase 5): each sign's max contribution is its
  // policy's `capacityPerSide × 2` (front + back), bounded by the number of
  // live candidates for that sign's policy. Anchor-only signs only see
  // anchored destinations; everyone else sees the full live set.
  const liveDest = destinations.filter((d) => !d.archivedAt);
  const liveDestCount = liveDest.length;
  const liveAnchorCount = liveDest.filter((d) => d.isAnchor === true).length;
  const estimatedRows = useMemo(() => {
    let rows = 0;
    for (const inst of instances) {
      const st = signTypes[inst.signTypeId];
      const code = st?.code;
      const entry = code
        ? listPolicies().find((p) => p.code === code)
        : undefined;
      const policy = entry?.policy;
      const cap = policy?.capacityPerSide ?? 4;
      const candidatePool = policy?.anchorsOnly
        ? liveAnchorCount
        : liveDestCount;
      rows += Math.min(cap * 2, candidatePool);
    }
    return rows;
  }, [instances, signTypes, liveDestCount, liveAnchorCount]);

  // ── Handlers ───────────────────────────────────────────────────────────
  const updateWeight = (
    key: keyof ScoringConfig['weights'],
    raw: string,
  ) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    setConfig((c: ScoringConfig) => ({ ...c, weights: { ...c.weights, [key]: n } }));
  };
  const updateTierMax = (
    key: keyof ScoringConfig['tierMaxDistanceMeters'],
    raw: string,
  ) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return;
    setConfig((c: ScoringConfig) => ({
      ...c,
      tierMaxDistanceMeters: { ...c.tierMaxDistanceMeters, [key]: n },
    }));
  };
  const resetDefaults = () => setConfig(DEFAULT_SCORING_CONFIG);
  const handleGenerate = () => {
    void onGenerate(config);
  };

  const everGenerated = !!project.lastGeneratedAt;
  const configChanged =
    JSON.stringify(config) !== JSON.stringify(sanitizedStored);

  return (
    <div className="project-dashboard">
      {/* ── Section A: Header ── */}
      <div className="dash-header">
        <h1 className="dash-title">{project.name || 'Untitled Project'}</h1>
        {project.client && (
          <div className="dash-client">{project.client}</div>
        )}
      </div>

      {/* ── Section B: Status pills + progress ── */}
      <div className="dash-section">
        <div className="dash-pills">
          <span className="stat-pill pill-pending">
            {counts.pending} pending
          </span>
          <span className="stat-pill pill-edited">
            {counts.edited} edited
          </span>
          <span className="stat-pill pill-flagged">
            {counts.flagged} flagged
          </span>
          <span className="stat-pill pill-approved">
            {counts.approved} approved
          </span>
        </div>
        <div className="dash-progress">
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${reviewedPct}%` }}
            />
          </div>
          <div className="dash-progress-label">
            Reviewed: {reviewed} / {total} ({reviewedPct}%)
          </div>
        </div>
      </div>

      {/* ── Section C: Algorithm card ── */}
      <div className="dash-section dash-algo-card">
        {!everGenerated ? (
          <>
            <div className="dash-algo-headline">
              Ready to generate destination schedules
            </div>
            <div className="dash-algo-body">
              The algorithm will populate destinations on each side of every
              sign based on location, facing, tier, and district. You'll
              review and approve them on the Instances tab afterwards.
            </div>
            <div className="dash-algo-preflight">
              {instances.length} signs · {liveDestCount} destinations ·
              estimated ~{estimatedRows} rows
            </div>
            <button
              className="dash-generate-btn primary"
              onClick={handleGenerate}
              disabled={generating}
            >
              {generating ? 'Generating…' : 'Generate schedules'}
            </button>
          </>
        ) : (
          <>
            <div className="dash-algo-headline">
              Schedules generated {relativeTime(project.lastGeneratedAt!)}
            </div>
            <div className="dash-algo-stats">
              {instances.length} signs · {rowStats.auto} auto rows ·{' '}
              {rowStats.manual} manual rows
            </div>
            <button
              className="dash-generate-btn secondary"
              onClick={handleGenerate}
              disabled={generating}
            >
              {generating ? 'Generating…' : 'Re-generate'}
            </button>
            {configChanged && (
              <div className="dash-algo-note">
                Settings changed since last run.
              </div>
            )}
          </>
        )}

        <button
          type="button"
          className="dash-advanced-toggle"
          onClick={() => setAdvancedOpen((v) => !v)}
          aria-expanded={advancedOpen}
        >
          {advancedOpen ? '▾' : '▸'} Advanced settings
        </button>
        {advancedOpen && (
          <div className="dash-advanced-panel">
            {storedDiffersFromDefaults && (
              <div className="dash-advanced-stale-notice">
                <span>Saved settings differ from defaults.</span>
                <button
                  type="button"
                  className="dash-advanced-stale-reset"
                  onClick={() => {
                    setConfig(DEFAULT_SCORING_CONFIG);
                    void onResetConfigToDefaults?.();
                  }}
                  disabled={!onResetConfigToDefaults}
                >
                  Reset to defaults
                </button>
              </div>
            )}
            <div className="dash-advanced-section">
              <div className="dash-advanced-label">Sub-score weights</div>
              <div className="dash-advanced-row">
                {WEIGHT_KEYS.map((key) => (
                  <label key={key} className="dash-input-pair">
                    <span>{key}</span>
                    <input
                      type="number"
                      step={0.05}
                      min={0}
                      max={1}
                      value={config.weights[key]}
                      onChange={(e) => updateWeight(key, e.target.value)}
                    />
                  </label>
                ))}
              </div>
            </div>
            <div className="dash-advanced-section">
              <div className="dash-advanced-label">
                Tier max distance (metres)
              </div>
              <div className="dash-advanced-row">
                {TIER_KEYS.map((key) => (
                  <label key={key} className="dash-input-pair">
                    <span>{key}</span>
                    <input
                      type="number"
                      min={0}
                      step={10}
                      value={config.tierMaxDistanceMeters[key]}
                      onChange={(e) => updateTierMax(key, e.target.value)}
                    />
                  </label>
                ))}
              </div>
            </div>
            {/* Phase 5: per-side cap moved from a global slider to a
                per-sign-type policy table (`DEFAULTS_BY_CODE`). The
                slider Phase 4 had here is gone; this read-only readout
                shows the *defaults* the algorithm uses for each code.
                Per-project overrides live on the SignType record (see
                the TYPES tab) — when a SignType field is unset, it
                falls through to the value shown here. Map signs (M)
                additionally filter to anchor destinations only;
                others apply a walk-distance cap so a Secondary
                Destination doesn't try to route across campus. */}
            <div className="dash-advanced-section">
              <div className="dash-advanced-label">
                Per-sign-type defaults (read-only)
              </div>
              <div className="dash-policy-table">
                {listPolicies().map(({ code, policy }) => (
                  <div key={code} className="dash-policy-row">
                    <span className="dash-policy-code">{code}</span>
                    <span className="dash-policy-label">
                      {policy.label ?? code}
                    </span>
                    <span className="dash-policy-cap">
                      {policy.capacityPerSide} per side
                    </span>
                    <span className="dash-policy-cap">
                      {policy.maxWalkMinutes !== undefined
                        ? `≤${policy.maxWalkMinutes} min walk`
                        : 'no walk cap'}
                    </span>
                    {policy.anchorsOnly && (
                      <span className="dash-policy-anchors-only">
                        anchors only
                      </span>
                    )}
                    {policy.useShortName && (
                      <span className="dash-policy-anchors-only">
                        short names
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <div className="dash-policy-footnote">
                Defaults are fixed per code. Override per-project in the{' '}
                <strong>TYPES</strong> tab — clear a field to fall back
                to the default shown here.
              </div>
              <div className="dash-advanced-row">
                <button
                  type="button"
                  className="dash-reset-defaults"
                  onClick={resetDefaults}
                >
                  Reset weights to defaults
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Section D: Coverage stats ── */}
      <div className="dash-section dash-coverage">
        <div className="dash-coverage-card">
          <div className="dash-coverage-num">
            {coverage.referenced} / {coverage.total}
          </div>
          <div className="dash-coverage-label">
            Destinations referenced by ≥1 sign
          </div>
        </div>
        <div className="dash-coverage-card">
          <div className="dash-coverage-num">{coverage.unreferenced}</div>
          <div className="dash-coverage-label">Unreferenced destinations</div>
        </div>
        <div className="dash-coverage-card">
          <div className="dash-coverage-num">{coverage.signsWithEmpty}</div>
          <div className="dash-coverage-label">
            Signs with empty schedules
          </div>
        </div>
      </div>

      {/* ── Section E: Map overview ── */}
      {/* TODO(Phase 4.x): district polygon overlays. Defer until district
          geometry data is captured (the seed only has district names per
          destination — no polygons). */}
      <div className="dash-section dash-map">
        <MapOverview
          instances={instances}
          signTypes={signTypes}
          destinations={destinations}
          onSelectSign={onSelectSign}
          onClose={() => {
            /* dashboard owns its own visibility — close is a no-op */
          }}
          isDark={isDark}
        />
      </div>

      {/* ── Section F: Resume review ── */}
      <div className="dash-section dash-resume">
        <button
          type="button"
          className="dash-resume-btn"
          disabled={allCaughtUp}
          onClick={() => onResumeReview(nextPendingSignId)}
        >
          {allCaughtUp ? 'All caught up' : 'Resume review →'}
        </button>
      </div>
    </div>
  );
}
