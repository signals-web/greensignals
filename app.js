// ── greensignals · app.js ──
// Core application state, CSV parsing, rendering, actions, maps

// ── THEME ──
function toggleTheme() {
  const isLight = document.documentElement.classList.toggle('light');
  document.getElementById('theme-btn').textContent = isLight ? '☾' : '☀';
  localStorage.setItem('cub_theme', isLight ? 'light' : 'dark');
  var newStyle = getMapStyle();
  // Switch sign card map tile style in-place
  if (map) {
    map.once('style.load', function() { updateMap(); });
    map.setStyle(newStyle);
  }
  // Switch overview map tile style in-place
  if (overviewMap) {
    overviewMap.once('style.load', function() { updateOverviewMarkers(); });
    overviewMap.setStyle(newStyle);
  }
}
function initTheme() {
  const saved = localStorage.getItem('cub_theme');
  if (saved === 'light') {
    document.documentElement.classList.add('light');
    const btn = document.getElementById('theme-btn');
    if (btn) btn.textContent = '☾';
  }
}

// ── SESSION PERSISTENCE ──
function getSessionKey() {
  const proj = window.PROJECT ? window.PROJECT.key : 'default';
  return `cub_review_session_${proj}`;
}

function saveSession() {
  try {
    const payload = {
      signs: state.signs,
      savedAt: Date.now()
    };
    localStorage.setItem(getSessionKey(), JSON.stringify(payload));
  } catch(e) { console.warn('Session save failed:', e); }
}

function loadSession() {
  try {
    const raw = localStorage.getItem(getSessionKey());
    if (!raw) return false;
    const payload = JSON.parse(raw);
    if (!payload.signs || !payload.signs.length) return false;
    const ageMs = Date.now() - (payload.savedAt || 0);
    const ageDays = Math.floor(ageMs / 86400000);
    state.signs = payload.signs.map(s => ({ ...s, editing: false }));
    state.current = 0;
    applyFilter();
    document.getElementById('load-screen').classList.add('hidden');
    document.getElementById('app').classList.add('visible');
    setTimeout(initMap, 300);
    if (ageDays >= 7) {
      setTimeout(() => alert('Note: this session is ' + ageDays + ' days old. Load a fresh CSV if the data has changed.'), 1000);
    }
    return true;
  } catch(e) {
    console.warn('Session restore failed:', e);
    return false;
  }
}

function clearSession() {
  localStorage.removeItem(getSessionKey());
  location.reload();
}

// ── ARROW SVG PATH (points right, rotate for direction) ──
const ARROW_PATH = "M43.15816.57621c.47915-.38332.91162-.57621,1.29494-.57621s.79122.21623,1.22368.64747l41.79196,41.79319c.43247.43247.6487.8637.6487,1.29494,0,.43247-.21623.8637-.6487,1.29494l-41.79196,41.79319c-.43247.43124-.84036.64747-1.22368.64747-.47915,0-.91162-.19166-1.29494-.57498l-7.40844-7.04969c-.38332-.38332-.57498-.81456-.57498-1.29494,0-.47915.19166-.91039.57498-1.29494l27.4788-26.32761H1.79621c-1.19911,0-1.79621-.59833-1.79621-1.79867v-10.71705c0-1.19911.5971-1.79867,1.79621-1.79867h61.43232l-27.4788-26.4001c-.38332-.38332-.57498-.81456-.57498-1.29494,0-.47792.19166-.91039.57498-1.29371l7.40844-7.04969Z";
const ARROW_VB   = "0 0 88.11745 87.4712";

// 8 directions: label, rotation degrees (arrow points right = 0°)
const DIRECTIONS = [
  { label:'↖', deg: 225 },
  { label:'↑', deg: 270 },
  { label:'↗', deg: 315 },
  { label:'←', deg: 180 },
  { label:'·', deg: null },  // no arrow — center slot
  { label:'→', deg: 0   },
  { label:'↙', deg: 135 },
  { label:'↓', deg: 90  },
  { label:'↘', deg: 45  },
];

function arrowSVG(deg, size) {
  size = size || 16;
  if (deg === null) return '';
  return `<svg viewBox="${ARROW_VB}" width="${size}" height="${size}" style="fill:inherit;transform:rotate(${deg}deg)"><path d="${ARROW_PATH}"/></svg>`;
}

function arrowDisplay(deg) {
  if (deg === null || deg === undefined || deg === '') {
    return `<div class="arrow-display no-arrow">—</div>`;
  }
  return `<div class="arrow-display">${arrowSVG(Number(deg), 20)}</div>`;
}

function arrowPickerHTML(currentDeg, rowIdx) {
  return `<div class="arrow-picker-grid">` +
    DIRECTIONS.map((d, i) => {
      const isNone  = d.deg === null;
      const isSel   = isNone ? (currentDeg === null || currentDeg === '' || currentDeg === undefined) : (Number(currentDeg) === d.deg);
      const selCls  = isSel ? ' selected' : '';
      if (isNone) {
        return `<button class="arrow-pick-btn no-arrow-btn${selCls}" onclick="setArrow(${rowIdx},null)" title="No arrow">—</button>`;
      }
      return `<button class="arrow-pick-btn${selCls}" onclick="setArrow(${rowIdx},${d.deg})" title="${d.label}">
        ${arrowSVG(d.deg, 14)}
      </button>`;
    }).join('') +
  `</div>`;
}

