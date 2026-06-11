import type {
  SignInstance,
  SignType,
  DestinationPlace,
  DestinationTier,
  SosisuProject,
} from '../platform/index.ts';
import { useProjectRole } from '../lib/auth.ts';
import { CategoryIcon, CATEGORY_META } from './CategoryIcon.tsx';
import { DestinationsPanel } from './DestinationsPanel.tsx';
import { SignTypePolicyEditor } from './SignTypePolicyEditor.tsx';
import { displaySignId } from '../lib/displaySignId.ts';

/** Sidebar tabs. `'project'` switches the right pane to the
 *  ProjectDashboard; the other three populate the sidebar's list view. */
export type ViewMode = 'project' | 'instances' | 'types' | 'destinations';

interface Props {
  projectName: string;
  projectClient?: string;
  /** Project record — `members` drives role resolution for capability
   *  gating (instance/type delete, destination archive). */
  project: Pick<SosisuProject, 'members'>;
  instances: SignInstance[];
  signTypes: Record<string, SignType>;
  destinations: DestinationPlace[];
  currentId: string | null;
  filter: string;
  onFilterChange: (f: string) => void;
  onSelect: (id: string) => void;
  onThemeToggle: () => void;
  isDark: boolean;
  reviewerName: string | null;
  onSetReviewer: () => void;
  onMapOverview: () => void;
  onExport: () => void;
  onPlaceType: (signTypeId: string) => void;
  onDeleteType: (signTypeId: string) => void;
  /** Phase 5: persist edits to a SignType record (used by the per-type
   *  policy editor in the TYPES tab). The second argument is true
   *  when one of the scoring-policy fields changed; the parent uses
   *  it to decide whether to prompt for re-generation of affected
   *  signs. */
  onUpdateSignType?: (next: SignType, policyChanged: boolean) => Promise<void> | void;
  onDeleteInstance: (instanceId: string) => void;
  onResetProject: () => void;
  onImport: () => void;
  onCreateDestination: (input: {
    name: string;
    lat: number;
    lng: number;
    tier: DestinationTier;
    district?: string;
    /** Phase 5: anchor flag (curated set surfaced on Map signs). */
    isAnchor?: boolean;
  }) => Promise<void> | void;
  onArchiveDestination: (destinationPlaceId: string) => Promise<void> | void;
  /** Phase 5b: open the BuildingNames admin sheet — wired from the
   *  DestinationsPanel header link "Edit anchors in Building Names →". */
  onOpenBuildingNames?: () => void;
  /** Load the CU Boulder sample data into the active project. Demo-mode
   *  only — App passes `undefined` when Firebase is wired so the
   *  Sidebar can hide the button. */
  onLoadCuBoulderSample?: () => void;
  mapCenter?: { lat: number; lng: number };
  /** Auto-open the destinations add form with lat/lng pre-populated.
   *  Parent clears this via `onClearPrefilledDestination` after we
   *  consume it, so re-opening "+ Add destination" starts blank. */
  prefilledDestinationCoords?: { lat: number; lng: number } | null;
  onClearPrefilledDestination?: () => void;
  /** Enter destination-placement mode — switches MapOverview into a
   *  "click the map to place a destination" state. */
  onPlaceDestinationOnMap: () => void;
  /** MapTiler API key — threaded so DestinationsPanel can decide whether
   *  to show the "Look up address" button. */
  maptilerKey: string;
  /** Lifted to App so the right pane (ProjectDashboard vs SignCard etc.)
   *  can react to the same selection. */
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}

function shortNbhd(n: string): string {
  return n
    .replace('Main Campus', 'Main')
    .replace('East Campus', 'East')
    .replace('Williams Village', 'WV');
}

