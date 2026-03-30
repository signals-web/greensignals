// ============================================================
// CU BOULDER WAYFINDING — SIGN MESSAGING AUTOMATION v4
// Google Apps Script  |  SIGNALS Studio
// ============================================================
//
// Constraints: Google Apps Script (no ES6, var only, no arrow functions)
//
// MESSAGING tab column layout (must match web app expectations):
//   0-4:   Sign ID, Type, Lat, Lng, Neighborhood
//   5-36:  R1-R8 (4 cols each: Arrow, Dest Auto, Dest Override, ttd)
//   37:    Status
//   38:    Notes
//   39:    Last Updated
//
// SIGNS tab column layout:
//   Type, Number, Lat, Lng, Facing, Neighborhood, R1-R8 (Arrow, Destination, ttd)
//
// ============================================================

var CONFIG = {
  WALK_SPEED_M_PER_MIN: 80,
  MAX_DIST_BY_TYPE: {
    "N":  400,
    "SD": 650,
    "M":  1500,
    "PM": 2000
  },
  USE_ALWAYS_INCLUDE_FOR_TYPES: ["M"],
  DESTINATIONS_PER_SIGN: {
    "N":  3,
    "SD": 5,
    "M":  6,
    "PM": 8
  },
  TIER_WEIGHT: { 1: 3, 2: 2, 3: 1 },
  REFERENCE_DISTANCE: 200,
  DISTRICT_BONUS: 0.5
};

var TABS = {
  SIGNS:        "SIGNS",
  DESTINATIONS: "DESTINATIONS",
  POI_NEW_XY:   "POI_NEW_XY",
  DISTANCES:    "DISTANCES",
  MESSAGING:    "MESSAGING",
  REVIEW:       "REVIEW"
};

var COLORS = {
  header:   "#1B2A4A",
  headerFg: "#FFFFFF",
  draft:    "#F5F5F5",
  inReview: "#FFF9C4",
  approved: "#C8E6C9",
  revision: "#FFCCBC",
  altRow:   "#EEF2F7"
};

// ── Arrow symbols: index = screenDeg / 45 ──
// Screen degrees: 0=→(East), 45=↘, 90=↓(South), 135=↙, 180=←(West), 225=↖, 270=↑(North), 315=↗
var ARROWS = ["→", "↘", "↓", "↙", "←", "↖", "↑", "↗"];