// ── SIGN TYPE ICONS (inline SVG) ──
const TYPE_ICONS = {
  // CU Boulder types
  N: `<svg viewBox="0 0 25 25" xmlns="http://www.w3.org/2000/svg"><polygon points="12.5 16.8 4.81 24.49 0.51 20.2 8.21 12.5 0.51 4.81 4.81 0.51 12.5 8.21 20.2 0.51 24.49 4.81 16.8 12.5 24.49 20.2 20.2 24.49 12.5 16.8" fill="#0b3858"/><path d="M20.2,1l3.79,3.79-7.69,7.69,7.69,7.69-3.79,3.79-7.69-7.69-7.69,7.69L1.03,20.2l7.69-7.69L1.03,4.81,4.81,1.03l7.69,7.69L20.2,1M20.2.77l-.13.13-7.57,7.57L4.94.9l-.13-.13-.13.13L.91,4.69l-.13.13.13.13,7.57,7.57L.91,20.07l-.13.13.13.13,3.79,3.79.13.13.13-.13,7.57-7.57,7.57,7.57.13.13.13-.13,3.79-3.79.13-.13-.13-.13-7.57-7.57,7.57-7.57.13-.13-.13-.13L20.33.9l-.13-.13Z" fill="#fff"/></svg>`,
  SD:`<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg"><path d="M14,26.56c-6.92,0-12.56-5.63-12.56-12.56S7.08,1.45,14,1.45s12.56,5.63,12.56,12.56-5.63,12.56-12.56,12.56Z" fill="#365daa"/><path d="M14,2.9c6.13,0,11.11,4.97,11.11,11.11s-4.97,11.11-11.11,11.11S2.9,20.14,2.9,14,7.87,2.9,14,2.9M14,0C6.28,0,0,6.28,0,14s6.28,14,14,14,14-6.28,14-14S21.72,0,14,0Z" fill="#0b3858"/><circle cx="14" cy="14" r="11.11" fill="none" stroke="#fff" stroke-miterlimit="10" stroke-width="1.45"/></svg>`,
  M: `<svg viewBox="0 0 29.3 29.3" xmlns="http://www.w3.org/2000/svg"><polygon points="11.42 28.74 11.42 17.86 0.54 17.86 0.54 11.42 11.42 11.42 11.42 0.54 17.86 0.54 17.86 11.42 28.74 11.42 28.74 17.86 17.86 17.86 17.86 28.74 11.42 28.74" fill="#e8c365"/><path d="M11.97,1.09h5.35v10.88h10.88v5.35s-10.88,0-10.88,0v10.88h-5.35v-10.88H1.09v-5.35s10.88,0,10.88,0V1.09M10.88,0v10.88H0v1.09s0,5.35,0,5.35v1.09h10.88v10.88h1.09s5.35,0,5.35,0h1.09s0-1.09,0-1.09v-9.79h10.88v-1.09s0-5.35,0-5.35v-1.09h-10.88V0h-1.09S11.97,0,11.97,0h-1.09Z"/></svg>`,
  PM:`<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg"><path d="M14,26.56c-6.92,0-12.56-5.63-12.56-12.56S7.08,1.45,14,1.45s12.56,5.63,12.56,12.56-5.63,12.56-12.56,12.56Z" fill="#fff"/><path d="M14,2.9c6.13,0,11.11,4.97,11.11,11.11s-4.97,11.11-11.11,11.11S2.9,20.14,2.9,14,7.87,2.9,14,2.9M14,0C6.28,0,0,6.28,0,14s6.28,14,14,14,14-6.28,14-14S21.72,0,14,0Z" fill="#0b3858"/><circle cx="14" cy="14" r="11.11" fill="none" stroke="#0670ae" stroke-miterlimit="10" stroke-width="1.45"/></svg>`,
  // Harvard types — triangles matching SignAgent colors
  A: `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg"><polygon points="14,2 26,24 2,24" fill="#D32F2F" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>`,
  B: `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg"><polygon points="14,2 26,24 2,24" fill="none" stroke="#EF8C1A" stroke-width="2.5" stroke-linejoin="round"/></svg>`,
  C: `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg"><polygon points="14,2 26,24 2,24" fill="#2E7D32" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>`
};
// Default icon for unknown sign types — simple filled circle with accent color
const DEFAULT_ICON = `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg"><circle cx="14" cy="14" r="13" fill="currentColor" stroke="#fff" stroke-width="1.5"/></svg>`;

function getTypeIcon(type) { return TYPE_ICONS[type] || DEFAULT_ICON; }

const TYPE_LABELS = { N:'Nudge', SD:'Secondary Directional', M:'Main', PM:'Primary Main', A:'Primary', B:'Secondary', C:'Tertiary' };

function facingCompassSvg(facing) {
  if (!facing) {
    // Animated compass (EOS Icons) when no direction set
    return '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24"><path fill="currentColor" d="M12 10.9c-.61 0-1.1.49-1.1 1.1s.49 1.1 1.1 1.1c.61 0 1.1-.49 1.1-1.1s-.49-1.1-1.1-1.1zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10s10-4.48 10-10S17.52 2 12 2zm2.19 12.19L6 18l3.81-8.19L18 6l-3.81 8.19z"><animateTransform id="eosC0" attributeName="transform" attributeType="XML" begin="0;eosC2.end" dur="1s" from="-90 12 12" to="0 12 12" type="rotate"/><animateTransform id="eosC1" attributeName="transform" attributeType="XML" begin="eosC0.end" dur="1s" from="0 12 12" to="-90 12 12" type="rotate"/><animateTransform id="eosC2" attributeName="transform" attributeType="XML" begin="eosC1.end" dur="1s" from="-90 12 12" to="270 12 12" type="rotate"/></path></svg>';
  }
  // Static compass rotated to face the selected direction
  // The icon's needle points NE by default (≈45°), so subtract 45 from target
  var rot = DIR_DEGS[facing] - 45;
  return '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24"><path fill="currentColor" d="M12 10.9c-.61 0-1.1.49-1.1 1.1s.49 1.1 1.1 1.1c.61 0 1.1-.49 1.1-1.1s-.49-1.1-1.1-1.1zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10s10-4.48 10-10S17.52 2 12 2zm2.19 12.19L6 18l3.81-8.19L18 6l-3.81 8.19z" transform="rotate('+rot+' 12 12)"/></svg>';
}

// ── DOUBLE-SIDED SIGN LOGIC ──
// Default (no facing): front arrows ↑(270),↗(315),↖(225); back ↓(90),↘(45),↙(135); side →(0),←(180)
const DIR_DEGS = { N:0, NE:45, E:90, SE:135, S:180, SW:225, W:270, NW:315 };
const OPPOSITE_DIR = { N:'S', NE:'SW', E:'W', SE:'NW', S:'N', SW:'NE', W:'E', NW:'SE' };
const BACK_DEGS = new Set([90, 45, 135]);
const SIDE_DEGS = new Set([0, 180]);
const REFLECT_MAP = { 90: 270, 45: 225, 135: 315 };

