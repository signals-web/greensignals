#!/usr/bin/env node
// generate-short-names.js — Generates short name candidates for CU Boulder building names
// Rules: keep core recognizable token, drop generic facility words, admin qualifiers,
// long honorific fragments, redundant descriptors. Keep words that disambiguate.

const BUILDINGS = [
  "19th Street Bridge",
  "22nd Street Bridge",
  "Administrative and Research Center- East Campus",
  "Aerospace Engineering Sciences",
  "Andrews Hall",
  "Arnett Hall",
  "Arts and Sciences Office Building 1",
  "Athens Court",
  "Bear Creek Basketball",
  "Bear Creek Volleyball",
  "Benson Earth Sciences Building",
  "Bosque",
  "Bryan Benjamin Sax Ski Team Buildng",
  "Buckingham Hall",
  "Buff Walk",
  "Buffalo Statue",
  "CU Police",
  "Center for Academic Success and Engagement",
  "Center for Innovation and Creativity",
  "Center for Innovation and Creativity Pavilion",
  "Cockerell Hall",
  "Continuing Education Center",
  "Cristol Chemistry and Biochemistry Building",
  "Crosman Hall",
  "Darley Towers North",
  "Darley Towers South",
  "Drescher Undrgrd Eng Int Teaching and Learning Lab",
  "Duane Physics",
  "Eaton Humanities Building",
  "Economics Building",
  "Ekeley Sciences Building",
  "Engineering Center North Wing",
  "Environmental Design Building",
  "Events Buffalo Patio",
  "Faculty-Staff Court",
  "Family Housing Basketball",
  "Family Housing Volleyball",
  "Farrand Hall",
  "Fiske Planetarium and Science Center",
  "Gallogly Discovery Learning Center",
  "Gold Biosciences Building",
  "Grounds and Recycling Operations Center",
  "Guggenheim Geography Building",
  "Hale Science Building",
  "Hallett Hall",
  "Hellems Arts and Sciences Building",
  "Henderson Building (Museum)",
  "Hillside",
  "Housing System Service Center",
  "Imig Music Building",
  "Institute for Behavioral Genetics",
  "Irrigation Pond",
  "Jennie Smoly Caruthers Biotechnology Building",
  "Kittredge Central",
  "Kittredge Lawn",
  "Kittredge Multiuse Field",
  "Kittredge Ponds",
  "Kittredge Volleyball Courts",
  "Kittredge West Hall",
  "Koelbel Building - Leeds School of Business",
  "Koenig Alumni Center",
  "Lasp Space Technology Research Center",
  "Libby Hall",
  "Life Science Research Lab (Rl4)",
  "Limelight Conference Center and Hotel",
  "Litman Research Lab (Rl1)",
  "Macky Auditorium",
  "Marine Court",
  "Marine Street Science Center (Rl6)",
  "Mathematics Building",
  "Muenzinger Psychology and Nueroscience Building",
  "NE Court",
  "NW Court",
  "New Physics Laboratory",
  "Norlin Library",
  "Nso Gong Building",
  "Old Main",
  "Page Foundation Center",
  "Police and Parking Services Center",
  "Porter Biosciences",
  "Potts/Prentup Concessions Building",
  "Prentup Field",
  "Ramaley Biology Building",
  "Rec Fields",
  "Reed Hall",
  "Regent Administrative Center",
  "Regent Dr Autopark",
  "Research Lab No 2",
  "Research Park Lake 4",
  "Richard Jessor Building",
  "Roser Atlas Center",
  "Smiley Court",
  "Smith Hall",
  "Space Science Building",
  "Stadium Building",
  "Stadium Sky Box",
  "Stadium Ticket Building",
  "Stearns Towers Center",
  "Student Recreation Center",
  "Sustainabilty Energy and Environment Community",
  "Transportation Center and Annex",
  "Uchealth Champions Center",
  "University Administrative Center",
  "University Administrative Center Annex",
  "University Club",
  "University Memorial Center",
  "University Residence",
  "Varsity Bridge",
  "Varsity Lake Quad",
  "Visual Arts Complex",
  "Wardenburg Student Health Center",
  "Weber Hall",
  "Will Vill Volleyball",
  "Williams Village Dining and Community Commons",
  "Williams Village East",
  "Williams Village North",
  "Williams Village Recreation Center",
  "Wolf Law Building",
  "Woodbury Arts and Sciences Building"
];