// ── Compass label → degrees ──
var COMPASS_MAP = {
  "N": 0, "NE": 45, "E": 90, "SE": 135,
  "S": 180, "SW": 225, "W": 270, "NW": 315
};

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function haversineMeters(lat1, lng1, lat2, lng2) {
  var R = 6371000;
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLng = (lng2 - lng1) * Math.PI / 180;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function metersToWalkMin(meters) {
  return Math.max(1, Math.round(meters / CONFIG.WALK_SPEED_M_PER_MIN));
}

/**
 * Build a map of header name → 0-based column index.
 */
function _buildColumnMap(headerRow) {
  var map = {};
  for (var i = 0; i < headerRow.length; i++) {
    var name = headerRow[i].toString().trim();
    if (name) map[name] = i;
  }
  return map;
}

// ============================================================
// ARROW / BEARING FUNCTIONS
// ============================================================

/**
 * Compass bearing (0-360, 0=North, 90=East) from point 1 to point 2.
 */
function _compassBearing(lat1, lng1, lat2, lng2) {
  var dLng = (lng2 - lng1) * Math.PI / 180;
  var lat1r = lat1 * Math.PI / 180;
  var lat2r = lat2 * Math.PI / 180;
  var y = Math.sin(dLng) * Math.cos(lat2r);
  var x = Math.cos(lat1r) * Math.sin(lat2r) -
          Math.sin(lat1r) * Math.cos(lat2r) * Math.cos(dLng);
  var bearing = Math.atan2(y, x) * 180 / Math.PI;
  return (bearing + 360) % 360;
}

/**
 * Convert a compass or relative bearing to the screen degree system
 * used by the web app (0=→/East, 90=↓/South, 270=↑/North).
 */
function _toScreenDeg(bearing) {
  return (bearing + 270) % 360;
}

/**
 * Snap screen degrees to nearest 45 and return the arrow symbol.
 */
function _screenDegToArrow(screenDeg) {
  var idx = Math.round(screenDeg / 45) % 8;
  return ARROWS[idx];
}

/**
 * Snap screen degrees to nearest 45.
 */
function _snapScreenDeg(screenDeg) {
  return (Math.round(screenDeg / 45) % 8) * 45;
}

/**
 * Parse a Facing cell value into compass degrees.
 * Accepts: numeric degrees (0-360), compass labels (N, NE, E, etc.), or empty.
 * Returns null if empty/invalid.
 */
function _parseFacing(val) {
  if (val === null || val === undefined || val === "") return null;
  var str = val.toString().trim().toUpperCase();
  if (str === "") return null;
  if (COMPASS_MAP.hasOwnProperty(str)) return COMPASS_MAP[str];
  var num = parseFloat(str);
  if (!isNaN(num)) return ((num % 360) + 360) % 360;
  return null;
}

/**
 * Get arrow info for a destination relative to a sign.
 * Returns { arrow: "↗", deg: 315 }
 */
function _getArrow(signLat, signLng, destLat, destLng, facingDeg) {
  var compass = _compassBearing(signLat, signLng, destLat, destLng);
  var bearing = compass;

  if (facingDeg !== null && facingDeg !== undefined) {
    // Relative bearing: 0 = straight ahead
    bearing = (compass - facingDeg + 360) % 360;
  }

  var screenDeg = _toScreenDeg(bearing);
  return {
    arrow: _screenDegToArrow(screenDeg),
    deg: _snapScreenDeg(screenDeg)
  };
}

// ============================================================
// AUTO-TIER ASSIGNMENT
// ============================================================

/**
 * Auto-assign a tier (1-3) based on destination name.
 * Tier 1: major buildings and venues
 * Tier 2: plazas, fields, quads, gardens, garages, gates, courts
 * Tier 3: ponds, lakes, fountains, sculptures, art, bridges, pools, statues
 * Default: Tier 2
 */
function _autoTier(name) {
  var lower = (name || "").toString().toLowerCase();
  var tier1 = ["building", "museum", "hall", "center", "auditorium",
               "theatre", "theater", "library", "gymnasium"];
  var tier3 = ["pond", "lake", "moat", "fountain", "sculpture",
               "art", "bridge", "pool", "statue", "creek"];
  for (var i = 0; i < tier1.length; i++) {
    if (lower.indexOf(tier1[i]) >= 0) return 1;
  }
  for (var i = 0; i < tier3.length; i++) {
    if (lower.indexOf(tier3[i]) >= 0) return 3;
  }
  return 2;
}

// ============================================================
// TAB CREATION / FORMATTING HELPERS
// ============================================================

function _createTab(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  } else if (sheet.getLastRow() > 1) {
    // Tab exists and has data — only update header row, never clear data
    var range = sheet.getRange(1, 1, 1, headers[0].length);
    range.setValues(headers);
    range.setBackground(COLORS.header);
    range.setFontColor(COLORS.headerFg);
    range.setFontWeight("bold");
    range.setFontSize(9);
    sheet.setFrozenRows(1);
    return sheet;
  } else {
    // Tab exists but is empty — safe to clear formats
    sheet.clearFormats();
  }
  var range = sheet.getRange(1, 1, 1, headers[0].length);
  range.setValues(headers);
  range.setBackground(COLORS.header);
  range.setFontColor(COLORS.headerFg);
  range.setFontWeight("bold");
  range.setFontSize(9);
  sheet.setFrozenRows(1);
  return sheet;
}

function _formatMessagingTab(sheet, numRows) {
  var cols = _buildColumnMap(sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]);
  sheet.getRange(2, 1, numRows, 1).setFontWeight("bold");
  for (var i = 0; i < numRows; i++) {
    var bg = (i % 2 === 0) ? "#FFFFFF" : COLORS.altRow;
    sheet.getRange(i + 2, 1, 1, sheet.getLastColumn()).setBackground(bg);
  }
  _applyStatusColors(sheet);
  sheet.autoResizeColumns(1, 5);
}

function _applyStatusColors(sheet) {
  var data = sheet.getDataRange().getValues();
  var cols = _buildColumnMap(data[0]);
  var statusIdx = cols["Status"];
  if (statusIdx === undefined) return;
  for (var i = 1; i < data.length; i++) {
    var status = data[i][statusIdx];
    var bg = status === "Approved" ? COLORS.approved :
             status === "In Review" ? COLORS.inReview :
             status === "Revision Needed" ? COLORS.revision : COLORS.draft;
    sheet.getRange(i + 1, statusIdx + 1).setBackground(bg);
  }
}

