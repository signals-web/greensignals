// ─── CU Boulder demo seed — pure transform ────────────────────────────────
//
// CSV rows in, platform model records out. Pure function with no IO —
// the only side-channel is `console.warn` for skipped rows so future
// data-quality issues surface without crashing the seed.
//
// Why a separate file from `./loadSeed.ts`:
//   - Testable in isolation (the test fixture passes in small inline
//     CSV strings rather than depending on the live CSV files).
//   - The transform encodes a handful of decisions Chris explicitly
//     locked: tier 1/2/3 → campus/building/building (no 'room'),
//     district whitelist of 5, default facing = 'N' for every sign.
//     Keeping them here makes those rules grep-able.

import {
  loadCuBoulderSigns,
  loadCuBoulderDestinations,
  type SignRow,
  type DestinationRow,
} from './loadSeed.ts';
import type {
  DestinationPlace,
  DestinationTier,
  SignInstance,
  SignType,
  SosisuProject,
} from '../../platform/index.ts';

// ─── Constants ────────────────────────────────────────────────────────────

/** Stable project id for the demo seed. The actual save uses the active
 *  demo project's id (whatever `ensureDemoProject` minted) and only
 *  copies metadata (name / client) over — so this value is informational. */
const SEED_PROJECT_ID = 'cu-bldr-demo';
const SEED_PROJECT_NAME = 'CU Boulder Campus Wayfinding';
const SEED_PROJECT_CLIENT = 'University of Colorado Boulder';
const SEED_OWNER_UID = 'demo-user';

/** Whitelist of district names. Anything else gets the row skipped with
 *  a warn log. The five strings are the canonical title-case forms;
 *  normalisation maps uppercase / odd-spaced inputs onto these. */
const VALID_DISTRICTS = [
  'Main Campus',
  'East Campus',
  'Williams Village',
  'Grandview',
  'North Boulder Creek',
] as const;

type District = (typeof VALID_DISTRICTS)[number];

const DISTRICT_LOOKUP = new Map<string, District>(
  VALID_DISTRICTS.map((d) => [d.toLowerCase(), d]),
);

/** Tier 1/2/3 from the source CSV → DestinationTier enum. Three numeric
 *  tiers collapse to two enum values on purpose (Chris's call) — tier-3
 *  destinations become `building` rather than `room`. The seed must
 *  never write `'room'`. */
const TIER_MAP: Record<string, DestinationTier> = {
  '1': 'campus',
  '2': 'building',
  '3': 'building',
};

/** Sign type definitions for the four CSV codes (M / N / PM / SD).
 *  Dimensions are placeholder defaults — fabrication detail isn't part
 *  of the demo. Categories slot into the existing `SignCategory` enum. */