function splitSides(dests, facing) {
  const front = [], back = [];
  if (facing) {
    // When facing is set, rotate arrow interpretation relative to facing direction
    var facingDeg = DIR_DEGS[facing]; // compass degrees the sign faces
    dests.forEach(function(d) {
      if (d.deg === null || d.deg === undefined) { front.push(d); return; }
      // Screen degrees: 0=→, 90=↓, 180=←, 270=↑
      // Convert screen deg to compass bearing, then find angle relative to facing
      var compassBearing = (Number(d.deg) + 90) % 360;
      var rel = ((compassBearing - facingDeg) + 360) % 360;
      // Front: within ±67.5° of facing (rel 0-67.5 or 292.5-360)
      // Back: within ±67.5° of opposite (rel 112.5-247.5)
      // Side: 67.5-112.5 or 247.5-292.5
      if (rel <= 67.5 || rel >= 292.5) {
        front.push(d);
      } else if (rel >= 112.5 && rel <= 247.5) {
        // Reflect arrow for back side (rotate 180° in screen degrees)
        back.push({ ...d, deg: (Number(d.deg) + 180) % 360 });
      } else {
        front.push(d);
        back.push(d);
      }
    });
  } else {
    // Default: use fixed screen-degree sets
    dests.forEach(function(d) {
      var deg = d.deg;
      if (deg === null || deg === undefined) {
        front.push(d);
      } else if (BACK_DEGS.has(Number(deg))) {
        back.push({ ...d, deg: REFLECT_MAP[Number(deg)] });
      } else if (SIDE_DEGS.has(Number(deg))) {
        front.push(d);
        back.push(d);
      } else {
        front.push(d);
      }
    });
  }
  return { front, back };
}

// ── STATE ──
const state = { signs:[], current:0, filtered:[], filter:'' };
let map=null, mapMarker=null, destMarkers=[];

// ── CSV ──
function parseCSV(text) {
  const lines = text.trim().split('\n').filter(l=>l.trim());
  if (lines.length<2) return [];
  const signs = [];
  for (let i=1;i<lines.length;i++) {
    const vals = parseCSVLine(lines[i]);
    if (!vals[0]) continue;
    const sign = { id:vals[0]||'', type:vals[1]||'', lat:vals[2]||'', lng:vals[3]||'', nbhd:vals[4]||'', dests:[], status:'pending', notes:'', editing:false };
    for (let r=0;r<8;r++) {
      const base=5+r*4;
      const arrow=(vals[base]||'').trim();
      const auto=(vals[base+1]||'').trim();
      const over=(vals[base+2]||'').trim();
      const ttd=(vals[base+3]||'').trim();
      const name=over||auto;
      if (name) sign.dests.push({ deg: degFromSymbol(arrow), name, ttd });
    }
    const sc=(vals[37]||vals[vals.length-3]||'').toLowerCase().trim();
    if (['approved','edited','flagged'].includes(sc)) sign.status=sc;
    sign.notes = (vals[38]||'').trim();
    sign.reviewedBy = (vals[39]||'').trim();
    if (sign.dests.length>0) signs.push(sign);
  }
  return signs;
}

/**
 * Parse a Sheets API rows array (array of arrays) into sign objects.
 * Same structure as CSV but already split into cells.
 */
function parseSheetsRows(rows) {
  if (!rows || rows.length < 2) return [];
  const signs = [];
  for (let i = 1; i < rows.length; i++) {
    const vals = rows[i];
    if (!vals || !vals[0]) continue;
    const sign = {
      id: vals[0]||'', type: vals[1]||'', lat: vals[2]||'', lng: vals[3]||'',
      nbhd: vals[4]||'', dests: [], status: 'pending', notes: '', editing: false,
      _sheetRow: i + 1  // 1-indexed row number in Sheet (row 1 = header)
    };
    for (let r = 0; r < 8; r++) {
      const base = 5 + r * 4;
      const arrow = (vals[base]||'').trim();
      const auto  = (vals[base+1]||'').trim();
      const over  = (vals[base+2]||'').trim();
      const ttd   = (vals[base+3]||'').trim();
      const name  = over || auto;
      if (name) sign.dests.push({ deg: degFromSymbol(arrow), name, ttd, _auto: auto, _over: over });
    }
    const sc = (vals[37]||'').toLowerCase().trim();
    if (['approved','edited','flagged'].includes(sc)) sign.status = sc;
    sign.notes = (vals[38]||'').trim();
    sign.reviewedBy = (vals[39]||'').trim();
    if (sign.dests.length > 0) signs.push(sign);
  }
  return signs;
}

function degFromSymbol(s) {
  const map={'↑':270,'↗':315,'→':0,'↘':45,'↓':90,'↙':135,'←':180,'↖':225,'·':null,'—':null,'':null};
  if (s in map) return map[s];
  const n=parseInt(s);
  return isNaN(n)?null:n;
}

function degToSymbol(deg) {
  if (deg===null||deg===undefined||deg==='') return '';
  const m={0:'→',45:'↘',90:'↓',135:'↙',180:'←',225:'↖',270:'↑',315:'↗'};
  return m[Number(deg)]||'→';
}

function parseCSVLine(line) {
  const result=[]; let cur='', inQ=false;
  for (let i=0;i<line.length;i++) {
    const ch=line[i];
    if (ch==='"'){inQ=!inQ;}
    else if (ch===','&&!inQ){result.push(cur.trim());cur='';}
    else{cur+=ch;}
  }
  result.push(cur.trim());
  return result;
}

// ── LOAD ──
function loadData(text) {
  const signs=parseCSV(text);
  if (!signs.length){alert('No sign data found. Export the MESSAGING tab as CSV.');return;}
  state.signs=signs; state.current=0;
  applyFilter();
  saveSession();
  document.getElementById('load-screen').classList.add('hidden');
  document.getElementById('app').classList.add('visible');
  setTimeout(initMap,300);
}