function _formatReviewTab(sheet, numRows) {
  sheet.getRange(2, 1, numRows, 1).setFontWeight("bold");
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var cols = _buildColumnMap(headers);

  // Highlight all override columns
  for (var r = 1; r <= 8; r++) {
    var overKey = "R" + r + ".Override";
    if (cols[overKey] !== undefined) {
      sheet.getRange(2, cols[overKey] + 1, numRows, 1)
        .setBackground("#E8F5E9")
        .setNote("Client: enter your preferred destination here");
    }
  }

  // Status column
  var statusIdx = cols["Status"];
  if (statusIdx !== undefined) {
    sheet.getRange(2, statusIdx + 1, numRows, 1).setBackground(COLORS.inReview);
  }

  // Client Notes column
  var clientNotesIdx = cols["Client Notes"];
  if (clientNotesIdx !== undefined) {
    sheet.getRange(2, clientNotesIdx + 1, numRows, 1)
      .setBackground("#FFF3E0")
      .setNote("Client: add any comments or questions here");
  }

  for (var i = 0; i < numRows; i++) {
    var bg = (i % 2 === 0) ? "#FFFFFF" : COLORS.altRow;
    sheet.getRange(i + 2, 1, 1, sheet.getLastColumn()).setBackground(bg);
  }
  sheet.autoResizeColumns(1, 3);
}

// ============================================================
// HEADER BUILDERS
// ============================================================

function _signsHeaders() {
  var h = ["Type", "Number", "Lat", "Lng", "Facing", "Neighborhood"];
  for (var r = 1; r <= 8; r++) {
    h.push("R" + r + ".Arrow", "R" + r + ".Destination", "R" + r + ".ttd");
  }
  return h;
}

function _destinationsHeaders() {
  return ["Dest ID", "Name", "Category", "Lat", "Lng", "District",
          "Tier", "Notes", "Include Always?", "Exclude From Types"];
}

function _distancesHeaders() {
  return ["Sign ID", "Sign Type", "Sign Lat", "Sign Lng",
          "Dest ID", "Dest Name", "District", "Tier",
          "Walk Minutes", "Walk Distance (m)", "Score",
          "API Status", "Arrow"];
}

function _messagingHeaders() {
  var h = ["Sign ID", "Type", "Lat", "Lng", "Neighborhood"];
  for (var r = 1; r <= 8; r++) {
    h.push("R" + r + ".Arrow", "R" + r + ".Dest (Auto)",
           "R" + r + ".Dest (Override)", "R" + r + ".ttd");
  }
  h.push("Status", "Notes", "Last Updated");
  return h;
}

function _reviewHeaders() {
  var h = ["Sign ID", "Type", "Location / Neighborhood"];
  for (var r = 1; r <= 8; r++) {
    h.push("R" + r + ".Arrow", "R" + r + ".Proposed",
           "R" + r + ".Override", "R" + r + ".Walk");
  }
  h.push("Status", "Client Notes", "SIGNALS Response", "Last Updated");
  return h;
}

// ============================================================
// PUBLIC FUNCTIONS
// ============================================================

function setupSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  _createTab(ss, TABS.SIGNS, [_signsHeaders()]);

  var destSheet = _createTab(ss, TABS.DESTINATIONS, [_destinationsHeaders()]);
  destSheet.getRange("G2:G500").setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(["1", "2", "3"], true).build());
  destSheet.getRange("I2:I500").setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(["YES", "NO"], true).build());

  _createTab(ss, TABS.DISTANCES, [_distancesHeaders()]);

  var msgSheet = _createTab(ss, TABS.MESSAGING, [_messagingHeaders()]);
  var msgHeaders = _messagingHeaders();
  var statusCol = msgHeaders.indexOf("Status") + 1;
  msgSheet.getRange(2, statusCol, 500, 1).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(["Draft", "In Review", "Approved", "Revision Needed"], true).build());

  var reviewSheet = _createTab(ss, TABS.REVIEW, [_reviewHeaders()]);
  var revHeaders = _reviewHeaders();
  var revStatusCol = revHeaders.indexOf("Status") + 1;
  reviewSheet.getRange(2, revStatusCol, 500, 1).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(["Awaiting Review", "In Review", "Approved", "Revision Needed"], true).build());

  var tabNames = [TABS.SIGNS, TABS.DESTINATIONS, TABS.DISTANCES, TABS.MESSAGING, TABS.REVIEW];
  for (var t = 0; t < tabNames.length; t++) {
    var s = ss.getSheetByName(tabNames[t]);
    if (s) s.setFrozenRows(1);
  }
  SpreadsheetApp.getUi().alert("Setup complete!");
}

// ── ASSIGN NEIGHBORHOODS ──