export function Sidebar({
  projectName,
  projectClient,
  project,
  instances,
  signTypes,
  destinations,
  currentId,
  filter,
  onFilterChange,
  onSelect,
  onThemeToggle,
  isDark,
  reviewerName,
  onSetReviewer,
  onMapOverview: _onMapOverview,
  onExport: _onExport,
  onPlaceType,
  onDeleteType,
  onUpdateSignType,
  onDeleteInstance,
  onResetProject,
  onImport,
  onCreateDestination,
  onArchiveDestination,
  onOpenBuildingNames,
  onLoadCuBoulderSample,
  mapCenter,
  prefilledDestinationCoords,
  onClearPrefilledDestination,
  onPlaceDestinationOnMap,
  maptilerKey,
  viewMode,
  onViewModeChange,
}: Props) {
  // Phase 4 lifted viewMode to App so the right pane (ProjectDashboard
  // vs SignCard / MapOverview / etc.) can branch on the same value the
  // sidebar tabs select.

  // Role-gated destructive affordances: instance delete needs
  // `instance.edit`, type delete needs `signType.archive`, destination
  // archive needs `project.edit` (no finer-grained capability exists —
  // see `code/platform/src/auth/permissions.ts`). Reviewers/viewers see
  // the lists without the × buttons.
  const { can } = useProjectRole(project);
  const canDeleteInstance = can('instance.edit');
  const canDeleteType = can('signType.archive');
  const canArchiveDestination = can('project.edit');

  const counts = { approved: 0, edited: 0, flagged: 0, pending: 0 };
  for (const inst of instances) {
    counts[inst.reviewStatus]++;
  }
  const total = instances.length;
  const reviewed = total - counts.pending;
  const pct = total > 0 ? Math.round((reviewed / total) * 100) : 0;

  // Build filter options from unique sign type codes
  const typeOptions = new Map<string, string>();
  for (const inst of instances) {
    const st = signTypes[inst.signTypeId];
    if (st && !typeOptions.has(st.code)) {
      typeOptions.set(st.code, `${st.code} — ${st.name}`);
    }
  }

  const filtered = filter
    ? instances.filter((inst) => {
        const st = signTypes[inst.signTypeId];
        return st?.code === filter;
      })
    : instances;

  // Count instances per sign type
  const typeCounts: Record<string, number> = {};
  for (const inst of instances) {
    typeCounts[inst.signTypeId] = (typeCounts[inst.signTypeId] ?? 0) + 1;
  }

  const typeList = Object.values(signTypes).sort((a, b) =>
    a.code.localeCompare(b.code),
  );

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div>
          <div className="sidebar-brand">{projectName}</div>
          {projectClient && (
            <div className="sidebar-client">{projectClient}</div>
          )}
          <div className="sidebar-title">
            {viewMode === 'project'
              ? 'Project'
              : viewMode === 'instances'
                ? 'Messaging Review'
                : viewMode === 'types'
                  ? 'Sign Types'
                  : 'Destinations'}
          </div>
        </div>
        <button
          className="theme-toggle"
          onClick={onThemeToggle}
          title="Toggle light/dark mode"
        >
          {isDark ? '\u2600' : '\u263E'}
        </button>
      </div>

      {/* View mode toggle */}
      <div className="view-toggle">
        <button
          className={`view-toggle-btn${viewMode === 'project' ? ' active' : ''}`}
          onClick={() => onViewModeChange('project')}
          title="Project dashboard + bulk auto-population"
        >
          Project
        </button>
        <button
          className={`view-toggle-btn${viewMode === 'instances' ? ' active' : ''}`}
          onClick={() => onViewModeChange('instances')}
        >
          Signs ({instances.length})
        </button>
        <button
          className={`view-toggle-btn${viewMode === 'types' ? ' active' : ''}`}
          onClick={() => onViewModeChange('types')}
        >
          Types ({typeList.length})
        </button>
        <button
          className={`view-toggle-btn${viewMode === 'destinations' ? ' active' : ''}`}
          onClick={() => onViewModeChange('destinations')}
        >
          Dests ({destinations.length})
        </button>
      </div>

      {viewMode === 'project' ? (
        // Project mode: the dashboard fills the right pane. The sidebar
        // body is a brief project-info panel here so the rail still
        // reads as "you are on the project tab" rather than going
        // empty.
        <div className="sidebar-project-stub">
          <div className="sidebar-project-stub-line">
            {instances.length} signs · {Object.keys(signTypes).length} types
            · {destinations.length} destinations
          </div>
        </div>
      ) : viewMode === 'destinations' ? (
        <DestinationsPanel
          destinations={destinations}
          onCreate={onCreateDestination}
          onArchive={onArchiveDestination}
          canArchive={canArchiveDestination}
          {...(onOpenBuildingNames && { onOpenBuildingNames })}
          onPlaceOnMap={onPlaceDestinationOnMap}
          maptilerKey={maptilerKey}
          {...(mapCenter && { mapCenter })}
          {...(prefilledDestinationCoords !== undefined && {
            prefilledCoords: prefilledDestinationCoords,
          })}
          {...(onClearPrefilledDestination && {
            onClearPrefilled: onClearPrefilledDestination,
          })}
        />
      ) : viewMode === 'instances' ? (
        <>
          <div className="progress-wrap">
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="progress-stats">
              <span className="stat-pill pill-approved">
                {counts.approved} approved
              </span>
              <span className="stat-pill pill-edited">
                {counts.edited} edited
              </span>
              <span className="stat-pill pill-flagged">
                {counts.flagged} flagged
              </span>
              <span className="stat-pill pill-pending">
                {counts.pending} pending
              </span>
            </div>
          </div>

          <div className="filter-bar">
            <select
              value={filter}
              onChange={(e) => onFilterChange(e.target.value)}
            >
              <option value="">All sign types</option>
              {[...typeOptions.entries()].map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="sign-list">
            {filtered.length === 0 && (
              <div className="sign-list-empty">
                {instances.length === 0
                  ? 'No instances placed yet. Switch to Types to place signs on the map.'
                  : 'No signs match the current filter.'}
              </div>
            )}
            {filtered.map((inst) => {
              const st = signTypes[inst.signTypeId];
              return (
                <div
                  key={inst.id}
                  className={`sign-item${inst.id === currentId ? ' active' : ''}`}
                  onClick={() => onSelect(inst.id)}
                >
                  <div className="sign-icon">
                    {st && <CategoryIcon category={st.category} />}
                  </div>
                  <span className="sign-item-id">
                    {displaySignId(inst.id)}
                  </span>
                  <span className="sign-item-category">
                    {inst.neighborhood ? shortNbhd(inst.neighborhood) : st?.code ?? ''}
                  </span>
                  <span className={`status-dot dot-${inst.reviewStatus}`} />
                  {canDeleteInstance && (
                    <button
                      className="instance-delete-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete instance ${displaySignId(inst.id)}?`)) {
                          onDeleteInstance(inst.id);
                        }
                      }}
                      title="Delete instance"
                    >
                      {'×'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="sign-list">
          {typeList.length === 0 && (
            <div className="sign-list-empty">
              No sign types yet. Create one in Solid and hand off to Signal.
            </div>
          )}
          {typeList.map((st) => {
            const count = typeCounts[st.id] ?? 0;
            return (
              <div key={st.id} className="type-item-wrap">
                <div className="type-item">
                  <div className="type-item-info">
                    <div className="sign-icon">
                      <CategoryIcon category={st.category} />
                    </div>
                    <div className="type-item-text">
                      <span className="type-item-code" style={{ color: CATEGORY_META[st.category]?.color }}>{st.code}</span>
                      <span className="type-item-name">{st.name}</span>
                    </div>
                    <span className="type-item-qty">{count}</span>
                  </div>
                  <button
                    className="type-place-btn"
                    onClick={() => onPlaceType(st.id)}
                    title="Place on map"
                  >
                    + Place
                  </button>
                  {canDeleteType && (
                    <button
                      className="type-delete-btn"
                      onClick={() => {
                        if (confirm(`Delete ${st.code}? This removes ${count} placed instance${count !== 1 ? 's' : ''}.`)) {
                          onDeleteType(st.id);
                        }
                      }}
                      title="Delete type and its instances"
                    >
                      {'×'}
                    </button>
                  )}
                </div>
                {/* Phase 5: per-type policy editor (capacity, anchors-only,
                    max-walk-minutes). Hidden when the parent doesn't supply
                    an updater so older callers still compile. */}
                {onUpdateSignType && (
                  <SignTypePolicyEditor signType={st} onUpdate={onUpdateSignType} />
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="sidebar-footer">
        <span className="reviewer-chip" onClick={onSetReviewer}>
          {reviewerName ? `● ${reviewerName}` : 'Set your name'}
        </span>
        <div className="sidebar-footer-actions">
          {onLoadCuBoulderSample && (
            <button
              className="load-sample-btn"
              onClick={onLoadCuBoulderSample}
              title="Replace the demo project with the CU Boulder sample data"
            >
              Load CU Boulder sample
            </button>
          )}
          <button className="import-data-btn" onClick={onImport} title="Import CSV data">
            Import Data
          </button>
          <button className="reset-btn" onClick={onResetProject} title="Clear all data">
            Reset
          </button>
        </div>
      </div>
    </aside>
  );
}