/**
 * Load sign data from Sheets API response rows (array of arrays).
 * Called by sheets.js after a successful fetch.
 */
function loadFromSheets(rows) {
  const signs = parseSheetsRows(rows);
  if (!signs.length) {
    alert('No sign data found in the MESSAGING tab.');
    return;
  }
  state.signs = signs;
  state.current = 0;
  state.sheetsConnected = true;
  applyFilter();
  saveSession();
  document.getElementById('load-screen').classList.add('hidden');
  document.getElementById('app').classList.add('visible');
  setTimeout(initMap, 300);
}

// File input and drag/drop listeners are attached by config.js after injecting the load screen UI
function togglePaste(){const el=document.getElementById('paste-area');if(el) el.style.display=el.style.display==='block'?'none':'block';}
function loadFromPaste(){const el=document.getElementById('paste-input'); if(el) loadData(el.value);}

// ── MAP (MapLibre GL JS) ──
function getMapStyle() {
  var key = (window.__ENV__ && window.__ENV__.MAPTILER_KEY) || '';
  var isLight = document.documentElement.classList.contains('light');
  return isLight
    ? 'https://api.maptiler.com/maps/dataviz-light/style.json?key=' + key
    : 'https://api.maptiler.com/maps/dataviz-dark/style.json?key=' + key;
}
function initMap() {
  var el = document.getElementById('sign-map');
  if (!el || map) return;
  var s = state.filtered[state.current];
  var lat = s ? parseFloat(s.lat) : 40.0;
  var lng = s ? parseFloat(s.lng) : -105.27;
  var rot = s && s._facing ? DIR_DEGS[s._facing] : 0;
  map = new maplibregl.Map({
    container: 'sign-map',
    style: getMapStyle(),
    center: [lng, lat],
    zoom: 16,
    bearing: -rot,
    interactive: false,
    attributionControl: false
  });
  map.on('load', function() { updateMap(); });
}
function updateMap() {
  if (!map) return;
  var s = state.filtered[state.current]; if (!s) return;
  var lat = parseFloat(s.lat), lng = parseFloat(s.lng);
  if (isNaN(lat) || isNaN(lng)) return;

  // Clear previous markers and line layers
  if (mapMarker) { mapMarker.remove(); mapMarker = null; }
  destMarkers.forEach(function(m) {
    if (typeof m === 'string') {
      if (map.getLayer(m)) map.removeLayer(m);
      if (map.getSource(m)) map.removeSource(m);
    } else if (m && m.remove) { m.remove(); }
  });
  destMarkers = [];

  // Sign marker — em-dash rotated to facing
  var signRot = s._facing ? DIR_DEGS[s._facing] : 0;
  var signEl = document.createElement('div');
  signEl.innerHTML = '<div class="map-sign-marker" style="transform:rotate(' + signRot + 'deg)">&mdash;</div>';
  mapMarker = new maplibregl.Marker({ element: signEl, anchor: 'center' })
    .setLngLat([lng, lat]).addTo(map);

  // Theme-aware colors
  var isLight = document.documentElement.classList.contains('light');
  var lineColor = isLight ? 'rgba(120,90,20,0.5)' : 'rgba(207,184,124,0.4)';
  var dotFill = isLight ? '#7A5A14' : '#CFB87C';
  var dotStroke = isLight ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.5)';

  // Destination markers with labels and connecting lines
  var hasDests = false;
  var bounds = new maplibregl.LngLatBounds([lng, lat], [lng, lat]);
  var lineIdx = 0;
  s.dests.forEach(function(d) {
    if (!d.name) return;
    var pos = estimateDestPos(lat, lng, d.deg, d.ttd);
    if (!pos) return;
    var dlat = pos.lat, dlng = pos.lng;
    hasDests = true;

    // Dashed connecting line
    var lineId = 'dest-line-' + (lineIdx++);
    map.addSource(lineId, {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [[lng,lat],[dlng,dlat]] } }
    });
    map.addLayer({
      id: lineId, type: 'line', source: lineId,
      paint: { 'line-color': lineColor, 'line-width': 2, 'line-dasharray': [4, 4] }
    });
    destMarkers.push(lineId);

    // Destination dot
    var dotEl = document.createElement('div');
    dotEl.style.cssText = 'width:6px;height:6px;border-radius:50%;background:'+dotFill+';border:1px solid '+dotStroke+';';
    var dot = new maplibregl.Marker({ element: dotEl, anchor: 'center' })
      .setLngLat([dlng, dlat]).addTo(map);
    destMarkers.push(dot);

    // Name label
    var labelEl = document.createElement('div');
    labelEl.className = 'map-dest-label';
    labelEl.textContent = d.name;
    var label = new maplibregl.Marker({ element: labelEl, anchor: 'top-left', offset: [8, 4] })
      .setLngLat([dlng, dlat]).addTo(map);
    destMarkers.push(label);

    bounds.extend([dlng, dlat]);
  });

  // Native bearing rotation — no CSS hack needed
  var rot = s._facing ? DIR_DEGS[s._facing] : 0;

  // North indicator
  var clipEl = document.querySelector('.map-clip');
  var oldNorth = document.getElementById('map-north');
  if (oldNorth) oldNorth.remove();
  if (rot && clipEl) {
    var northDiv = document.createElement('div');
    northDiv.id = 'map-north';
    northDiv.className = 'map-north-indicator';
    northDiv.style.transform = 'rotate(' + rot + 'deg)';
    northDiv.textContent = 'N';
    clipEl.appendChild(northDiv);
  }

  // Zoom controls
  var zoomWrap = document.getElementById('map-zoom-wrap');
  if (!zoomWrap && clipEl) {
    zoomWrap = document.createElement('div');
    zoomWrap.id = 'map-zoom-wrap';
    zoomWrap.className = 'map-zoom-controls';
    zoomWrap.innerHTML = '<button class="map-zoom-btn" onclick="mapZoom(1)">+</button><button class="map-zoom-btn" onclick="mapZoom(-1)">&minus;</button>';
    clipEl.appendChild(zoomWrap);
  }

  // Center on sign, zoom to fit destinations
  var zoom = 17;
  if (hasDests) {
    var cam = map.cameraForBounds(bounds, { padding: 30 });
    if (cam) {
      zoom = Math.min(Math.max(Math.floor(cam.zoom) - 1, 13), 18);
    }
  }
  map.jumpTo({ center: [lng, lat], zoom: zoom, bearing: -rot });

  setTimeout(function() {
    map.resize();
    map.jumpTo({ center: [lng, lat], zoom: zoom, bearing: -rot });
    resolveOverlaps();
  }, 200);
}
function mapZoom(delta) {
  if (!map) return;
  var s = state.filtered[state.current];
  var lng = parseFloat(s.lng), lat = parseFloat(s.lat);
  map.setZoom(map.getZoom() + delta);
  map.panTo([lng, lat]);
}
// Simple label collision resolver
function resolveOverlaps() {
  var labels = document.querySelectorAll('.map-dest-label');
  if (labels.length < 2) return;
  var rects = [];
  for (var i = 0; i < labels.length; i++) {
    rects.push({ el: labels[i], r: labels[i].getBoundingClientRect() });
  }
  for (var i = 1; i < rects.length; i++) {
    for (var j = 0; j < i; j++) {
      var a = rects[i].r, b = rects[j].r;
      if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) {
        var shift = b.bottom - a.top + 2;
        rects[i].el.style.marginTop = (parseInt(rects[i].el.style.marginTop || '0') + shift) + 'px';
        rects[i].r = rects[i].el.getBoundingClientRect();
      }
    }
  }
}
// Estimate destination lat/lng from sign position, arrow degree, and walk time
function estimateDestPos(signLat, signLng, deg, ttd) {
  if (deg === null || deg === undefined) return null;
  // Convert screen degrees back to compass bearing
  const compassBearing = (Number(deg) + 90) % 360;
  // Parse walk minutes from "~2 min" format
  const minMatch = (ttd || '').match(/(\d+)/);
  const minutes = minMatch ? parseInt(minMatch[1]) : 2;
  const distMeters = minutes * 80; // walk speed
  // Offset in degrees (rough: 1° lat ≈ 111000m, 1° lng ≈ 85000m at 40°N)
  const bearingRad = compassBearing * Math.PI / 180;
  const dLat = (distMeters * Math.cos(bearingRad)) / 111000;
  const dLng = (distMeters * Math.sin(bearingRad)) / 85000;
  return { lat: signLat + dLat, lng: signLng + dLng };
}