function assignNeighborhoods() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var signsSheet = ss.getSheetByName(TABS.SIGNS);
  var data = signsSheet.getDataRange().getValues();
  var cols = _buildColumnMap(data[0]);

  var latIdx = cols["Lat"];
  var lngIdx = cols["Lng"];
  var nbhdIdx = cols["Neighborhood"];
  if (latIdx === undefined || lngIdx === undefined || nbhdIdx === undefined) {
    SpreadsheetApp.getUi().alert("SIGNS tab missing required columns (Lat, Lng, Neighborhood).");
    return;
  }

  var ZONES = [
    { name: "Williams Village", minLat: 39.994, maxLat: 40.001, minLng: -105.257, maxLng: -105.245 },
    { name: "East Campus",      minLat: 40.006, maxLat: 40.022, minLng: -105.252, maxLng: -105.238 },
    { name: "Grandview",        minLat: 40.009, maxLat: 40.015, minLng: -105.278, maxLng: -105.270 },
    { name: "Main Campus",      minLat: 40.000, maxLat: 40.013, minLng: -105.278, maxLng: -105.258 },
    { name: "Main Campus",      minLat: 39.998, maxLat: 40.006, minLng: -105.272, maxLng: -105.258 }
  ];
  var count = 0;
  for (var i = 1; i < data.length; i++) {
    var lat = parseFloat(data[i][latIdx]);
    var lng = parseFloat(data[i][lngIdx]);
    if (isNaN(lat) || isNaN(lng)) continue;
    var assigned = "Main Campus";
    for (var z = 0; z < ZONES.length; z++) {
      var zone = ZONES[z];
      if (lat >= zone.minLat && lat <= zone.maxLat &&
          lng >= zone.minLng && lng <= zone.maxLng) {
        assigned = zone.name;
        break;
      }
    }
    signsSheet.getRange(i + 1, nbhdIdx + 1).setValue(assigned);
    count++;
  }
  SpreadsheetApp.getUi().alert("Neighborhoods assigned to " + count + " signs.");
}

// ── IMPORT POI_NEW_XY → DESTINATIONS ──

function importPOI() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var poiSheet = ss.getSheetByName(TABS.POI_NEW_XY);
  if (!poiSheet) {
    SpreadsheetApp.getUi().alert("POI_NEW_XY tab not found.");
    return;
  }
  var destsSheet = ss.getSheetByName(TABS.DESTINATIONS);
  if (!destsSheet) {
    SpreadsheetApp.getUi().alert("DESTINATIONS tab not found. Run Setup first.");
    return;
  }

  var poiData = poiSheet.getDataRange().getValues();
  var destData = destsSheet.getDataRange().getValues();

  var poiCols = _buildColumnMap(poiData[0]);
  var destCols = _buildColumnMap(destData[0]);

  // Build set of existing Dest IDs for dedup
  var existingIds = {};
  var destIdIdx = destCols["Dest ID"];
  if (destIdIdx === undefined) {
    SpreadsheetApp.getUi().alert("DESTINATIONS tab missing 'Dest ID' column.");
    return;
  }
  for (var d = 1; d < destData.length; d++) {
    var id = (destData[d][destIdIdx] || "").toString().trim().toUpperCase();
    if (id) existingIds[id] = true;
  }

  // Map POI columns
  var poiIdIdx = poiCols["Dest ID"];
  var poiNameIdx = poiCols["Name"];
  var poiCatIdx = poiCols["Category"];
  var poiLatIdx = poiCols["Lat"];
  var poiLngIdx = poiCols["Lng"];
  var poiNbhdIdx = poiCols["NEIGHBORHOOD"];

  if (poiIdIdx === undefined || poiLatIdx === undefined || poiLngIdx === undefined) {
    SpreadsheetApp.getUi().alert("POI_NEW_XY tab missing required columns (Dest ID, Lat, Lng).");
    return;
  }

  var newRows = [];
  var skipped = 0;
  for (var p = 1; p < poiData.length; p++) {
    var row = poiData[p];
    var id = (row[poiIdIdx] || "").toString().trim();
    if (!id) continue;

    // Dedup check
    if (existingIds[id.toUpperCase()]) {
      skipped++;
      continue;
    }

    var name = poiNameIdx !== undefined ? (row[poiNameIdx] || "").toString().trim() : id;
    var cat = poiCatIdx !== undefined ? (row[poiCatIdx] || "").toString().trim() : "";
    var lat = row[poiLatIdx];
    var lng = row[poiLngIdx];
    var district = poiNbhdIdx !== undefined ? (row[poiNbhdIdx] || "").toString().trim() : "";
    var tier = _autoTier(name);

    // Dest ID, Name, Category, Lat, Lng, District, Tier, Notes, Include Always?, Exclude From Types
    newRows.push([id, name, cat, lat, lng, district, tier, "", "NO", ""]);
    existingIds[id.toUpperCase()] = true;
  }

  if (newRows.length === 0) {
    SpreadsheetApp.getUi().alert("No new POIs to import (" + skipped + " already in DESTINATIONS).");
    return;
  }

  // Append after existing data
  var startRow = destsSheet.getLastRow() + 1;
  destsSheet.getRange(startRow, 1, newRows.length, newRows[0].length).setValues(newRows);

  SpreadsheetApp.getUi().alert(
    "Imported " + newRows.length + " POIs into DESTINATIONS.\n" +
    "Skipped " + skipped + " duplicates.\n" +
    "Review auto-assigned tiers in the Tier column."
  );
}

