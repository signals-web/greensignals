// ─── Short-name generator — Phase 5b ──────────────────────────────────────
//
// Faithful port of the v1 Signal app's rules-based short-name generator
// (`code/signal/scripts/generate-short-names.js`). Three-stage pipeline,
// in order of precedence:
//
//   1. PASSTHROUGH  — names already short enough to leave untouched
//      ("Macky Auditorium", "Old Main", "Hillside"). Returns empty
//      string ("the existing name is fine").
//   2. MANUAL       — hand-curated overrides for names that need human
//      judgment ("UMC" for "University Memorial Center", "ARC East"
//      for "Administrative and Research Center- East Campus"). The
//      manual table is the v1 algorithm's single source of acronym
//      knowledge.
//   3. ALGORITHMIC  — regex-based stripping of generic facility nouns,
//      admin qualifiers, redundant location tags, and over-specific
//      filler. Whatever survives is the suggestion.
//
// Both the v1 JS and this TS port treat "shortName equals the original"
// as "no shortening to suggest" — return empty string. That keeps the
// stored shape consistent: empty `shortName` always means "fall back to
// `name`" at render time.
//
// Pure functions, no IO. The campus-specific manual + passthrough
// tables are CU Boulder–biased; future projects extend by adding
// entries here. Keeping them inline (rather than in a JSON config)
// matches the v1 source and keeps the regression test trivial.

/** Names already short enough — pass through unchanged. */
const PASSTHROUGH = new Set<string>([
  'Bosque', 'Buff Walk', 'Buffalo Statue', 'CU Police', 'Hillside',
  'Irrigation Pond', 'Kittredge Central', 'Kittredge Lawn', 'Kittredge Ponds',
  'Libby Hall', 'Macky Auditorium', 'Marine Court', 'NE Court', 'NW Court',
  'Norlin Library', 'Old Main', 'Prentup Field', 'Rec Fields', 'Reed Hall',
  'Smiley Court', 'Smith Hall', 'University Club', 'University Residence',
  'Varsity Bridge', 'Weber Hall', 'Will Vill Volleyball',
  'Andrews Hall', 'Arnett Hall', 'Athens Court', 'Buckingham Hall',
  'Cockerell Hall', 'Crosman Hall', 'Farrand Hall', 'Hallett Hall',
]);

/** Hand-curated overrides for names where the algorithm can't produce
 *  the correct shortening on its own (acronyms, numerics, ampersands).
 *  The v1 source is the canonical reference. */
const MANUAL: Record<string, string> = {
  '19th Street Bridge': '19th St Bridge',
  '22nd Street Bridge': '22nd St Bridge',
  'Administrative and Research Center- East Campus': 'ARC East',
  'Aerospace Engineering Sciences': 'Aerospace Engineering',
  'Arts and Sciences Office Building 1': 'A&S Office 1',
  'Bear Creek Basketball': 'Bear Creek Basketball',
  'Bear Creek Volleyball': 'Bear Creek Volleyball',
  'Benson Earth Sciences Building': 'Benson Earth Sciences',
  'Bryan Benjamin Sax Ski Team Buildng': 'Sax Ski Team',
  'Center for Academic Success and Engagement': 'CASE',
  'Center for Innovation and Creativity': 'CIC',
  'Center for Innovation and Creativity Pavilion': 'CIC Pavilion',
  'Continuing Education Center': 'Continuing Ed',
  'Cristol Chemistry and Biochemistry Building': 'Cristol Chemistry',
  'Darley Towers North': 'Darley North',
  'Darley Towers South': 'Darley South',
  'Drescher Undrgrd Eng Int Teaching and Learning Lab': 'ITLL',
  'Duane Physics': 'Duane Physics',
  'Eaton Humanities Building': 'Eaton Humanities',
  'Economics Building': 'Economics',
  'Ekeley Sciences Building': 'Ekeley Sciences',
  'Engineering Center North Wing': 'Engineering North',
  'Environmental Design Building': 'Environmental Design',
  'Events Buffalo Patio': 'Buffalo Patio',
  'Faculty-Staff Court': 'Faculty-Staff Court',
  'Family Housing Basketball': 'Family Housing Basketball',
  'Family Housing Volleyball': 'Family Housing Volleyball',
  'Fiske Planetarium and Science Center': 'Fiske Planetarium',
  'Gallogly Discovery Learning Center': 'Gallogly',
  'Gold Biosciences Building': 'Gold Biosciences',
  'Grounds and Recycling Operations Center': 'Grounds & Recycling',
  'Guggenheim Geography Building': 'Guggenheim Geography',
  'Hale Science Building': 'Hale Science',
  'Hellems Arts and Sciences Building': 'Hellems',
  'Henderson Building (Museum)': 'Henderson Museum',
  'Housing System Service Center': 'Housing Services',
  'Imig Music Building': 'Imig Music',
  'Institute for Behavioral Genetics': 'Behavioral Genetics',
  'Jennie Smoly Caruthers Biotechnology Building': 'Caruthers Biotech',
  'Kittredge Multiuse Field': 'Kittredge Field',
  'Kittredge Volleyball Courts': 'Kittredge Volleyball',
  'Kittredge West Hall': 'Kittredge West',
  'Koelbel Building - Leeds School of Business': 'Koelbel (Leeds)',
  'Koenig Alumni Center': 'Koenig Alumni',
  'Lasp Space Technology Research Center': 'LASP',
  'Life Science Research Lab (Rl4)': 'Life Science Lab (RL4)',
  'Limelight Conference Center and Hotel': 'Limelight',
  'Litman Research Lab (Rl1)': 'Litman Lab (RL1)',
  'Marine Street Science Center (Rl6)': 'Marine St Science (RL6)',
  'Mathematics Building': 'Mathematics',
  'Muenzinger Psychology and Nueroscience Building': 'Muenzinger',
  'New Physics Laboratory': 'New Physics Lab',
  'Nso Gong Building': 'NSO Gong',
  'Page Foundation Center': 'Page Foundation',
  'Police and Parking Services Center': 'Police & Parking',
  'Porter Biosciences': 'Porter Biosciences',
  'Potts/Prentup Concessions Building': 'Potts/Prentup Concessions',
  'Ramaley Biology Building': 'Ramaley Biology',
  'Regent Administrative Center': 'Regent Admin',
  'Regent Dr Autopark': 'Regent Autopark',
  'Research Lab No 2': 'Research Lab 2',
  'Research Park Lake 4': 'Research Park Lake',
  'Richard Jessor Building': 'Jessor',
  'Roser Atlas Center': 'Roser ATLAS',
  'Space Science Building': 'Space Science',
  'Stadium Building': 'Stadium',
  'Stadium Sky Box': 'Stadium Skybox',
  'Stadium Ticket Building': 'Stadium Tickets',
  'Stearns Towers Center': 'Stearns Towers',
  'Student Recreation Center': 'Student Rec',
  'Sustainabilty Energy and Environment Community': 'SEEC',
  'Transportation Center and Annex': 'Transportation',
  'Uchealth Champions Center': 'UCHealth Champions',
  'University Administrative Center': 'UAC',
  'University Administrative Center Annex': 'UAC Annex',
  'University Memorial Center': 'UMC',
  'Varsity Lake Quad': 'Varsity Lake Quad',
  'Visual Arts Complex': 'Visual Arts',
  'Wardenburg Student Health Center': 'Wardenburg',
  'Williams Village Dining and Community Commons': 'WV Dining Commons',
  'Williams Village East': 'WV East',
  'Williams Village North': 'WV North',
  'Williams Village Recreation Center': 'WV Rec',
  'Wolf Law Building': 'Wolf Law',
  'Woodbury Arts and Sciences Building': 'Woodbury',
};

