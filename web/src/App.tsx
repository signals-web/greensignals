import { useEffect, useState, useCallback, useRef } from 'react';
import { ensureDemoProject, getRepos } from './lib/repo.ts';
import { hasLeftoverCuBoulderMetadata } from './lib/cuBoulderDetect.ts';
import { useCurrentUser, getAuthClient } from './lib/auth.ts';
import LoginScreen from '../../../platform/components/LoginScreen.tsx';
import SuiteNav from '../../../platform/components/SuiteNav.tsx';
import { Sidebar, type ViewMode } from './components/Sidebar.tsx';
import { SignCard } from './components/SignCard.tsx';
import { MapOverview } from './components/MapOverview.tsx';
import { ProjectDashboard } from './components/ProjectDashboard.tsx';
import { RightPanel, logActivity } from './components/RightPanel.tsx';
import { BuildingNames } from './components/BuildingNames.tsx';
import { ImportModal } from './components/ImportModal.tsx';
import { generateAllSignSchedules } from './lib/scheduleGenerator.ts';
import { mergeBuildingsIntoDestinations } from './lib/buildingsToDestinations.ts';
import {
  getInstances,
  subscribeInstances,
  addInstance,
  deleteInstance,
  resetInstances,
  // Aliased to avoid shadowing by the local `const [instances, setInstances]
  // = useState<...>(...)` declaration below — the React setter and the
  // module-level wholesale-replacer share a name space otherwise.
  setInstances as setInstanceStore,
} from './lib/instances.ts';
import { buildCuBoulderSeed } from './data/cuBoulder/index.ts';
import {
  readSolidHandoffFromLocation,
  HANDOFF_FROM_SOLID_QUERY_PARAM,
} from './platform/index.ts';
import { blankDestinationPlace, DEFAULT_SCORING_CONFIG } from './platform/index.ts';
import type {
  SosisuProject,
  SignType,
  SignInstance,
  Building,
  DestinationPlace,
  DestinationTier,
  FacingDirection,
  ScoringConfig,
} from './platform/index.ts';