// ── GENERATE MESSAGING ──

function generateMessaging() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var signsSheet = ss.getSheetByName(TABS.SIGNS);
  var destsSheet = ss.getSheetByName(TABS.DESTINATIONS);
  var msgSheet   = ss.getSheetByName(TABS.MESSAGING);
  var distSheet  = ss.getSheetByName(TABS.DISTANCES);

  if (!signsSheet) { SpreadsheetApp.getUi().alert("SIGNS tab not found. Run Setup first."); return; }
  if (!destsSheet) { SpreadsheetApp.getUi().alert("DESTINATIONS tab not found. Run Setup first."); return; }
  if (!msgSheet) { SpreadsheetApp.getUi().alert("MESSAGING tab not found. Run Setup first."); return; }

  var signsData = signsSheet.getDataRange().getValues();
  var destsData = destsSheet.getDataRange().getValues();

  if (signsData.length <= 1) { SpreadsheetApp.getUi().alert("No signs found."); return; }
  if (destsData.length <= 1) { SpreadsheetApp.getUi().alert("No destinations found."); return; }

  // Build column maps
  var sCols = _buildColumnMap(signsData[0]);
  var dCols = _buildColumnMap(destsData[0]);

  // Parse destinations
  var dests = [];
  for (var j = 1; j < destsData.length; j++) {
    var d = destsData[j];
    var destId = (d[dCols["Dest ID"]] || "").toString().trim();
    if (!destId) continue;
    var dlat = parseFloat(d[dCols["Lat"]]);
    var dlng = parseFloat(d[dCols["Lng"]]);
    if (isNaN(dlat) || isNaN(dlng)) continue;
    var excludeRaw = (d[dCols["Exclude From Types"]] || "").toString();
    var excludeTypes = [];
    if (excludeRaw) {
      var parts = excludeRaw.split(",");
      for (var ep = 0; ep < parts.length; ep++) {
        var trimmed = parts[ep].trim();
        if (trimmed) excludeTypes.push(trimmed);
      }
    }
    dests.push({
      id: destId,
      name: (d[dCols["Name"]] || "").toString().trim(),
      lat: dlat,
      lng: dlng,
      district: (d[dCols["District"]] || "").toString().trim(),
      tier: parseInt(d[dCols["Tier"]]) || 2,
      alwaysInclude: (d[dCols["Include Always?"]] || "").toString().toUpperCase() === "YES",
      excludeTypes: excludeTypes
    });
  }
  if (dests.length === 0) { SpreadsheetApp.getUi().alert("No destinations with coordinates."); return; }

  // Detect SIGNS tab layout (Facing column may or may not exist)
  var hasFacing = sCols["Facing"] !== undefined;
  var sTypeIdx = sCols["Type"];
  var sNumIdx  = sCols["Number"];
  var sLatIdx  = sCols["Lat"];
  var sLngIdx  = sCols["Lng"];
  var sFacIdx  = hasFacing ? sCols["Facing"] : -1;
  var sNbhdIdx = sCols["Neighborhood"];

  // Clear MESSAGING data (keep headers)
  if (msgSheet.getLastRow() > 1) {
    msgSheet.getRange(2, 1, msgSheet.getLastRow() - 1, msgSheet.getLastColumn()).clearContent();
  }

  // Clear DISTANCES data (keep headers)
  if (distSheet && distSheet.getLastRow() > 1) {
    distSheet.getRange(2, 1, distSheet.getLastRow() - 1, distSheet.getLastColumn()).clearContent();
  }

  var outputRows = [];
  var distanceRows = [];
  var now = new Date().toLocaleDateString();

  for (var s = 1; s < signsData.length; s++) {
    var srow = signsData[s];
    var signType = (srow[sTypeIdx] || "").toString().trim();
    if (!signType) continue;
    var signNum  = (srow[sNumIdx] || "").toString().trim();
    var signId   = signType + "-" + signNum;
    var signLat  = parseFloat(srow[sLatIdx]);
    var signLng  = parseFloat(srow[sLngIdx]);
    var signNbhd = (srow[sNbhdIdx] || "").toString().trim();
    var facingDeg = hasFacing ? _parseFacing(srow[sFacIdx]) : null;

    var maxDests  = CONFIG.DESTINATIONS_PER_SIGN[signType] || 5;
    var maxDist   = CONFIG.MAX_DIST_BY_TYPE[signType] || 1000;
    var useAlways = CONFIG.USE_ALWAYS_INCLUDE_FOR_TYPES.indexOf(signType) >= 0;

    if (isNaN(signLat) || isNaN(signLng)) continue;

    var candidates = [];
    for (var k = 0; k < dests.length; k++) {
      var dest = dests[k];
      if (dest.excludeTypes.indexOf(signType) >= 0) continue;

      var distM   = haversineMeters(signLat, signLng, dest.lat, dest.lng);
      var walkMin = metersToWalkMin(distM);

      // Skip if beyond max distance (unless always-include type)
      if (!useAlways && distM > maxDist) {
        // Still log to DISTANCES as rejected
        var rejArrow = _getArrow(signLat, signLng, dest.lat, dest.lng, facingDeg);
        distanceRows.push([
          signId, signType, signLat, signLng,
          dest.id, dest.name, dest.district, dest.tier,
          walkMin, Math.round(distM), 0, "rejected (distance)", rejArrow.arrow
        ]);
        continue;
      }

      // v4 scoring: tier weight × distance decay + district bonus
      var tierWeight = CONFIG.TIER_WEIGHT[dest.tier] || 1;
      var distanceDecay = CONFIG.REFERENCE_DISTANCE / (CONFIG.REFERENCE_DISTANCE + distM);
      var score = tierWeight * distanceDecay;

      if (dest.district && signNbhd &&
          dest.district.toLowerCase() === signNbhd.toLowerCase()) {
        score += CONFIG.DISTRICT_BONUS;
      }

      var arrowInfo = _getArrow(signLat, signLng, dest.lat, dest.lng, facingDeg);

      candidates.push({
        destId: dest.id, destName: dest.name, district: dest.district,
        tier: dest.tier, walkMin: walkMin, distM: distM,
        score: score, always: dest.alwaysInclude,
        arrow: arrowInfo.arrow, deg: arrowInfo.deg
      });
    }

    // Select destinations
    var selected = [];
    var selectedIds = {};

    // Always-include first (for M-type signs)
    if (useAlways) {
      var alwaysPool = [];
      for (var ai = 0; ai < candidates.length; ai++) {
        if (candidates[ai].always) alwaysPool.push(candidates[ai]);
      }
      alwaysPool.sort(function(a, b) { return b.score - a.score; });
      for (var ai2 = 0; ai2 < alwaysPool.length && selected.length < maxDests; ai2++) {
        selected.push(alwaysPool[ai2]);
        selectedIds[alwaysPool[ai2].destId] = true;
      }
    }

    // Fill remaining slots by score
    var scoredPool = [];
    for (var sp = 0; sp < candidates.length; sp++) {
      if (!selectedIds[candidates[sp].destId]) scoredPool.push(candidates[sp]);
    }
    scoredPool.sort(function(a, b) { return b.score - a.score; });
    for (var si = 0; si < scoredPool.length && selected.length < maxDests; si++) {
      selected.push(scoredPool[si]);
      selectedIds[scoredPool[si].destId] = true;
    }

    // Write all candidates to DISTANCES
    for (var ci = 0; ci < candidates.length; ci++) {
      var c = candidates[ci];
      var method = selectedIds[c.destId] ? (c.always && useAlways ? "always-include" : "selected") : "rejected (score)";
      distanceRows.push([
        signId, signType, signLat, signLng,
        c.destId, c.destName, c.district, c.tier,
        c.walkMin, Math.round(c.distM),
        Math.round(c.score * 1000) / 1000,
        method, c.arrow
      ]);
    }

    // Build MESSAGING row
    var row = [signId, signType, signLat, signLng, signNbhd];
    for (var r = 0; r < 8; r++) {
      if (r < selected.length) {
        var sel = selected[r];
        var ttd = sel.walkMin <= 1 ? "~1 min" : "~" + sel.walkMin + " min";
        row.push(sel.arrow, sel.destName, "", ttd);
      } else {
        row.push("", "", "", "");
      }
    }
    row.push("Draft", "", now);
    outputRows.push(row);
  }

  if (outputRows.length === 0) { SpreadsheetApp.getUi().alert("No messaging generated."); return; }

  // Write MESSAGING
  msgSheet.getRange(2, 1, outputRows.length, outputRows[0].length).setValues(outputRows);
  _formatMessagingTab(msgSheet, outputRows.length);

  // Write DISTANCES
  if (distSheet && distanceRows.length > 0) {
    distSheet.getRange(2, 1, distanceRows.length, distanceRows[0].length).setValues(distanceRows);
  }

  SpreadsheetApp.getUi().alert(
    "Messaging generated for " + outputRows.length + " signs.\n" +
    distanceRows.length + " distance records written."
  );
}