// Words to strip (unless they are the primary identifier)
const GENERIC_FACILITY = /\b(Building|Center|Complex|Facility|Hall|Pavilion|Annex|Wing|Commons|Plaza|Laboratory|Lab)\b/gi;
const ADMIN_QUALIFIERS = /\b(Department of|School of|College of|Program in|Office of|Institute for|Center for)\b/gi;
const REDUNDANT_LOC = /\b(at Boulder|of Colorado|Main Campus|North Campus|East Campus)\b/gi;
const FILLER = /\b(the|and|for|of)\b/gi;
const OVER_SPECIFIC = /\b(Research|Innovation|Integrated|Interdisciplinary|Advanced|Community|Regional|Discovery|Operations)\b/gi;

// Manual overrides for names that need human judgment
const MANUAL = {
  "19th Street Bridge": "19th St Bridge",
  "22nd Street Bridge": "22nd St Bridge",
  "Administrative and Research Center- East Campus": "ARC East",
  "Aerospace Engineering Sciences": "Aerospace Engineering",
  "Arts and Sciences Office Building 1": "A&S Office 1",
  "Bear Creek Basketball": "Bear Creek Basketball",
  "Bear Creek Volleyball": "Bear Creek Volleyball",
  "Benson Earth Sciences Building": "Benson Earth Sciences",
  "Bryan Benjamin Sax Ski Team Buildng": "Sax Ski Team",
  "Center for Academic Success and Engagement": "CASE",
  "Center for Innovation and Creativity": "CIC",
  "Center for Innovation and Creativity Pavilion": "CIC Pavilion",
  "Continuing Education Center": "Continuing Ed",
  "Cristol Chemistry and Biochemistry Building": "Cristol Chemistry",
  "Darley Towers North": "Darley North",
  "Darley Towers South": "Darley South",
  "Drescher Undrgrd Eng Int Teaching and Learning Lab": "ITLL",
  "Duane Physics": "Duane Physics",
  "Eaton Humanities Building": "Eaton Humanities",
  "Economics Building": "Economics",
  "Ekeley Sciences Building": "Ekeley Sciences",
  "Engineering Center North Wing": "Engineering North",
  "Environmental Design Building": "Environmental Design",
  "Events Buffalo Patio": "Buffalo Patio",
  "Faculty-Staff Court": "Faculty-Staff Court",
  "Family Housing Basketball": "Family Housing Basketball",
  "Family Housing Volleyball": "Family Housing Volleyball",
  "Fiske Planetarium and Science Center": "Fiske Planetarium",
  "Gallogly Discovery Learning Center": "Gallogly",
  "Gold Biosciences Building": "Gold Biosciences",
  "Grounds and Recycling Operations Center": "Grounds & Recycling",
  "Guggenheim Geography Building": "Guggenheim Geography",
  "Hale Science Building": "Hale Science",
  "Hellems Arts and Sciences Building": "Hellems",
  "Henderson Building (Museum)": "Henderson Museum",
  "Housing System Service Center": "Housing Services",
  "Imig Music Building": "Imig Music",
  "Institute for Behavioral Genetics": "Behavioral Genetics",
  "Jennie Smoly Caruthers Biotechnology Building": "Caruthers Biotech",
  "Kittredge Multiuse Field": "Kittredge Field",
  "Kittredge Volleyball Courts": "Kittredge Volleyball",
  "Kittredge West Hall": "Kittredge West",
  "Koelbel Building - Leeds School of Business": "Koelbel (Leeds)",
  "Koenig Alumni Center": "Koenig Alumni",
  "Lasp Space Technology Research Center": "LASP",
  "Life Science Research Lab (Rl4)": "Life Science Lab (RL4)",
  "Limelight Conference Center and Hotel": "Limelight",
  "Litman Research Lab (Rl1)": "Litman Lab (RL1)",
  "Marine Street Science Center (Rl6)": "Marine St Science (RL6)",
  "Mathematics Building": "Mathematics",
  "Muenzinger Psychology and Nueroscience Building": "Muenzinger",
  "New Physics Laboratory": "New Physics Lab",
  "Nso Gong Building": "NSO Gong",
  "Page Foundation Center": "Page Foundation",
  "Police and Parking Services Center": "Police & Parking",
  "Porter Biosciences": "Porter Biosciences",
  "Potts/Prentup Concessions Building": "Potts/Prentup Concessions",
  "Ramaley Biology Building": "Ramaley Biology",
  "Regent Administrative Center": "Regent Admin",
  "Regent Dr Autopark": "Regent Autopark",
  "Research Lab No 2": "Research Lab 2",
  "Research Park Lake 4": "Research Park Lake",
  "Richard Jessor Building": "Jessor",
  "Roser Atlas Center": "Roser ATLAS",
  "Space Science Building": "Space Science",
  "Stadium Building": "Stadium",
  "Stadium Sky Box": "Stadium Skybox",
  "Stadium Ticket Building": "Stadium Tickets",
  "Stearns Towers Center": "Stearns Towers",
  "Student Recreation Center": "Student Rec",
  "Sustainabilty Energy and Environment Community": "SEEC",
  "Transportation Center and Annex": "Transportation",
  "Uchealth Champions Center": "UCHealth Champions",
  "University Administrative Center": "UAC",
  "University Administrative Center Annex": "UAC Annex",
  "University Memorial Center": "UMC",
  "Varsity Lake Quad": "Varsity Lake Quad",
  "Visual Arts Complex": "Visual Arts",
  "Wardenburg Student Health Center": "Wardenburg",
  "Williams Village Dining and Community Commons": "WV Dining Commons",
  "Williams Village East": "WV East",
  "Williams Village North": "WV North",
  "Williams Village Recreation Center": "WV Rec",
  "Wolf Law Building": "Wolf Law",
  "Woodbury Arts and Sciences Building": "Woodbury",
};