function statusColor(s){return s==='approved'?'#30D158':s==='edited'?'#FFD60A':s==='flagged'?'#FF453A':'#CFB87C';}

// ── FILTER & COUNTS ──
function applyFilter() {
  state.filter=document.getElementById('type-filter').value;
  state.filtered=state.filter?state.signs.filter(s=>s.type===state.filter):state.signs.slice();
  state.current=0; render();
}
function getCounts() {
  const s=state.signs;
  return {approved:s.filter(x=>x.status==='approved').length,edited:s.filter(x=>x.status==='edited').length,flagged:s.filter(x=>x.status==='flagged').length,pending:s.filter(x=>x.status==='pending').length,total:s.length,reviewed:s.filter(x=>x.status!=='pending').length};
}

// ── RENDER ──
function render(){renderSidebar();renderMain();updateMap();saveSession();}

function renderSidebar(){
  const c=getCounts();
  document.getElementById('stat-approved').textContent=c.approved+' approved';
  document.getElementById('stat-edited').textContent=c.edited+' edited';
  document.getElementById('stat-flagged').textContent=c.flagged+' flagged';
  document.getElementById('stat-pending').textContent=c.pending+' pending';
  document.getElementById('progress-fill').style.width=(c.total?Math.round(c.reviewed/c.total*100):0)+'%';
  document.getElementById('sign-list').innerHTML=state.filtered.map((s,i)=>`
    <div class="sign-item${i===state.current?' active':''}" onclick="goTo(${i})">
      <div class="sign-icon">${getTypeIcon(s.type)}</div>
      <span class="sign-item-id">${s.id}</span>
      <span class="sign-item-nbhd">${s.nbhd.replace('Main Campus','Main').replace('Williams Village','WV').replace('East Campus','East')}</span>
      <span class="status-dot dot-${s.status}"></span>
    </div>`).join('');
  const a=document.querySelector('.sign-item.active');if(a)a.scrollIntoView({block:'nearest'});
}

function buildDestTable(dests, sign, editing, facingOffset) {
  var offset = facingOffset || 0;
  let html = `<table class="dest-table"><thead><tr>
    <th class="arrow-col">Arrow</th>
    <th>Destination</th>
    <th style="width:90px">Walk</th>
    ${editing?'<th style="width:36px"></th>':''}
  </tr></thead><tbody>`;
  dests.forEach(function(d, i) {
    // For editing mode, find original index in sign.dests
    const origIdx = editing ? i : sign.dests.indexOf(d);
    if (editing) {
      html+=`<tr>
        <td>${arrowPickerHTML(d.deg,origIdx)}</td>
        <td><input class="edit-input" value="${escHtml(d.name)}" oninput="updateDest(${origIdx},'name',this.value)"></td>
        <td><input class="edit-input ttd-input" value="${escHtml(d.ttd)}" oninput="updateDest(${origIdx},'ttd',this.value)"></td>
        <td><button class="remove-btn" onclick="removeDest(${origIdx})">×</button></td>
      </tr>`;
    } else {
      // Rotate arrow relative to facing direction
      var displayDeg = d.deg;
      if (offset && displayDeg !== null && displayDeg !== undefined) {
        displayDeg = ((Number(displayDeg) - offset) + 360) % 360;
      }
      html+=`<tr>
        <td>${arrowDisplay(displayDeg)}</td>
        <td class="dest-name-cell${d.name?'':' empty'}">${escHtml(d.name)||'—'}</td>
        <td>${d.ttd?`<span class="ttd-chip">${escHtml(d.ttd)}</span>`:''}</td>
      </tr>`;
    }
  });
  if (editing) {
    html+=`<tr><td colspan="4" style="padding:10px 1.5rem"><button class="add-dest-btn" onclick="addDest()">+ add destination</button></td></tr>`;
  }
  if (dests.length === 0) {
    html+=`<tr><td colspan="3" style="padding:12px 1.5rem;color:var(--cu-muted);font-style:italic">No destinations on this side</td></tr>`;
  }
  html+=`</tbody></table>`;
  return html;
}