export function App() {
  const auth = useCurrentUser();
  const [project, setProject] = useState<SosisuProject | null>(null);
  const [signTypesMap, setSignTypesMap] = useState<Record<string, SignType>>({});
  const [instances, setInstances] = useState<SignInstance[]>([]);
  const [destinations, setDestinations] = useState<DestinationPlace[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [isDark, setIsDark] = useState(true);
  const [showMapOverview, setShowMapOverview] = useState(false);
  const [showBuildingNames, setShowBuildingNames] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [reviewerName, setReviewerName] = useState<string | null>(() =>
    localStorage.getItem('sosisu:signal:reviewer') ?? null,
  );
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const nameResolveRef = useRef<((name: string | null) => void) | null>(null);
  const mainRef = useRef<HTMLElement>(null);

  // Sidebar view mode (Phase 4 lifted out of Sidebar so the right pane
  // can render the ProjectDashboard when 'project' is selected). The
  // initial value is decided once the project loads — see the
  // bootstrap effect below.
  const [viewMode, setViewMode] = useState<ViewMode>('instances');
  const [generating, setGenerating] = useState(false);

  // Placement mode state
  const [placingTypeId, setPlacingTypeId] = useState<string | null>(null);

  // Destination placement mode state. Mutually exclusive with sign
  // placement — entering one cancels the other. `prefilledDestCoords`
  // carries the click's lat/lng into DestinationsPanel so the form
  // opens pre-populated; parent clears it once the form consumes it.
  const [placingDestination, setPlacingDestination] = useState(false);
  const [prefilledDestCoords, setPrefilledDestCoords] = useState<
    { lat: number; lng: number } | null
  >(null);

  // Theme
  useEffect(() => {
    document.documentElement.classList.toggle('light', !isDark);
  }, [isDark]);

  const toggleTheme = useCallback(() => setIsDark((d) => !d), []);

  // ── Cross-app archive queue (written by Solid's "Delete everywhere") ──
  const processCrossAppArchiveQueue = useCallback(async (projId: string) => {
    try {
      const raw = localStorage.getItem('sosisu:cross-app:archive-queue');
      if (!raw) return;
      const queue: string[] = JSON.parse(raw);
      if (!queue.length) return;

      const repos = getRepos();
      const allTypes = await repos.signTypes.list(projId);
      let archived = 0;
      for (const solidTypeId of queue) {
        const match = allTypes.find((t) => t.solidTypeId === solidTypeId);
        if (match && !match.archivedAt) {
          await repos.signTypes.archive(projId, match.id);
          archived++;
          console.log(
            '[cross-app-delete] Archived Signal type',
            match.id,
            'for solidTypeId',
            solidTypeId,
          );
        }
      }
      // Clear the queue after processing
      localStorage.removeItem('sosisu:cross-app:archive-queue');
      if (archived > 0) {
        console.log(`[cross-app-delete] Processed ${archived} archive(s) from Solid`);
      }
    } catch (err) {
      console.warn('[cross-app-delete] Error processing archive queue:', err);
    }
  }, []);

  // ── Handoff processing helper (called on bootstrap AND on tab focus) ──
  const processHandoff = useCallback(async (projId: string) => {
    try {
      const handoff = readSolidHandoffFromLocation();
      if (!handoff) return; // no handoff param present

      if (!handoff.ok) {
        console.error('[handoff] Solid handoff failed validation:', (handoff as any).error);
        return;
      }

      const incoming = handoff.value.signType;
      // Check for existing type with same solidTypeId
      const existing = incoming.solidTypeId
        ? await getRepos().signTypes.findBySolidTypeId(projId, incoming.solidTypeId)
        : null;
      if (existing) {
        // Update existing type with fresh data from Solid.
        // Explicitly clear archivedAt — if the type was previously
        // archived (via Reset), re-handoff from Solid un-archives it.
        await getRepos().signTypes.save(projId, {
          ...existing,
          ...incoming,
          id: existing.id, // keep existing id
          archivedAt: undefined, // un-archive on re-handoff
        });
        console.log('[handoff] Updated existing sign type from Solid:', existing.id);
      } else {
        // Save as new type
        await getRepos().signTypes.save(projId, incoming);
        console.log('[handoff] Created new sign type from Solid:', incoming.id, incoming.code, incoming.name);
      }
      // Strip query param so it doesn't re-process on reload
      const url = new URL(window.location.href);
      url.searchParams.delete(HANDOFF_FROM_SOLID_QUERY_PARAM);
      window.history.replaceState({}, '', url.toString());
    } catch (err) {
      console.error('[handoff] Error processing Solid handoff:', err);
    }
  }, []);

  // Re-process handoff when the tab receives focus (covers tab-reuse via
  // window.open from Solid — the URL may have changed without a full reload).
  useEffect(() => {
    const onFocus = () => {
      if (!project) return;
      // Process any pending cross-app archives from Solid
      processCrossAppArchiveQueue(project.id);
      // Only re-check if the URL still carries a handoff param
      const params = new URLSearchParams(window.location.search);
      if (params.has(HANDOFF_FROM_SOLID_QUERY_PARAM)) {
        console.log('[handoff] Tab focused with handoff param, re-processing…');
        processHandoff(project.id);
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [project, processHandoff, processCrossAppArchiveQueue]);

  // Bootstrap project + subscribe to sign types and instances
  useEffect(() => {
    let cancelled = false;
    let unsubTypes: (() => void) | null = null;
    let unsubInstances: (() => void) | null = null;
    let unsubDestinations: (() => void) | null = null;

    (async () => {
      const proj = await ensureDemoProject();
      if (cancelled) return;
      setProject(proj);

      // Phase 6 — detect leftover CU Boulder seed data. The seed is
      // strictly opt-in (Sidebar "Load CU Boulder sample" button) but
      // pre-Phase-6 reset left the project name + client in place, so
      // a once-loaded demo could read as "still on the demo" forever.
      // We flag it here so the user knows what they're looking at and
      // can clear via the Reset button. No automatic wipe — that's
      // the user's call.
      if (hasLeftoverCuBoulderMetadata(proj)) {
        console.warn(
          '[phase-6] Detected leftover CU Boulder seed metadata on the persisted project. ' +
            'Phase 6 retired the auto-seed; click Reset in the sidebar to clear it and start fresh.',
        );
      }

      // Phase 4 default-tab branching: a fresh project (no
      // `lastGeneratedAt`) lands on the Project Dashboard so the
      // reviewer's first action is "Generate schedules". A project
      // that's already been generated lands on Signs so the reviewer
      // can pick up where they left off.
      setViewMode(proj.lastGeneratedAt ? 'instances' : 'project');

      // ── Process cross-app archive queue from Solid ──
      await processCrossAppArchiveQueue(proj.id);

      // ── Process Solid handoff if present ──
      await processHandoff(proj.id);

      // Subscribe to sign types → build lookup map
      unsubTypes = getRepos().signTypes.subscribe(proj.id, (types) => {
        if (cancelled) return;
        const map: Record<string, SignType> = {};
        for (const t of types) {
          if (!t.archivedAt) map[t.id] = t;
        }
        setSignTypesMap(map);
      });

      // Subscribe to instances
      unsubInstances = subscribeInstances((insts) => {
        if (cancelled) return;
        setInstances(insts);
        setCurrentId((prev) => {
          if (prev && insts.some((i) => i.id === prev)) return prev;
          return insts[0]?.id ?? null;
        });
        // Auto-show map when starting fresh with no instances
        if (insts.length === 0) {
          setShowMapOverview(true);
        }
      });

      // Subscribe to destination places (active only — Phase 1 has no
      // archive-viewer UI). Repo filters by `archivedAt` server-side.
      unsubDestinations = getRepos().destinationPlaces.subscribe(
        proj.id,
        (list) => {
          if (cancelled) return;
          setDestinations(list);
        },
      );
    })();

    return () => {
      cancelled = true;
      unsubTypes?.();
      unsubInstances?.();
      unsubDestinations?.();
    };
  }, [processHandoff, processCrossAppArchiveQueue]);

  // Reviewer name prompt — returns a promise that resolves when the user enters a name
  const requireReviewer = useCallback((): Promise<string | null> => {
    if (reviewerName) return Promise.resolve(reviewerName);
    return new Promise((resolve) => {
      nameResolveRef.current = resolve;
      setNameInput('');
      setShowNamePrompt(true);
    });
  }, [reviewerName]);

  const handleNameSubmit = useCallback(() => {
    const name = nameInput.trim();
    if (!name) return;
    setReviewerName(name);
    localStorage.setItem('sosisu:signal:reviewer', name);
    setShowNamePrompt(false);
    nameResolveRef.current?.(name);
    nameResolveRef.current = null;
  }, [nameInput]);

  const handleNameCancel = useCallback(() => {
    setShowNamePrompt(false);
    nameResolveRef.current?.(null);
    nameResolveRef.current = null;
  }, []);

  const handleSetReviewer = useCallback(() => {
    setNameInput(reviewerName ?? '');
    setShowNamePrompt(true);
    nameResolveRef.current = (_name) => {
      // Just setting name, no action pending
    };
  }, [reviewerName]);

  // ── Placement mode ──
  const handlePlaceType = useCallback((signTypeId: string) => {
    setPlacingTypeId(signTypeId);
    // Entering sign placement cancels any destination placement in flight
    // — they'd collide on the map click handler otherwise.
    setPlacingDestination(false);
    setShowMapOverview(true);
  }, []);

  const handlePlaceSign = useCallback(
    (lat: number, lng: number) => {
      if (!placingTypeId) return;
      const st = signTypesMap[placingTypeId];
      const inst = addInstance(placingTypeId, lat, lng, st?.code);
      console.log('[place] Created instance:', inst.id, 'at', lat.toFixed(5), lng.toFixed(5));
      // Stay in placement mode for rapid placement
    },
    [placingTypeId, signTypesMap],
  );

  const handleCancelPlace = useCallback(() => {
    setPlacingTypeId(null);
  }, []);

  const handleDeleteInstance = useCallback(
    (id: string) => {
      deleteInstance(id);
      // If we just deleted the current one, clear selection
      setCurrentId((prev) => (prev === id ? null : prev));
    },
    [],
  );

  const handleDeleteType = useCallback(
    async (signTypeId: string) => {
      if (!project) return;
      // Archive the sign type (soft delete)
      await getRepos().signTypes.archive(project.id, signTypeId);
      // Delete all instances of this type
      const toDelete = instances.filter((i) => i.signTypeId === signTypeId);
      for (const inst of toDelete) {
        deleteInstance(inst.id);
      }
      // Clear selection if the current instance was of this type
      setCurrentId((prev) => {
        if (prev && toDelete.some((i) => i.id === prev)) return null;
        return prev;
      });
    },
    [project, instances],
  );

  // ── Destination placement + drag ──────────────────────────────────────
  const handlePlaceDestinationOnMap = useCallback(() => {
    // Entering destination placement cancels any sign placement in flight.
    setPlacingTypeId(null);
    setPlacingDestination(true);
    setShowMapOverview(true);
  }, []);

  const handlePlaceDestinationAt = useCallback((lat: number, lng: number) => {
    // Exit placement mode, pop back to the sidebar, and hand the coords
    // to DestinationsPanel so the add form opens pre-populated.
    setPlacingDestination(false);
    setShowMapOverview(false);
    setPrefilledDestCoords({ lat, lng });
  }, []);

  const handleCancelPlaceDestination = useCallback(() => {
    setPlacingDestination(false);
  }, []);

  const handleClearPrefilledDest = useCallback(() => {
    setPrefilledDestCoords(null);
  }, []);

  const handleUpdateDestination = useCallback(
    async (dest: DestinationPlace) => {
      if (!project) return;
      // Drag-to-move: repo's `save()` is create-or-update by id, so
      // forwarding the whole record with the new lat/lng is enough.
      // updatedAt is rewritten server-side; we don't need to touch it.
      const attribution =
        reviewerName?.trim() ||
        (auth.status === 'signed-in'
          ? auth.user.displayName || auth.user.email || auth.user.uid
          : dest.updatedBy);
      await getRepos().destinationPlaces.save(project.id, {
        ...dest,
        updatedBy: attribution,
      });
    },
    [project, reviewerName, auth],
  );

  // ── Destinations ───────────────────────────────────────────────────────
  const handleCreateDestination = useCallback(
    async (input: {
      name: string;
      lat: number;
      lng: number;
      tier: DestinationTier;
      district?: string;
      /** Phase 5: anchor flag. When true, this destination shows up on
       *  Map (anchors-only) signs. */
      isAnchor?: boolean;
    }) => {
      if (!project) return;
      // Use the reviewer display name for attribution; fall back to the
      // auth user's display name / email so the record always carries a
      // human-readable creator (schema requires min-1 string).
      const attribution =
        reviewerName?.trim() ||
        (auth.status === 'signed-in'
          ? auth.user.displayName || auth.user.email || auth.user.uid
          : 'demo');
      const dest = blankDestinationPlace({
        projectId: project.id,
        name: input.name,
        lat: input.lat,
        lng: input.lng,
        tier: input.tier,
        createdBy: attribution,
        ...(input.district && { district: input.district }),
        ...(input.isAnchor !== undefined && { isAnchor: input.isAnchor }),
      });
      await getRepos().destinationPlaces.save(project.id, dest);
    },
    [project, reviewerName, auth],
  );

  const handleArchiveDestination = useCallback(
    async (destinationPlaceId: string) => {
      if (!project) return;
      await getRepos().destinationPlaces.archive(project.id, destinationPlaceId);
    },
    [project],
  );

  // ── Sign type update (Phase 5 — policy editing in TYPES admin) ─────
  // Persists the SignType record and, when one of the policy fields
  // (capacityPerSide / anchorsOnly / maxWalkMinutes) changed,
  // surfaces a regenerate prompt for all signs of that type.
  // The prompt is a confirm dialog rather than a real toast for
  // implementation simplicity — same effect, no new toast system.
  const handleUpdateSignType = useCallback(
    async (next: SignType, policyChanged: boolean) => {
      if (!project) return;
      await getRepos().signTypes.save(project.id, {
        ...next,
        updatedAt: new Date().toISOString(),
      });
      if (!policyChanged) return;
      // Find affected instances. If there are zero, no point asking.
      const affected = instances.filter((i) => i.signTypeId === next.id);
      if (affected.length === 0) return;
      const label = next.code || next.name || 'this type';
      const ok = confirm(
        `${label} policy changed. Re-generate ${affected.length} sign${
          affected.length === 1 ? '' : 's'
        } now?`,
      );
      if (!ok) return;
      const effectiveConfig = project.scoringConfig ?? DEFAULT_SCORING_CONFIG;
      // Build a fresh signTypes array with the just-updated record so
      // policyForSignType resolves to the new values.
      const allTypes = Object.values(signTypesMap).map((st) =>
        st.id === next.id ? next : st,
      );
      const result = generateAllSignSchedules({
        instances,
        destinations,
        signTypes: allTypes,
        config: effectiveConfig,
        mode: 'replace-auto',
        now: new Date(),
      });
      setInstanceStore(result.updatedInstances);
      const projectNow = new Date().toISOString();
      const updatedProject: SosisuProject = {
        ...project,
        lastGeneratedAt: projectNow,
        updatedAt: projectNow,
      };
      await getRepos().projects.save(updatedProject);
      setProject(updatedProject);
    },
    [project, instances, destinations, signTypesMap],
  );

  // ── CU Boulder demo seed ──────────────────────────────────────────────
  // Demo-mode-only convenience: drop the active project's data and
  // replace it with 4 sign types, 118 sign instances, and 152
  // destinations sourced from the CU Boulder Messaging MKI v1 sheet.
  // Hidden when a real Firebase project is wired so production data
  // never gets mass-overwritten.
  const isDemoMode = !import.meta.env.VITE_FIREBASE_CONFIG;

  const handleLoadCuBoulderSample = useCallback(async () => {
    if (!project) return;
    if (
      !confirm(
        'This will replace the current demo project with the CU Boulder sample. Continue?',
      )
    ) {
      return;
    }
    const seed = buildCuBoulderSeed({ projectId: project.id });
    const repos = getRepos();

    // Drop existing data — archive types + destinations, wipe instances.
    // Stable IDs in the seed mean re-clicking the button overwrites in
    // place, but we still archive prior records so the previous demo
    // doesn't bleed through if the user had hand-created any.
    const existingTypes = await repos.signTypes.list(project.id);
    for (const t of existingTypes) {
      if (!t.archivedAt) await repos.signTypes.archive(project.id, t.id);
    }
    const existingDests = await repos.destinationPlaces.list(project.id);
    for (const d of existingDests) {
      if (!d.archivedAt) await repos.destinationPlaces.archive(project.id, d.id);
    }

    // Update project metadata (name + client) without changing the id.
    const now = new Date().toISOString();
    const updatedProject: SosisuProject = {
      ...project,
      name: seed.project.name,
      client: seed.project.client,
      updatedAt: now,
      // Wipe Phase 4 state so the dashboard re-shows its first-time
      // "Generate schedules" CTA. Previously a stale `scoringConfig`
      // (e.g. topNPerSide=8 from before the cap dropped to 4) would
      // override the new default and cause row accumulation on the
      // first Generate run.
      lastGeneratedAt: undefined,
      scoringConfig: undefined,
    };
    await repos.projects.save(updatedProject);
    setProject(updatedProject);

    // Save sign types + destinations.
    for (const st of seed.signTypes) {
      await repos.signTypes.save(project.id, st);
    }
    for (const dest of seed.destinations) {
      await repos.destinationPlaces.save(project.id, dest);
    }

    // Replace instances wholesale (Signal manages instances locally,
    // not via the platform repos — see lib/instances.ts).
    setInstanceStore(seed.instances);

    alert(
      `Loaded CU Boulder sample: ${seed.signTypes.length} sign types, ${seed.instances.length} signs, ${seed.destinations.length} destinations.`,
    );
    // Land on the Project Dashboard so the next action — "Generate
    // schedules" — is one click away.
    setShowMapOverview(false);
    setViewMode('project');
  }, [project]);

  // ── Phase 4 follow-up: reset scoringConfig back to defaults ──────────
  // Reviewer-driven escape hatch when a project carries a stale
  // scoringConfig from a previous default (e.g. topNPerSide=8 from
  // before the cap dropped to 4). Surfaced in the dashboard's Advanced
  // settings panel via `storedDiffersFromDefaults`.
  const handleResetScoringConfig = useCallback(async () => {
    if (!project) return;
    const updated: SosisuProject = {
      ...project,
      scoringConfig: DEFAULT_SCORING_CONFIG,
      updatedAt: new Date().toISOString(),
    };
    await getRepos().projects.save(updated);
    setProject(updated);
  }, [project]);

  // ── Phase 4: bulk schedule generator + Resume review ─────────────────
  const handleGenerateSchedules = useCallback(
    async (config: ScoringConfig) => {
      if (!project) return;

      // Count manual rows up front so we can ask the right question.
      // Re-generation prompts only fire after a previous run; the
      // first-time CTA on the dashboard is enough confirmation on its
      // own.
      const everGenerated = !!project.lastGeneratedAt;
      let mode: 'replace-auto' | 'replace-all' = 'replace-auto';
      if (everGenerated) {
        const manualCount = instances.reduce((n, inst) => {
          for (const side of inst.sides) {
            for (const row of side.destinations) {
              if (row.auto !== true) n++;
            }
          }
          return n;
        }, 0);
        if (manualCount === 0) {
          if (
            !confirm(
              'Re-generating will replace all existing auto-generated rows. Continue?',
            )
          )
            return;
        } else {
          // Three-way choice via two confirms — `prompt` would be more
          // expressive, but Phase 4 spec keeps the dialogs native.
          // First confirm: "keep manual edits"; second (only if
          // declined): "replace everything"; otherwise cancel.
          const keep = confirm(
            `Re-generating: ${manualCount} manual row(s) on this project.\n\n` +
              'OK = keep manual edits (recommended)\n' +
              'Cancel = choose to replace everything or abort',
          );
          if (keep) {
            mode = 'replace-auto';
          } else {
            const replaceAll = confirm(
              'Replace EVERYTHING — including manual edits — on every sign?',
            );
            if (!replaceAll) return;
            mode = 'replace-all';
          }
        }
      }

      setGenerating(true);
      try {
        const { updatedInstances, summary } = generateAllSignSchedules({
          instances,
          destinations,
          // Phase 5: thread the project's sign types so the generator
          // can dispatch off SignType.code → SignTypePolicy. Empty
          // array would fall back to DEFAULT_POLICY for every sign.
          signTypes: Object.values(signTypesMap),
          config,
          mode,
          now: new Date(),
        });
        setInstanceStore(updatedInstances);

        // Persist project metadata (lastGeneratedAt + scoringConfig).
        const now = new Date().toISOString();
        const updatedProject: SosisuProject = {
          ...project,
          lastGeneratedAt: now,
          scoringConfig: config,
          updatedAt: now,
        };
        await getRepos().projects.save(updatedProject);
        setProject(updatedProject);

        const preserved =
          mode === 'replace-auto'
            ? summary.manualRowsPreserved
            : 0;
        alert(
          `Generated schedules: ${summary.signsProcessed} signs, ` +
            `${summary.rowsGenerated} rows, ${preserved} manual rows preserved.` +
            (summary.signsSkipped > 0
              ? `\n${summary.signsSkipped} sign(s) skipped (missing coords or facing).`
              : ''),
        );
      } finally {
        setGenerating(false);
      }
    },
    [project, instances, destinations, signTypesMap],
  );

  const handleResumeReview = useCallback(
    (signId?: string) => {
      const target = signId ?? instances.find((i) => i.reviewStatus === 'pending')?.id;
      if (target) setCurrentId(target);
      setViewMode('instances');
      setShowMapOverview(false);
      setShowBuildingNames(false);
    },
    [instances],
  );

  // ── Phase 4 follow-up: live single-sign regen on facing change ────────
  // Used by SignCard's facing dial in edit mode. Returns a freshly-
  // scheduled SignInstance against the *given* facing — does NOT
  // persist. The editor uses this for live preview while the user
  // cycles the dial; commit happens on Save edits.
  const regenerateOneSign = useCallback(
    (instance: SignInstance, facing: FacingDirection): SignInstance => {
      if (!project) return instance;
      const effectiveConfig = project.scoringConfig ?? DEFAULT_SCORING_CONFIG;
      const result = generateAllSignSchedules({
        instances: [{ ...instance, facing }],
        destinations,
        // Phase 5: even single-sign live preview needs the policy
        // dispatch — a Map sign should preview against anchors only.
        signTypes: Object.values(signTypesMap),
        config: effectiveConfig,
        mode: 'replace-auto',
      });
      return result.updatedInstances[0] ?? instance;
    },
    [project, destinations, signTypesMap],
  );

  const handleResetProject = useCallback(async () => {
    if (
      !confirm(
        'Reset to a new project? This clears all sign types, instances, destinations, buildings, and the project name. This cannot be undone.',
      )
    )
      return;
    if (project) {
      // Archive all sign types
      const types = await getRepos().signTypes.list(project.id);
      for (const t of types) {
        await getRepos().signTypes.archive(project.id, t.id);
      }
      // Archive all destinations
      const dests = await getRepos().destinationPlaces.list(project.id);
      for (const d of dests) {
        await getRepos().destinationPlaces.archive(project.id, d.id);
      }
    }
    resetInstances();
    // Phase 6 — reset now ALSO clears project metadata (name, client,
    // buildings, scoringConfig, lastGeneratedAt). Pre-Phase-6, hitting
    // Reset on a CU-Boulder-seeded project archived the types but left
    // `project.name = 'CU Boulder Campus Wayfinding'` in place, which
    // read as "still on the demo" even though every other artefact
    // was gone. Genuine clean-slate means the project metadata zeros
    // out too — the user can rename / re-handoff from there.
    if (project) {
      const updatedProject: SosisuProject = {
        ...project,
        name: 'Untitled Project',
        client: '',
        buildings: [],
        scoringConfig: undefined,
        lastGeneratedAt: undefined,
        updatedAt: new Date().toISOString(),
      };
      await getRepos().projects.save(updatedProject);
      setProject(updatedProject);
    }
    setShowMapOverview(false);
    setViewMode('project');
  }, [project]);

  const handleBuildingsImported = useCallback(
    async (buildings: Building[]) => {
      if (!project) return;
      // Persist buildings on the project — merge, replacing by code
      const existing = project.buildings ?? [];
      const byCode = new Map(existing.map((b) => [b.code, b]));
      for (const b of buildings) byCode.set(b.code, b);
      const merged = [...byCode.values()];
      const updated = { ...project, buildings: merged, updatedAt: new Date().toISOString() };
      setProject(updated);
      getRepos().projects.save(updated);

      // B1 Bug #4/#5 — bridge the imported buildings into the scored
      // DestinationPlace set. Pre-fix, the import landed only on
      // `project.buildings`, which nothing reads; the schedule
      // generator scores `DestinationPlace[]`, so a Tufts import
      // produced zero destinations and "Generate messaging" had nothing
      // to point signs at. Dedup by name → re-imports update in place.
      const attribution =
        reviewerName?.trim() ||
        (auth.status === 'signed-in'
          ? auth.user.displayName || auth.user.email || auth.user.uid
          : 'demo');
      const { merged: mergedDests, upserted } = mergeBuildingsIntoDestinations(
        buildings,
        destinations,
        { projectId: project.id, createdBy: attribution },
      );
      if (upserted.length > 0) {
        setDestinations(mergedDests);
        await Promise.all(
          upserted.map((d) => getRepos().destinationPlaces.save(project.id, d)),
        );
      }
    },
    [project, destinations, reviewerName, auth],
  );

  // Filtered list
  const filtered = filter
    ? instances.filter((inst) => {
        const st = signTypesMap[inst.signTypeId];
        return st?.code === filter;
      })
    : instances;

  const currentIndex = filtered.findIndex((i) => i.id === currentId);
  const currentInstance = currentIndex >= 0 ? filtered[currentIndex] : null;

  const goTo = useCallback((id: string) => {
    setCurrentId(id);
    setShowMapOverview(false);
    setPlacingTypeId(null);
    mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const goNext = useCallback(() => {
    if (currentIndex < filtered.length - 1) {
      goTo(filtered[currentIndex + 1]!.id);
    }
  }, [currentIndex, filtered, goTo]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) {
      goTo(filtered[currentIndex - 1]!.id);
    }
  }, [currentIndex, filtered, goTo]);

  const handleExport = useCallback(() => {
    const header = ['Sign ID', 'Type', 'Location', 'Neighborhood', 'Lat', 'Lng', 'Status', 'Notes'];
    const rows = instances.map((inst) => {
      const st = signTypesMap[inst.signTypeId];
      return [
        inst.id,
        st?.code ?? '',
        inst.location,
        inst.neighborhood ?? '',
        inst.lat?.toString() ?? '',
        inst.lng?.toString() ?? '',
        inst.reviewStatus,
        inst.notes ?? '',
      ].map((v) => (v.includes(',') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v)).join(',');
    });
    const csv = [header.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `messaging_reviewed_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }, [instances, signTypesMap]);

  // Auth gate
  if (auth.status === 'loading') {
    return <div className="loading-screen">Loading…</div>;
  }
  if (auth.status === 'signed-out') {
    return <LoginScreen authClient={getAuthClient()} product="signal" />;
  }

  if (!project) {
    return <div className="loading-screen">Loading project…</div>;
  }

  return (
    <div className="app-shell">
      {/* ── SOSISU SUITE NAV ── */}
      <SuiteNav activeProduct="signal" />

      <div className="app-layout">
      <Sidebar
        projectName={project.name}
        projectClient={project.client}
        instances={instances}
        signTypes={signTypesMap}
        destinations={destinations}
        currentId={currentId}
        filter={filter}
        onFilterChange={setFilter}
        onSelect={goTo}
        onThemeToggle={toggleTheme}
        isDark={isDark}
        reviewerName={reviewerName}
        onSetReviewer={handleSetReviewer}
        onMapOverview={() => setShowMapOverview((v) => !v)}
        onExport={handleExport}
        onPlaceType={handlePlaceType}
        onDeleteType={handleDeleteType}
        onDeleteInstance={handleDeleteInstance}
        onResetProject={handleResetProject}
        onImport={() => setShowImport(true)}
        onCreateDestination={handleCreateDestination}
        onArchiveDestination={handleArchiveDestination}
        onOpenBuildingNames={() => setShowBuildingNames(true)}
        onUpdateSignType={handleUpdateSignType}
        {...(isDemoMode && { onLoadCuBoulderSample: handleLoadCuBoulderSample })}
        onPlaceDestinationOnMap={handlePlaceDestinationOnMap}
        prefilledDestinationCoords={prefilledDestCoords}
        onClearPrefilledDestination={handleClearPrefilledDest}
        maptilerKey={
          (import.meta.env.VITE_MAPTILER_KEY as string | undefined) ?? ''
        }
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />
      <main className="main-panel" ref={mainRef}>
        {viewMode === 'project' ? (
          <ProjectDashboard
            project={project}
            instances={instances}
            signTypes={signTypesMap}
            destinations={destinations}
            isDark={isDark}
            onGenerate={handleGenerateSchedules}
            onResumeReview={handleResumeReview}
            onSelectSign={(id) => {
              goTo(id);
              setViewMode('instances');
            }}
            generating={generating}
            onResetConfigToDefaults={handleResetScoringConfig}
          />
        ) : showBuildingNames ? (
          <BuildingNames
            destinations={destinations}
            instances={instances}
            onUpdate={handleUpdateDestination}
            onClose={() => setShowBuildingNames(false)}
          />
        ) : showMapOverview ? (
          <MapOverview
            instances={instances}
            signTypes={signTypesMap}
            isDark={isDark}
            onSelectSign={(id) => {
              setShowMapOverview(false);
              setPlacingTypeId(null);
              setPlacingDestination(false);
              goTo(id);
            }}
            onClose={() => {
              setShowMapOverview(false);
              setPlacingTypeId(null);
              setPlacingDestination(false);
            }}
            placingTypeId={placingTypeId}
            onPlaceSign={handlePlaceSign}
            onCancelPlace={handleCancelPlace}
            selectedSignId={currentId}
            destinations={destinations}
            placingDestination={placingDestination}
            onPlaceDestination={handlePlaceDestinationAt}
            onCancelPlaceDestination={handleCancelPlaceDestination}
            onUpdateDestination={handleUpdateDestination}
          />
        ) : (
          <div className="panel-inner">
            {currentInstance ? (
              <SignCard
                key={`${currentInstance.id}-${currentInstance.updatedAt}`}
                instance={currentInstance}
                signType={signTypesMap[currentInstance.signTypeId]}
                allInstances={instances}
                signTypes={signTypesMap}
                onNext={goNext}
                onPrev={goPrev}
                canNext={currentIndex < filtered.length - 1}
                canPrev={currentIndex > 0}
                index={currentIndex}
                total={filtered.length}
                allFiltered={filtered}
                onGoTo={goTo}
                reviewerName={reviewerName}
                onRequireReviewer={requireReviewer}
                onDeleteInstance={handleDeleteInstance}
                destinations={destinations}
                onRegenerateOneSign={regenerateOneSign}
                isDark={isDark}
              />
            ) : (
              <div className="empty-state">
                {Object.keys(signTypesMap).length === 0
                  ? 'No sign types yet. Create one in Solid, then hand off to Signal.'
                  : instances.length === 0
                    ? 'No instances placed yet. Switch to the Types tab and click "+ Place" to place signs on the map.'
                    : 'No signs match the current filter.'}
              </div>
            )}
          </div>
        )}
      </main>
      <RightPanel
        instance={currentInstance}
        allInstances={instances}
        reviewerName={reviewerName}
        onRequireReviewer={requireReviewer}
        onBuildingNames={() => setShowBuildingNames(true)}
        onMapOverview={() => setShowMapOverview((v) => !v)}
        onExport={handleExport}
        onGoToSign={goTo}
      />

      {/* Import modal */}
      {showImport && (
        <ImportModal
          signTypes={signTypesMap}
          onClose={() => setShowImport(false)}
          onBuildingsImported={handleBuildingsImported}
        />
      )}

      {/* Reviewer name prompt overlay */}
      {showNamePrompt && (
        <div className="user-prompt-overlay" onClick={handleNameCancel}>
          <div className="user-prompt-card" onClick={(e) => e.stopPropagation()}>
            <div className="user-prompt-title">Who are you?</div>
            <div className="user-prompt-sub">
              Your name will appear on all approvals, edits, and flags so the
              whole team can see who reviewed what.
            </div>
            <input
              className="user-prompt-input"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleNameSubmit()}
              placeholder="Your name"
              maxLength={40}
              autoFocus
            />
            <button className="user-prompt-btn" onClick={handleNameSubmit}>
              Start reviewing
            </button>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}