// ── PUSH TO REVIEW ──

function pushToReview() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var msgSheet    = ss.getSheetByName(TABS.MESSAGING);
  var reviewSheet = ss.getSheetByName(TABS.REVIEW);

  if (!msgSheet) { SpreadsheetApp.getUi().alert("MESSAGING tab not found."); return; }
  if (!reviewSheet) { SpreadsheetApp.getUi().alert("REVIEW tab not found. Run Setup first."); return; }

  var msgData = msgSheet.getDataRange().getValues();
  var msgCols = _buildColumnMap(msgData[0]);
  var statusIdx = msgCols["Status"];

  var toReview = [];
  for (var i = 1; i < msgData.length; i++) {
    if (msgData[i][statusIdx] === "In Review") toReview.push(msgData[i]);
  }
  if (toReview.length === 0) {
    SpreadsheetApp.getUi().alert('No rows marked "In Review".');
    return;
  }

  if (reviewSheet.getLastRow() > 1) {
    reviewSheet.getRange(2, 1, reviewSheet.getLastRow() - 1, reviewSheet.getLastColumn()).clearContent();
  }

  var reviewRows = [];
  var now = new Date().toLocaleDateString();
  for (var r = 0; r < toReview.length; r++) {
    var row = toReview[r];
    // Sign ID, Type, Neighborhood
    var reviewRow = [row[msgCols["Sign ID"]], row[msgCols["Type"]], row[msgCols["Neighborhood"]]];
    // 8 destination slots
    for (var slot = 1; slot <= 8; slot++) {
      var arrowKey = "R" + slot + ".Arrow";
      var autoKey  = "R" + slot + ".Dest (Auto)";
      var overKey  = "R" + slot + ".Dest (Override)";
      var ttdKey   = "R" + slot + ".ttd";
      reviewRow.push(
        row[msgCols[arrowKey]] || "",
        row[msgCols[autoKey]]  || "",
        row[msgCols[overKey]]  || "",
        row[msgCols[ttdKey]]   || ""
      );
    }
    reviewRow.push("Awaiting Review", "", "", now);
    reviewRows.push(reviewRow);
  }

  reviewSheet.getRange(2, 1, reviewRows.length, reviewRows[0].length).setValues(reviewRows);
  _formatReviewTab(reviewSheet, reviewRows.length);
  SpreadsheetApp.getUi().alert(reviewRows.length + " signs pushed to REVIEW tab.");
}