const SIGN_TYPE_DEFS: Array<{
  code: 'M' | 'N' | 'PM' | 'SD';
  name: string;
  category: SignType['category'];
  mountType: SignType['mountType'];
  dimensionsMM: SignType['dimensionsMM'];
}> = [
  {
    code: 'M',
    name: 'Map',
    category: 'informational',
    mountType: 'freestanding',
    dimensionsMM: { w: 2400, h: 900, d: 60 },
  },
  {
    code: 'N',
    name: 'Nudge',
    category: 'directional',
    mountType: 'post',
    dimensionsMM: { w: 1500, h: 450, d: 60 },
  },
  {
    code: 'PM',
    name: 'Primary Destination',
    category: 'directional',
    mountType: 'post',
    dimensionsMM: { w: 2700, h: 900, d: 60 },
  },
  {
    code: 'SD',
    name: 'Secondary Destination',
    category: 'directional',
    mountType: 'post',
    dimensionsMM: { w: 1800, h: 750, d: 60 },
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────

function normaliseDistrict(raw: string): District | null {
  const key = raw.trim().toLowerCase();
  return DISTRICT_LOOKUP.get(key) ?? null;
}

function parseLatLng(latRaw: string, lngRaw: string): { lat: number; lng: number } | null {
  // Trim then reject empty — `Number('')` is 0, not NaN, so without an
  // empty-check we'd silently coerce missing coords to (0, 0) and drop
  // a sign in the Atlantic. Same trap with `Number(undefined)` / null.
  const latStr = (latRaw ?? '').trim();
  const lngStr = (lngRaw ?? '').trim();
  if (!latStr || !lngStr) return null;
  const lat = Number(latStr);
  const lng = Number(lngStr);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return null;
  }
  return { lat, lng };
}

/** Slugify "DEST_ID_FOO" → "dest-id-foo". Stable IDs use this so the
 *  same source row produces the same DestinationPlace id on every
 *  re-seed. */
function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ─── Main transform ───────────────────────────────────────────────────────

export interface CuBoulderSeed {
  project: SosisuProject;
  signTypes: SignType[];
  instances: SignInstance[];
  destinations: DestinationPlace[];
}

export interface BuildSeedOptions {
  /** Override the project id baked into seed records. Defaults to the
   *  hard-coded SEED_PROJECT_ID; the App-level loader replaces it with
   *  the active demo project's id at save time. */
  projectId?: string;
  /** Inject row data directly. Tests use this; production callers omit
   *  it so the live CSVs are loaded. */
  signRows?: SignRow[];
  destinationRows?: DestinationRow[];
  /** Inject a clock so tests can assert deterministic timestamps. */
  now?: Date;
}

/** Build the full CU Boulder demo seed. Pure — given the same inputs,
 *  always returns the same record set. Skipped rows are logged once
 *  per call via `console.warn`. */
export function buildCuBoulderSeed(options: BuildSeedOptions = {}): CuBoulderSeed {
  const projectId = options.projectId ?? SEED_PROJECT_ID;
  const signRows = options.signRows ?? loadCuBoulderSigns();
  const destinationRows = options.destinationRows ?? loadCuBoulderDestinations();
  const now = (options.now ?? new Date()).toISOString();

  // ── Sign types ──
  const signTypes: SignType[] = SIGN_TYPE_DEFS.map((def) => ({
    id: `cu-bldr-st-${def.code}`,
    code: def.code,
    name: def.name,
    category: def.category,
    dimensionsMM: def.dimensionsMM,
    copy: [],
    materials: [],
    mountType: def.mountType,
    createdAt: now,
    updatedAt: now,
  }));
  const signTypeByCode = new Map(signTypes.map((st) => [st.code, st]));

  // ── Sign instances ──
  // Dedup by `cu-bldr-sign-{type}-{number}` — the source CSV has at
  // least one duplicate (Type, Number) pair, and stable IDs need to
  // remain unique. First occurrence wins; subsequent ones warn.
  const instances: SignInstance[] = [];
  const seenInstanceIds = new Set<string>();
  for (const row of signRows) {
    const code = row.Type?.trim();
    if (!code || !signTypeByCode.has(code)) {
      console.warn('[cuBoulder seed] skipped sign row, unknown type:', row);
      continue;
    }
    const coords = parseLatLng(row.Lat, row.Lng);
    if (!coords) {
      console.warn('[cuBoulder seed] skipped sign row, bad coords:', row);
      continue;
    }
    const id = `cu-bldr-sign-${code}-${row.Number.trim()}`;
    if (seenInstanceIds.has(id)) {
      console.warn('[cuBoulder seed] skipped sign row, duplicate id:', id, row);
      continue;
    }
    seenInstanceIds.add(id);
    const district = normaliseDistrict(row.Neighborhood);
    instances.push({
      id,
      signTypeId: signTypeByCode.get(code)!.id,
      location: '',
      // `facing` defaults to 'N' (due north). The CSV's Facing column
      // is a district label, not a compass bearing — Chris adjusts
      // facing manually as he tests scoring against real data. Lock
      // is explicit-false here so the dial is interactive on first
      // open without needing a padlock click.
      facing: 'N',
      directionLocked: false,
      lat: coords.lat,
      lng: coords.lng,
      ...(district && { neighborhood: district }),
      sides: [],
      reviewStatus: 'pending',
      createdAt: now,
      updatedAt: now,
    });
  }

  // ── Destination places ──
  const destinations: DestinationPlace[] = [];
  for (const row of destinationRows) {
    const id = row['Dest ID']?.trim();
    const name = row.Name?.trim();
    if (!id || !name) {
      console.warn('[cuBoulder seed] skipped destination row, missing id/name:', row);
      continue;
    }
    const coords = parseLatLng(row.Lat, row.Lng);
    if (!coords) {
      console.warn('[cuBoulder seed] skipped destination row, bad coords:', row);
      continue;
    }
    const district = normaliseDistrict(row.District);
    if (!district) {
      console.warn(
        '[cuBoulder seed] skipped destination row, unrecognised district:',
        row.District,
        row,
      );
      continue;
    }
    const tier = TIER_MAP[row.Tier?.trim()];
    if (!tier) {
      console.warn(
        '[cuBoulder seed] skipped destination row, unrecognised tier:',
        row.Tier,
        row,
      );
      continue;
    }
    destinations.push({
      id: `cu-bldr-dest-${slugify(id)}`,
      projectId,
      name,
      lat: coords.lat,
      lng: coords.lng,
      tier,
      district,
      ...(row.Notes?.trim() && { notes: row.Notes.trim() }),
      createdAt: now,
      updatedAt: now,
      createdBy: 'CU Boulder Messaging MKI v1 sheet',
      updatedBy: 'CU Boulder Messaging MKI v1 sheet',
    });
  }

  // ── Project shell ──
  const project: SosisuProject = {
    id: projectId,
    name: SEED_PROJECT_NAME,
    client: SEED_PROJECT_CLIENT,
    ownerUid: SEED_OWNER_UID,
    members: [
      {
        uid: SEED_OWNER_UID,
        email: 'demo@sosisu.app',
        displayName: 'Demo User',
        role: 'owner',
        addedAt: now,
      },
    ],
    memberUids: [SEED_OWNER_UID],
    memberRoles: { [SEED_OWNER_UID]: 'owner' },
    // The platform's SosisuProject keeps these as embedded arrays for
    // schema compatibility, but the actual records live in subcollections
    // / Signal-local stores after save. Keeping them empty here matches
    // the convention `blankSosisuProject` establishes.
    signTypes: [],
    instances: [],
    buildings: [],
    createdAt: now,
    updatedAt: now,
  };

  return { project, signTypes, instances, destinations };
}