function renderMain(){
  if(!state.filtered.length){
    document.getElementById('sign-view').innerHTML=`<div style="padding:4rem;text-align:center;color:var(--cu-muted)">No signs match the current filter</div>`;return;
  }
  const s=state.filtered[state.current];
  const total=state.filtered.length;
  document.getElementById('nav-counter').textContent=(state.current+1)+' of '+total;
  document.getElementById('btn-prev').disabled=state.current===0;
  document.getElementById('btn-next-nav').disabled=state.current===total-1;

  const dots=document.getElementById('nav-dots');
  if(total<=100){
    dots.innerHTML=state.filtered.map((sg,i)=>`<div class="nav-dot${i===state.current?' current':''}" style="background:${statusColor(sg.status)}" onclick="goTo(${i})" title="${sg.id}"></div>`).join('');
  } else {
    dots.innerHTML=`<span style="font-size:12px;color:var(--cu-muted);font-family:var(--font-mono)">${total} signs</span>`;
  }

  let html='';
  if(s.status!=='pending'){
    const labels={approved:'Approved',edited:'Edited — awaiting SIGNALS review',flagged:'Flagged for discussion'};
    const byLine = s.reviewedBy ? ` by ${escHtml(s.reviewedBy)}` : '';
    html+=`<div class="status-banner banner-${s.status}">${labels[s.status]}${byLine}</div>`;
  }

  html+=`<div class="sign-card">
    <div class="sign-card-header">
      <div class="sign-card-header-left">
        <div class="sign-card-top">
          <div class="sign-card-id">${s.id}</div>
        </div>
        <div class="sign-card-type">${TYPE_LABELS[s.type]||s.type}</div>
        <div class="sign-card-nbhd">${s.nbhd}</div>
        <div class="sign-card-coords">${parseFloat(s.lat).toFixed(5)}, ${parseFloat(s.lng).toFixed(5)}</div>
        <div class="facing-picker">
          <span class="facing-label">Facing</span>
          <div class="facing-row">
            <div class="facing-compass">${facingCompassSvg(s._facing)}</div>
            <div class="facing-btns">
              ${['N','NE','E','SE','S','SW','W','NW'].map(function(dir) {
                var active = s._facing===dir ? ' active' : '';
                return '<button class="facing-btn'+active+'" onclick="setFacing(\''+dir+'\')">'+dir+'</button>';
              }).join('')}
              ${s._facing ? '<button class="facing-btn facing-clear" onclick="setFacing(null)">&times;</button>' : ''}
            </div>
          </div>
        </div>
      </div>
      <div class="map-clip"><div id="sign-map"></div></div>
    </div>`;

  // Double-sided logic: split destinations into front/back when not editing
  const sides = !s.editing ? splitSides(s.dests, s._facing) : null;
  const hasBackSide = sides && sides.back.length > 0;
  const frontDir = s._facing || '';
  const backDir = s._facing ? OPPOSITE_DIR[s._facing] : '';

  // Arrow rotation offset: subtract facing compass degrees from screen degrees
  // e.g. facing N (0°) = no change; facing E (90°) = east arrow becomes ↑
  var facingScreenOffset = s._facing ? DIR_DEGS[s._facing] : 0;

  if(s.editing) {
    html+=buildDestTable(s.dests, s, true);
  } else if(hasBackSide) {
    html+=`<div class="side-label">Side A <span class="side-hint">front${frontDir ? ' · '+frontDir : ''}</span></div>`;
    html+=buildDestTable(sides.front, s, false, facingScreenOffset);
    html+=`<div class="side-label side-b">Side B <span class="side-hint">back${backDir ? ' · '+backDir : ''}</span></div>`;
    html+=buildDestTable(sides.back, s, false, facingScreenOffset);
  } else {
    html+=buildDestTable(s.dests, s, false, facingScreenOffset);
  }

  if(s.editing){
    html+=`<div class="notes-area"><div class="notes-label">Notes for SIGNALS</div>
      <textarea rows="2" placeholder="Any comments about this sign..." oninput="updateNotes(this.value)">${escHtml(s.notes)}</textarea></div>`;
  } else if(s.notes){
    const noteBy = s.reviewedBy ? `<span class="notes-author">— ${escHtml(s.reviewedBy)}</span>` : '';
    html+=`<div class="notes-area"><div class="notes-label">Notes${noteBy}</div><div class="notes-display">${escHtml(s.notes)}</div></div>`;
  }

  html+=`</div>`;

  html+=`<div class="actions">`;
  if(!s.editing){
    html+=`<button class="action-btn btn-approve" onclick="approve()">Approve</button>`;
    html+=`<button class="action-btn btn-edit" onclick="startEdit()">Edit destinations</button>`;
    html+=`<button class="action-btn btn-flag" onclick="flag()">Flag for discussion</button>`;
  } else {
    html+=`<button class="action-btn btn-save" onclick="saveEdit()">Save edits</button>`;
    html+=`<button class="action-btn btn-cancel" onclick="cancelEdit()">Cancel</button>`;
  }
  html+=state.current<state.filtered.length-1
    ?`<button class="action-btn btn-next" onclick="goTo(state.current+1)">Next sign →</button>`
    :`<button class="action-btn btn-next" onclick="showSummary()">Review complete ✓</button>`;
  html+=`</div>`;

  document.getElementById('sign-view').innerHTML=html;
  if(map){map.remove();map=null;mapMarker=null;destMarkers=[];}
  setTimeout(initMap,200);
}