// ── SYNC REVIEW → MESSAGING ──

function syncReviewToMessaging() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var reviewSheet = ss.getSheetByName(TABS.REVIEW);
  var msgSheet    = ss.getSheetByName(TABS.MESSAGING);

  if (!reviewSheet) { SpreadsheetApp.getUi().alert("REVIEW tab not found."); return; }
  if (!msgSheet) { SpreadsheetApp.getUi().alert("MESSAGING tab not found."); return; }

  var reviewData  = reviewSheet.getDataRange().getValues();
  var msgData     = msgSheet.getDataRange().getValues();
  var revCols = _buildColumnMap(reviewData[0]);
  var msgCols = _buildColumnMap(msgData[0]);

  // Build index: Sign ID → sheet row number (1-based)
  var msgIndex = {};
  var msgSignIdIdx = msgCols["Sign ID"];
  for (var i = 1; i < msgData.length; i++) {
    msgIndex[msgData[i][msgSignIdIdx]] = i + 1;
  }

  var updatedCount = 0;
  var now = new Date().toLocaleDateString();
  var revSignIdIdx = revCols["Sign ID"];
  var revStatusIdx = revCols["Status"];
  var revNotesIdx  = revCols["Client Notes"];
  var msgStatusCol = msgCols["Status"] + 1;       // 1-based for setRange
  var msgNotesCol  = msgCols["Notes"] + 1;
  var msgUpdatedCol = msgCols["Last Updated"] + 1;

  for (var j = 1; j < reviewData.length; j++) {
    var rrow = reviewData[j];
    var signId = rrow[revSignIdIdx];
    if (!signId || !msgIndex[signId]) continue;

    var msgRowNum = msgIndex[signId];
    var reviewStatus = rrow[revStatusIdx] || "";
    var clientNotes  = rrow[revNotesIdx] || "";

    msgSheet.getRange(msgRowNum, msgStatusCol).setValue(
      reviewStatus === "Awaiting Review" ? "In Review" : reviewStatus
    );
    msgSheet.getRange(msgRowNum, msgNotesCol).setValue(clientNotes);
    msgSheet.getRange(msgRowNum, msgUpdatedCol).setValue(now);

    // Sync overrides for all 8 slots
    for (var slot = 1; slot <= 8; slot++) {
      var revOverKey = "R" + slot + ".Override";
      var msgOverKey = "R" + slot + ".Dest (Override)";
      if (revCols[revOverKey] !== undefined && msgCols[msgOverKey] !== undefined) {
        var overrideVal = rrow[revCols[revOverKey]];
        if (overrideVal && overrideVal.toString().trim() !== "") {
          msgSheet.getRange(msgRowNum, msgCols[msgOverKey] + 1).setValue(overrideVal);
        }
      }
    }
    updatedCount++;
  }

  _applyStatusColors(msgSheet);
  SpreadsheetApp.getUi().alert("Synced " + updatedCount + " signs.");
}