// Names that are already short enough (pass through unchanged)
const PASSTHROUGH = new Set([
  "Bosque", "Buff Walk", "Buffalo Statue", "CU Police", "Hillside",
  "Irrigation Pond", "Kittredge Central", "Kittredge Lawn", "Kittredge Ponds",
  "Libby Hall", "Macky Auditorium", "Marine Court", "NE Court", "NW Court",
  "Norlin Library", "Old Main", "Prentup Field", "Rec Fields", "Reed Hall",
  "Smiley Court", "Smith Hall", "University Club", "University Residence",
  "Varsity Bridge", "Weber Hall", "Will Vill Volleyball",
  "Andrews Hall", "Arnett Hall", "Athens Court", "Buckingham Hall",
  "Cockerell Hall", "Crosman Hall", "Farrand Hall", "Hallett Hall",
]);

// Generate results
const results = BUILDINGS.map(name => {
  if (PASSTHROUGH.has(name)) {
    return { original: name, short: name, rule: "already short" };
  }
  if (MANUAL[name]) {
    return { original: name, short: MANUAL[name], rule: "manual" };
  }
  // Fallback algorithmic shortening
  let short = name
    .replace(ADMIN_QUALIFIERS, '')
    .replace(REDUNDANT_LOC, '')
    .replace(GENERIC_FACILITY, '')
    .replace(OVER_SPECIFIC, '')
    .replace(/\s+/g, ' ')
    .replace(/^\s+|\s+$/g, '')
    .replace(/\s*-\s*$/, '')
    .replace(/\(\s*\)/, '');
  return { original: name, short: short || name, rule: "algorithmic" };
});

// Output as JSON for Firebase upload
const firebasePayload = {};
results.forEach(r => {
  const key = r.original.replace(/[.#$/[\]]/g, '_');
  firebasePayload[key] = {
    originalName: r.original,
    shortName: r.short !== r.original ? r.short : '',
    status: 'pending',
    updatedBy: 'short-name-generator',
    updatedAt: Date.now()
  };
});

// Print results table
console.log('\n=== SHORT NAME CANDIDATES ===\n');
console.log('ORIGINAL'.padEnd(55) + 'SHORT NAME');
console.log('─'.repeat(55) + '─'.repeat(30));
results.forEach(r => {
  const changed = r.short !== r.original ? '  ←' : '';
  console.log(r.original.padEnd(55) + r.short + changed);
});

console.log('\n=== SUMMARY ===');
console.log('Total buildings: ' + results.length);
console.log('Shortened: ' + results.filter(r => r.short !== r.original).length);
console.log('Unchanged: ' + results.filter(r => r.short === r.original).length);

// Write Firebase payload
const fs = require('fs');
fs.writeFileSync(__dirname + '/short-names-payload.json', JSON.stringify(firebasePayload, null, 2));
console.log('\nFirebase payload written to scripts/short-names-payload.json');