// ── ACTIONS ──
function setFacing(dir) {
  const s = state.filtered[state.current];
  s._facing = dir;

  // Update facing buttons without full re-render
  var btns = document.querySelectorAll('.facing-btn');
  btns.forEach(function(btn) {
    var isActive = btn.textContent === dir;
    btn.classList.toggle('active', isActive);
  });

  // Update compass icon
  var compassEl = document.querySelector('.facing-compass');
  if (compassEl) compassEl.innerHTML = facingCompassSvg(dir);

  // Show/hide clear button
  var picker = document.querySelector('.facing-btns');
  var existing = picker ? picker.querySelector('.facing-clear') : null;
  if (dir && !existing && picker) {
    var clearBtn = document.createElement('button');
    clearBtn.className = 'facing-btn facing-clear';
    clearBtn.onclick = function(){ setFacing(null); };
    clearBtn.innerHTML = '&times;';
    picker.appendChild(clearBtn);
  } else if (!dir && existing) {
    existing.remove();
  }

  // Re-split destinations and rebuild tables
  var sides = splitSides(s.dests, dir);
  var hasBackSide = sides.back.length > 0;
  var frontDir = dir || '';
  var backDir = dir ? OPPOSITE_DIR[dir] : '';
  var facingOffset = dir ? DIR_DEGS[dir] : 0;

  // Find the dest table container (between header and actions)
  var signView = document.getElementById('sign-view');
  var oldLabels = signView.querySelectorAll('.side-label');
  var oldTables = signView.querySelectorAll('.dest-table');

  // Remove old side labels and tables
  oldLabels.forEach(function(el){ el.remove(); });
  oldTables.forEach(function(el){ el.remove(); });

  // Build new content
  var tableHtml = '';
  if (hasBackSide) {
    tableHtml += '<div class="side-label">Side A <span class="side-hint">front' + (frontDir ? ' · '+frontDir : '') + '</span></div>';
    tableHtml += buildDestTable(sides.front, s, false, facingOffset);
    tableHtml += '<div class="side-label side-b">Side B <span class="side-hint">back' + (backDir ? ' · '+backDir : '') + '</span></div>';
    tableHtml += buildDestTable(sides.back, s, false, facingOffset);
  } else {
    tableHtml += buildDestTable(s.dests, s, false, facingOffset);
  }

  // Insert after the sign-card header (the .sign-card div)
  var signCard = signView.querySelector('.sign-card');
  if (signCard) {
    // Insert tables as first children after the header
    var headerEl = signCard.querySelector('.sign-card-header');
    if (headerEl) {
      headerEl.insertAdjacentHTML('afterend', tableHtml);
    }
  }

  // Update map rotation and marker without recreating map
  if (map) updateMap();
}

function goTo(i){
  if(i<0||i>=state.filtered.length)return;
  state.filtered[state.current].editing=false;
  state.current=i; render();
  document.querySelector('.main-panel').scrollTo({top:0,behavior:'smooth'});
}
function approve()  { const s=state.filtered[state.current]; s.status='approved'; s.reviewedBy=typeof getReviewer==='function'?getReviewer():''; render(); syncToSheet(s); }
function flag()     { const s=state.filtered[state.current]; s.status='flagged';  s.reviewedBy=typeof getReviewer==='function'?getReviewer():''; render(); syncToSheet(s); }
function startEdit(){state.filtered[state.current].editing=true; renderMain();if(map){map.remove();map=null;mapMarker=null;destMarkers=[];}setTimeout(initMap,50);}
function cancelEdit(){state.filtered[state.current].editing=false;render();}
function saveEdit() {const s=state.filtered[state.current]; s.editing=false; s.status='edited'; s.reviewedBy=typeof getReviewer==='function'?getReviewer():''; render(); syncToSheet(s);}
function updateDest(i,field,val){state.filtered[state.current].dests[i][field]=val;}
function setArrow(i,deg){
  state.filtered[state.current].dests[i].deg=deg;
  const rows=document.querySelectorAll('.dest-table tbody tr');
  if(rows[i]){
    rows[i].querySelectorAll('.arrow-pick-btn').forEach((btn,bi)=>{
      const d=DIRECTIONS[bi];
      const isSel=d.deg===null?(deg===null):Number(deg)===d.deg;
      btn.classList.toggle('selected',isSel);
      if(d.deg!==null) btn.querySelectorAll('svg').forEach(s=>s.style.fill=isSel?'var(--cu-gold)':'var(--cu-muted)');
    });
  }
}
function updateNotes(val){state.filtered[state.current].notes=val;}
function removeDest(i){state.filtered[state.current].dests.splice(i,1);renderMain();if(map){map.remove();map=null;mapMarker=null;destMarkers=[];}setTimeout(initMap,50);}
function addDest(){state.filtered[state.current].dests.push({deg:null,name:'',ttd:''});renderMain();if(map){map.remove();map=null;mapMarker=null;destMarkers=[];}setTimeout(initMap,50);}
function showSummary(){const c=getCounts();alert(`Review complete!\n\n✅ Approved: ${c.approved}\n✏️  Edited: ${c.edited}\n🚩 Flagged: ${c.flagged}\n⏳ Pending: ${c.pending}\n\nUse Export to download your review CSV.`);}

/**
 * Sync a sign's status/notes/dests to Google Sheets (if connected).
 * This is a no-op if sheets.js hasn't set up the sync function.
 */
function syncToSheet(sign) {
  if (typeof sheetsWriteBack === 'function') {
    sheetsWriteBack(sign);
  }
}