// ── EXPORT APPROVED ──

function exportApprovedToCSV() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var msgSheet = ss.getSheetByName(TABS.MESSAGING);
  var msgData  = msgSheet.getDataRange().getValues();
  var msgCols  = _buildColumnMap(msgData[0]);

  var header = ["Type", "Number", "Lat", "Lng", "Neighborhood"];
  for (var r = 1; r <= 8; r++) {
    header.push("R" + r + ".Arrow", "R" + r + ".Destination", "R" + r + ".ttd");
  }
  var exportData = [header];

  var statusIdx = msgCols["Status"];
  for (var i = 1; i < msgData.length; i++) {
    var row = msgData[i];
    if (row[statusIdx] !== "Approved") continue;
    var signIdStr = (row[msgCols["Sign ID"]] || "").toString();
    var parts = signIdStr.split("-");

    var exportRow = [parts[0], parts[1] || "",
                     row[msgCols["Lat"]], row[msgCols["Lng"]], row[msgCols["Neighborhood"]]];

    for (var slot = 1; slot <= 8; slot++) {
      var arrowKey = "R" + slot + ".Arrow";
      var autoKey  = "R" + slot + ".Dest (Auto)";
      var overKey  = "R" + slot + ".Dest (Override)";
      var ttdKey   = "R" + slot + ".ttd";
      exportRow.push(
        row[msgCols[arrowKey]] || "",
        row[msgCols[overKey]] || row[msgCols[autoKey]] || "",
        row[msgCols[ttdKey]] || ""
      );
    }
    exportData.push(exportRow);
  }

  if (exportData.length <= 1) {
    SpreadsheetApp.getUi().alert("No approved signs found.");
    return;
  }

  var exportName = "EXPORT_" + Utilities.formatDate(new Date(), "America/Denver", "MMdd_HHmm");
  var exportSheet = ss.insertSheet(exportName);
  exportSheet.getRange(1, 1, exportData.length, exportData[0].length).setValues(exportData);
  SpreadsheetApp.getUi().alert(
    (exportData.length - 1) + " approved signs exported to sheet: " + exportName
  );
}

// ── MENU ──

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("CUB Messaging")
    .addItem("1. Initial Setup (run once)", "setupSheet")
    .addSeparator()
    .addItem("2. Assign Neighborhoods to Signs", "assignNeighborhoods")
    .addItem("3. Import POI_NEW_XY \u2192 Destinations", "importPOI")
    .addItem("4. Generate Messaging", "generateMessaging")
    .addSeparator()
    .addItem("5. Push Batch to Review Tab", "pushToReview")
    .addItem("6. Sync Review \u2192 Messaging", "syncReviewToMessaging")
    .addSeparator()
    .addItem("7. Export Approved Signs (CSV)", "exportApprovedToCSV")
    .addToUi();
}