// ─── Algorithmic-fallback regexes ────────────────────────────────────────
// Order matters at the call site (admin qualifiers strip first so
// "Center for X" → "X" rather than "for X"). All `gi` flags match the
// v1 source. Word-boundaries on \b keep partial matches in-tact
// (e.g., "Aircraft" doesn't match "and").

/** Generic facility nouns. Strip when not the primary identifier. */
const GENERIC_FACILITY = /\b(Building|Center|Complex|Facility|Hall|Pavilion|Annex|Wing|Commons|Plaza|Laboratory|Lab)\b/gi;
/** Admin / academic qualifiers. Always strippable for short-name use. */
const ADMIN_QUALIFIERS = /\b(Department of|School of|College of|Program in|Office of|Institute for|Center for)\b/gi;
/** Redundant location tags — Boulder-specific. */
const REDUNDANT_LOC = /\b(at Boulder|of Colorado|Main Campus|North Campus|East Campus)\b/gi;
/** Over-specific buzzwords that don't carry directional value. */
const OVER_SPECIFIC = /\b(Research|Innovation|Integrated|Interdisciplinary|Advanced|Community|Regional|Discovery|Operations)\b/gi;

/** Run the algorithmic-fallback pipeline on a name. Returns the
 *  shortened form, or the original (untouched) when stripping yields
 *  an empty string. */
function applyAlgorithmic(name: string): string {
  const stripped = name
    .replace(ADMIN_QUALIFIERS, '')
    .replace(REDUNDANT_LOC, '')
    .replace(GENERIC_FACILITY, '')
    .replace(OVER_SPECIFIC, '')
    .replace(/\s+/g, ' ')
    .replace(/^\s+|\s+$/g, '')
    .replace(/\s*-\s*$/, '')
    .replace(/\(\s*\)/, '');
  return stripped || name;
}

/** Generate a short-form display name for a building. Returns empty
 *  string when the full name is already short enough or when the
 *  generator's suggestion equals the original (no point in storing a
 *  duplicate — empty means "fall back to `name`" at render time).
 *
 *  Resolution order: passthrough → manual → algorithmic. */
export function generateShortName(fullName: string): string {
  if (PASSTHROUGH.has(fullName)) {
    return '';
  }
  if (MANUAL[fullName] !== undefined) {
    const manual = MANUAL[fullName];
    return manual === fullName ? '' : manual;
  }
  const algorithmic = applyAlgorithmic(fullName);
  return algorithmic === fullName ? '' : algorithmic;
}

/** Run `generateShortName` over a list of destinations and return a
 *  Map of destinationId → suggested shortName for the rows where the
 *  generator has a non-empty suggestion AND that suggestion differs
 *  from whatever's currently stored (or the row has no shortName).
 *
 *  Used by the BuildingNames "Generate short names" bulk action.
 *  Skips rows that already have a non-empty shortName so reviewer
 *  hand-tunes are never clobbered — that's the contract the dialog
 *  promises ("Skipped N with existing values"). */
export function suggestShortNames(
  destinations: ReadonlyArray<{ id: string; name: string; shortName?: string }>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const dest of destinations) {
    // Reviewer edits are sacred — never overwrite a non-empty
    // shortName even if the generator would produce something
    // different.
    if (dest.shortName && dest.shortName.trim() !== '') continue;
    const suggestion = generateShortName(dest.name);
    if (suggestion && suggestion !== dest.name) {
      out.set(dest.id, suggestion);
    }
  }
  return out;
}