// ── EXPORT ──
function exportCSV(){
  const h=['Sign ID','Type','Lat','Lng','Neighborhood',
    'R1.Arrow','R1.Destination','R1.ttd','R2.Arrow','R2.Destination','R2.ttd',
    'R3.Arrow','R3.Destination','R3.ttd','R4.Arrow','R4.Destination','R4.ttd',
    'R5.Arrow','R5.Destination','R5.ttd','R6.Arrow','R6.Destination','R6.ttd',
    'R7.Arrow','R7.Destination','R7.ttd','R8.Arrow','R8.Destination','R8.ttd',
    'Status','Notes'];
  const rows=[h.join(',')];
  state.signs.forEach(s=>{
    const row=[cv(s.id),cv(s.type),s.lat,s.lng,cv(s.nbhd)];
    for(let r=0;r<8;r++){
      const d=s.dests[r];
      row.push(cv(d?degToSymbol(d.deg):''),cv(d?d.name:''),cv(d?d.ttd:''));
    }
    row.push(cv(s.status),cv(s.notes));
    rows.push(row.join(','));
  });
  const blob=new Blob([rows.join('\n')],{type:'text/csv'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='CUB_messaging_reviewed_'+new Date().toISOString().slice(0,10)+'.csv';
  a.click();
}


// ── MAP OVERVIEW ──
let overviewMap = null;
let overviewMarkers = [];
let mapViewActive = false;

function toggleMapView() {
  mapViewActive = !mapViewActive;
  const mainPanel = document.getElementById('main-panel');
  const overviewPanel = document.getElementById('map-overview');
  const btn = document.getElementById('map-toggle-btn');

  if (mapViewActive) {
    mainPanel.style.display = 'none';
    overviewPanel.classList.add('visible');
    btn.style.borderColor = 'var(--cu-gold)';
    btn.style.color = 'var(--cu-gold)';
    initOverviewMap();
  } else {
    mainPanel.style.display = '';
    overviewPanel.classList.remove('visible');
    btn.style.borderColor = '';
    btn.style.color = '';
  }
}

function initOverviewMap() {
  if (overviewMap) { overviewMap.resize(); updateOverviewMarkers(); return; }

  var coords = state.signs.filter(s => s.lat && s.lng).map(s => [parseFloat(s.lng), parseFloat(s.lat)]);
  var center = [-105.27, 40.0];
  if (coords.length) {
    var sumLng = 0, sumLat = 0;
    coords.forEach(c => { sumLng += c[0]; sumLat += c[1]; });
    center = [sumLng / coords.length, sumLat / coords.length];
  }

  overviewMap = new maplibregl.Map({
    container: 'overview-map',
    style: getMapStyle(),
    center: center,
    zoom: 15,
    attributionControl: false
  });
  overviewMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

  if (coords.length > 1) {
    var bounds = new maplibregl.LngLatBounds(coords[0], coords[0]);
    coords.forEach(c => bounds.extend(c));
    overviewMap.fitBounds(bounds, { padding: 40 });
  }

  overviewMap.on('load', function() { updateOverviewMarkers(); });
}

function updateOverviewMarkers() {
  if (!overviewMap) return;
  overviewMarkers.forEach(m => { if (m && m.remove) m.remove(); });
  overviewMarkers = [];

  const c = getCounts();
  document.getElementById('map-stats').innerHTML = `
    <div class="map-stat"><div class="map-stat-dot" style="background:#30D158"></div>${c.approved} approved</div>
    <div class="map-stat"><div class="map-stat-dot" style="background:#FFD60A"></div>${c.edited} edited</div>
    <div class="map-stat"><div class="map-stat-dot" style="background:#FF453A"></div>${c.flagged} flagged</div>
    <div class="map-stat"><div class="map-stat-dot" style="background:#48484A"></div>${c.pending} pending</div>
    <div class="map-stat" style="color:var(--cu-gold);border-left:1px solid var(--cu-border);padding-left:1.5rem">${c.total} signs total</div>
  `;

  state.signs.forEach((s, globalIdx) => {
    const lat = parseFloat(s.lat), lng = parseFloat(s.lng);
    if (isNaN(lat) || isNaN(lng)) return;

    const ringColor = s.status==='approved'?'#30D158':s.status==='edited'?'#FFD60A':s.status==='flagged'?'#FF453A':'transparent';
    const ringStyle = ringColor !== 'transparent' ? `box-shadow:0 0 0 2px ${ringColor};border-radius:50%;` : '';

    const iconEl = document.createElement('div');
    iconEl.innerHTML = `<div style="width:18px;height:18px;${ringStyle}filter:drop-shadow(0 1px 4px rgba(0,0,0,.9));cursor:pointer;">${getTypeIcon(s.type)}</div>`;

    const destList = s.dests.slice(0,4).map(d => `<div>${escHtml(d.name)}</div>`).join('');
    const moreCount = s.dests.length > 4 ? `<div style="color:var(--cu-muted);font-size:11px">+${s.dests.length-4} more</div>` : '';

    const popupHtml = `
      <div class="popup-inner">
        <div class="popup-id">${s.id}</div>
        <div class="popup-nbhd">${s.nbhd} · ${TYPE_LABELS[s.type]||s.type}</div>
        <div class="popup-dests">${destList}${moreCount}</div>
        <button class="popup-review-btn" onclick="openReviewFromMap(${globalIdx})">Review this sign →</button>
      </div>
    `;

    const popup = new maplibregl.Popup({ closeButton: false, maxWidth: '240px', className: 'cu-popup' })
      .setHTML(popupHtml);

    const marker = new maplibregl.Marker({ element: iconEl, anchor: 'center' })
      .setLngLat([lng, lat])
      .setPopup(popup)
      .addTo(overviewMap);
    overviewMarkers.push(marker);
  });
}

function openReviewFromMap(globalIdx) {
  mapViewActive = true;
  toggleMapView();
  const s = state.signs[globalIdx];
  const filteredIdx = state.filtered.findIndex(x => x.id === s.id);
  if (filteredIdx >= 0) goTo(filteredIdx);
  else {
    document.getElementById('type-filter').value = '';
    applyFilter();
    const idx2 = state.filtered.findIndex(x => x.id === s.id);
    if (idx2 >= 0) goTo(idx2);
  }
}

function escHtml(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function cv(v){const s=(v||'').toString();return(s.includes(',')||s.includes('"')||s.includes('\n'))?`"${s.replace(/"/g,'""')}"`  :s;}

// ── INIT ──
initTheme();
if (!loadSession()) {
  // no saved session — show load screen (default state)
}
