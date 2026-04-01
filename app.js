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
    map.once('style.load', function() { hideMapPOIs(map); updateMap(); });
    map.setStyle(newStyle);
  }
  // Switch overview map tile style in-place
  if (overviewMap) {
    overviewMap.once('style.load', function() { hideMapPOIs(overviewMap); updateOverviewMarkers(); });
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
  return `<div class="arrow-display">${arrowSVG(Number(deg), 14)}</div>`;
}

function arrowPickerHTML(currentDeg, rowIdx) {
  return '<div class="arrow-picker-compact">' +
    DIRECTIONS.map(function(d) {
      var isNone = d.deg === null;
      var isSel = isNone ? (currentDeg === null || currentDeg === '' || currentDeg === undefined) : (Number(currentDeg) === d.deg);
      var cls = 'arrow-pick-c' + (isSel ? ' selected' : '') + (isNone ? ' no-arrow-c' : '');
      if (isNone) {
        return '<button class="' + cls + '" onclick="setArrow(' + rowIdx + ',null)" title="No arrow">—</button>';
      }
      return '<button class="' + cls + '" onclick="setArrow(' + rowIdx + ',' + d.deg + ')" title="' + d.label + '">' + arrowSVG(d.deg, 9) + '</button>';
    }).join('') +
  '</div>';
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
    dests.forEach(function(d, idx) {
      var tagged = { ...d, _origIdx: idx };
      if (d.deg === null || d.deg === undefined) { front.push(tagged); return; }
      // Screen degrees: 0=→, 90=↓, 180=←, 270=↑
      // Convert screen deg to compass bearing, then find angle relative to facing
      var compassBearing = (Number(d.deg) + 90) % 360;
      var rel = ((compassBearing - facingDeg) + 360) % 360;
      // Front: within ±67.5° of facing (rel 0-67.5 or 292.5-360)
      // Back: within ±67.5° of opposite (rel 112.5-247.5)
      // Side: 67.5-112.5 or 247.5-292.5
      if (rel <= 67.5 || rel >= 292.5) {
        front.push(tagged);
      } else if (rel >= 112.5 && rel <= 247.5) {
        // Reflect arrow for back side (rotate 180° in screen degrees)
        back.push({ ...tagged, deg: (Number(d.deg) + 180) % 360 });
      } else {
        front.push(tagged);
        back.push(tagged);
      }
    });
  } else {
    // Default: use fixed screen-degree sets
    dests.forEach(function(d, idx) {
      var tagged = { ...d, _origIdx: idx };
      var deg = d.deg;
      if (deg === null || deg === undefined) {
        front.push(tagged);
      } else if (BACK_DEGS.has(Number(deg))) {
        back.push({ ...tagged, deg: REFLECT_MAP[Number(deg)] });
      } else if (SIDE_DEGS.has(Number(deg))) {
        front.push(tagged);
        back.push(tagged);
      } else {
        front.push(tagged);
      }
    });
  }
  return { front, back };
}

// ── STATE ──
const state = { signs:[], current:0, filtered:[], filter:'', statusFilter:'', showMine:false };
let map=null, mapMarker=null, destMarkers=[];

// ── BUILDINGS SERVICE (swap to Supabase later by editing this section) ──
var _buildingsCache = null;
var _buildingsFuse = null;

function getBuildingsList() {
  if (_buildingsCache) return Promise.resolve(_buildingsCache);
  var apiKey = (window.__ENV__ && window.__ENV__.SHEETS_API_KEY) || '';
  var sheetId = window.PROJECT ? window.PROJECT.sheetId : '';
  if (!apiKey || !sheetId) return Promise.resolve([]);
  var url = 'https://sheets.googleapis.com/v4/spreadsheets/' + sheetId + '/values/DESTINATIONS!A1:J500?key=' + apiKey;
  return fetch(url).then(function(r) { return r.json(); }).then(function(data) {
    var rows = data.values || [];
    if (rows.length < 2) return [];
    _buildingsCache = rows.slice(1).map(function(r) {
      return { id: r[0]||'', name: r[1]||'', category: r[2]||'', lat: r[3]||'', lng: r[4]||'', zone: r[5]||'', tier: r[6]||'' };
    });
    if (typeof Fuse !== 'undefined') {
      _buildingsFuse = new Fuse(_buildingsCache, { keys: ['name', 'id', 'category'], threshold: 0.35, distance: 100 });
    }
    return _buildingsCache;
  }).catch(function() { return []; });
}

function searchBuildings(query) {
  if (!query || !_buildingsFuse) return (_buildingsCache || []).slice(0, 10);
  return _buildingsFuse.search(query).slice(0, 10).map(function(r) { return r.item; });
}

function getBuildingRecents() {
  try { return JSON.parse(localStorage.getItem('cub_dest_recents') || '[]'); } catch(e) { return []; }
}
function addBuildingRecent(name) {
  var recents = getBuildingRecents().filter(function(r) { return r !== name; });
  recents.unshift(name);
  if (recents.length > 10) recents = recents.slice(0, 10);
  localStorage.setItem('cub_dest_recents', JSON.stringify(recents));
}
function getBuildingFavorites() {
  try { return JSON.parse(localStorage.getItem('cub_dest_favorites') || '[]'); } catch(e) { return []; }
}
function toggleBuildingFavorite(name) {
  var favs = getBuildingFavorites();
  var idx = favs.indexOf(name);
  if (idx >= 0) favs.splice(idx, 1); else favs.push(name);
  localStorage.setItem('cub_dest_favorites', JSON.stringify(favs));
}

// ── COMBOBOX ──
var _activeCombobox = null;

function openCombobox(inputEl, rowIdx) {
  closeCombobox();
  var wrap = inputEl.parentElement;
  var dropdown = document.createElement('div');
  dropdown.className = 'combobox-dropdown';
  dropdown.id = 'combobox-dropdown';
  wrap.style.position = 'relative';
  wrap.appendChild(dropdown);
  _activeCombobox = { input: inputEl, dropdown: dropdown, rowIdx: rowIdx };
  updateComboboxResults(inputEl.value);
}

function closeCombobox() {
  var dd = document.getElementById('combobox-dropdown');
  if (dd) dd.remove();
  _activeCombobox = null;
}

function updateComboboxResults(query) {
  if (!_activeCombobox) return;
  var dd = _activeCombobox.dropdown;
  var rowIdx = _activeCombobox.rowIdx;
  var favs = getBuildingFavorites();
  var html = '';

  if (!query) {
    // Show favorites then recents
    var favorites = favs.length ? favs : [];
    var recents = getBuildingRecents();
    if (favorites.length) {
      html += '<div class="combobox-section">Favorites</div>';
      favorites.forEach(function(name) {
        html += '<div class="combobox-item" onmousedown="selectCombobox(' + rowIdx + ',\'' + escHtml(name).replace(/'/g, "\\'") + '\')">' +
          '<span class="combobox-fav active" onmousedown="event.stopPropagation();toggleBuildingFavorite(\'' + escHtml(name).replace(/'/g, "\\'") + '\');updateComboboxResults(\'\')">★</span>' +
          escHtml(name) + '</div>';
      });
    }
    if (recents.length) {
      html += '<div class="combobox-section">Recent</div>';
      recents.forEach(function(name) {
        var isFav = favs.indexOf(name) >= 0;
        html += '<div class="combobox-item" onmousedown="selectCombobox(' + rowIdx + ',\'' + escHtml(name).replace(/'/g, "\\'") + '\')">' +
          '<span class="combobox-fav' + (isFav ? ' active' : '') + '" onmousedown="event.stopPropagation();toggleBuildingFavorite(\'' + escHtml(name).replace(/'/g, "\\'") + '\');updateComboboxResults(\'\')">' + (isFav ? '★' : '☆') + '</span>' +
          escHtml(name) + '</div>';
      });
    }
    if (!html) html = '<div class="combobox-empty">Start typing to search buildings...</div>';
  } else {
    var results = searchBuildings(query);
    if (results.length) {
      results.forEach(function(b) {
        var isFav = favs.indexOf(b.name) >= 0;
        html += '<div class="combobox-item" onmousedown="selectCombobox(' + rowIdx + ',\'' + escHtml(b.name).replace(/'/g, "\\'") + '\')">' +
          '<span class="combobox-fav' + (isFav ? ' active' : '') + '" onmousedown="event.stopPropagation();toggleBuildingFavorite(\'' + escHtml(b.name).replace(/'/g, "\\'") + '\');updateComboboxResults(\'' + escHtml(query).replace(/'/g, "\\'") + '\')">' + (isFav ? '★' : '☆') + '</span>' +
          escHtml(b.name) + '<span class="combobox-zone">' + escHtml(b.zone) + '</span></div>';
      });
    } else {
      html = '<div class="combobox-empty">No matches — type will be used as-is</div>';
    }
  }
  dd.innerHTML = html;
}

function selectCombobox(rowIdx, name) {
  updateDest(rowIdx, 'name', name);
  addBuildingRecent(name);
  closeCombobox();
  // Re-render to update the input value
  renderMain();
}

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
  getBuildingsList(); // preload for typeahead
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
  getBuildingsList(); // preload for typeahead
}

// File input and drag/drop listeners are attached by config.js after injecting the load screen UI
function togglePaste(){const el=document.getElementById('paste-area');if(el) el.style.display=el.style.display==='block'?'none':'block';}
function loadFromPaste(){const el=document.getElementById('paste-input'); if(el) loadData(el.value);}

// ── MAP (MapLibre GL JS) ──
function getMapStyle() {
  var key = (window.__ENV__ && window.__ENV__.MAPTILER_KEY) || '';
  var isLight = document.documentElement.classList.contains('light');
  return isLight
    ? 'https://api.maptiler.com/maps/streets-v2-light/style.json?key=' + key
    : 'https://api.maptiler.com/maps/streets-v2-dark/style.json?key=' + key;
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
    bearing: rot,
    interactive: false,
    attributionControl: false
  });
  map.on('load', function() { hideMapPOIs(map); updateMap(); });
}
function hideMapPOIs(m) {
  var layers = m.getStyle().layers || [];
  // Keep only road labels and place/city names — hide everything else with icons
  var keepPattern = /road|street|highway|place|city|town|village|country|state|continent|housenumber|building/i;
  layers.forEach(function(l) {
    if (!l.id) return;
    if (l.type === 'symbol' && !keepPattern.test(l.id)) {
      m.setLayoutProperty(l.id, 'visibility', 'none');
    }
  });
}
function updateMap() {
  if (!map) return;
  var s = state.filtered[state.current]; if (!s) return;
  var lat = parseFloat(s.lat), lng = parseFloat(s.lng);
  if (isNaN(lat) || isNaN(lng)) return;

  // Clear previous markers and line layers
  if (mapMarker) { mapMarker.remove(); mapMarker = null; }
  destMarkers.forEach(function(m) {
    try {
      if (typeof m === 'string') {
        if (map.getLayer(m)) map.removeLayer(m);
        if (map.getSource(m)) map.removeSource(m);
      } else if (m && m.remove) { m.remove(); }
    } catch(e) { /* layer/source already removed by style change */ }
  });
  destMarkers = [];

  // Sign marker — horizontal bar representing sign panel
  // Map bearing already rotates to face the right direction,
  // so the panel always appears as a horizontal bar (perpendicular to "up")
  var signEl = document.createElement('div');
  signEl.innerHTML = '<div class="map-sign-marker">━</div>';
  mapMarker = new maplibregl.Marker({ element: signEl, anchor: 'center' })
    .setLngLat([lng, lat]).addTo(map);

  // Theme-aware colors
  var isLight = document.documentElement.classList.contains('light');
  var lineColor = isLight ? 'rgba(80,60,10,0.6)' : 'rgba(207,184,124,0.5)';
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
    try {
      if (map.getLayer(lineId)) map.removeLayer(lineId);
      if (map.getSource(lineId)) map.removeSource(lineId);
      map.addSource(lineId, {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [[lng,lat],[dlng,dlat]] } }
      });
      // Find first symbol layer to insert lines beneath labels but above fills
      var beforeLayer = undefined;
      var allLayers = map.getStyle().layers || [];
      for (var li = 0; li < allLayers.length; li++) {
        if (allLayers[li].type === 'symbol') { beforeLayer = allLayers[li].id; break; }
      }
      map.addLayer({
        id: lineId, type: 'line', source: lineId,
        paint: { 'line-color': lineColor, 'line-width': 1.5, 'line-dasharray': [4, 3] },
        layout: { 'line-cap': 'round' }
      }, beforeLayer);
      destMarkers.push(lineId);
    } catch(e) { console.warn('Line layer error:', e); }

    // Destination dot
    var dotEl = document.createElement('div');
    dotEl.style.cssText = 'width:6px;height:6px;border-radius:50%;background:'+dotFill+';border:1px solid '+dotStroke+';';
    var dot = new maplibregl.Marker({ element: dotEl, anchor: 'center' })
      .setLngLat([dlng, dlat]).addTo(map);
    destMarkers.push(dot);

    // Destination name label
    var labelEl = document.createElement('div');
    labelEl.className = 'map-dest-label';
    labelEl.textContent = d.name;
    var label = new maplibregl.Marker({ element: labelEl, anchor: 'bottom-left', offset: [4, -4] })
      .setLngLat([dlng, dlat]).addTo(map);
    destMarkers.push(label);

    bounds.extend([dlng, dlat]);
  });

  // Nearby signs — ghosted markers at 50% size/opacity
  var currentDestNames = new Set(s.dests.map(function(d) { return (d.name || '').trim().toLowerCase(); }));
  var nearbyRadius = 0.003; // ~300m in degrees at 40°N
  state.signs.forEach(function(ns) {
    if (ns.id === s.id) return;
    var nlat = parseFloat(ns.lat), nlng = parseFloat(ns.lng);
    if (isNaN(nlat) || isNaN(nlng)) return;
    if (Math.abs(nlat - lat) > nearbyRadius || Math.abs(nlng - lng) > nearbyRadius) return;

    var hasShared = ns.dests.some(function(d) { return currentDestNames.has((d.name||'').trim().toLowerCase()); });

    // Build popup showing destinations, highlighting shared ones
    var destHtml = ns.dests.map(function(d) {
      var name = (d.name || '').trim();
      var shared = currentDestNames.has(name.toLowerCase());
      return '<div class="nearby-dest' + (shared ? ' nearby-shared' : '') + '">' + escHtml(name) + '</div>';
    }).join('');
    var popupContent = '<div class="nearby-popup">' +
      '<div class="nearby-popup-id">' + escHtml(ns.id) + ' <span class="nearby-popup-type">' + (TYPE_LABELS[ns.type]||ns.type) + '</span></div>' +
      destHtml +
      (hasShared ? '<div class="nearby-overlap-note">⚠ shared destinations</div>' : '') +
      '</div>';

    var ghostEl = document.createElement('div');
    ghostEl.className = 'nearby-marker';
    ghostEl.innerHTML = getTypeIcon(ns.type);

    var popup = new maplibregl.Popup({ closeButton: false, maxWidth: '200px', className: 'nearby-sign-popup', offset: 8 })
      .setHTML(popupContent);

    var marker = new maplibregl.Marker({ element: ghostEl, anchor: 'center' })
      .setLngLat([nlng, nlat])
      .setPopup(popup)
      .addTo(map);
    destMarkers.push(marker);

    bounds.extend([nlng, nlat]);
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
    northDiv.style.transform = 'rotate(' + (-rot) + 'deg)';
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

  // Nearby signs toggle button on map
  var nearbyBtn = clipEl ? clipEl.querySelector('.nearby-toggle-btn') : null;
  if (!nearbyBtn && clipEl) {
    nearbyBtn = document.createElement('button');
    nearbyBtn.className = 'nearby-toggle-btn';
    nearbyBtn.textContent = 'Nearby';
    nearbyBtn.onclick = function() { toggleNearbySheet(); };
    clipEl.appendChild(nearbyBtn);
  }
  // Update active state
  if (nearbyBtn) {
    var sheet = document.getElementById('nearby-sheet');
    nearbyBtn.classList.toggle('active', sheet && !sheet.classList.contains('hidden'));
  }

  // Center on sign, zoom to fit destinations
  var zoom = 17;
  if (hasDests) {
    var cam = map.cameraForBounds(bounds, { padding: 30 });
    if (cam) {
      zoom = Math.min(Math.max(Math.floor(cam.zoom) - 1, 13), 18);
    }
  }
  map.jumpTo({ center: [lng, lat], zoom: zoom, bearing: rot });

  setTimeout(function() {
    map.resize();
    map.jumpTo({ center: [lng, lat], zoom: zoom, bearing: rot });
  }, 200);
}
function mapZoom(delta) {
  if (!map) return;
  var s = state.filtered[state.current];
  var lng = parseFloat(s.lng), lat = parseFloat(s.lat);
  map.setZoom(map.getZoom() + delta);
  map.panTo([lng, lat]);
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
  state.filter = document.getElementById('type-filter').value;
  var statusEl = document.getElementById('status-filter');
  state.statusFilter = statusEl ? statusEl.value : state.statusFilter;
  var result = state.signs.slice();
  if (state.filter) result = result.filter(function(s) { return s.type === state.filter; });
  if (state.statusFilter) result = result.filter(function(s) { return s.status === state.statusFilter; });
  if (state.showMine) {
    var me = getReviewer();
    result = result.filter(function(s) { return s.reviewedBy === me; });
  }
  state.filtered = result;
  state.current = 0;
  render();
}
function toggleShowMine() {
  var me = getReviewer();
  if (!me) { requireReviewer(toggleShowMine); return; }
  state.showMine = !state.showMine;
  var btn = document.getElementById('btn-show-mine');
  if (btn) btn.classList.toggle('filter-active', state.showMine);
  applyFilter();
}
function setStatusFilter(val) {
  state.statusFilter = state.statusFilter === val ? '' : val;
  // Update button states
  document.querySelectorAll('.status-filter-btn').forEach(function(b) {
    b.classList.toggle('filter-active', b.dataset.status === state.statusFilter);
  });
  applyFilter();
}
function getCounts() {
  const s=state.signs;
  return {approved:s.filter(x=>x.status==='approved').length,edited:s.filter(x=>x.status==='edited').length,flagged:s.filter(x=>x.status==='flagged').length,pending:s.filter(x=>x.status==='pending').length,total:s.length,reviewed:s.filter(x=>x.status!=='pending').length};
}

// ── RENDER ──
function render(){renderSidebar();renderMain();renderRightPanel();updateMap();saveSession();
  var ns=document.getElementById('nearby-sheet');if(ns&&!ns.classList.contains('hidden'))renderNearbySheet();
}

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
  var viewRows = [];
  let html = `<table class="dest-table"><thead><tr>
    <th class="arrow-col">Arrow</th>
    <th>Destination</th>
    <th style="width:90px">Walk</th>
    ${editing?'<th style="width:36px"></th>':''}
  </tr></thead><tbody>`;
  dests.forEach(function(d, i) {
    // For editing mode, use _origIdx from splitSides if available, else fall back to array index
    const origIdx = editing ? (d._origIdx !== undefined ? d._origIdx : i) : sign.dests.indexOf(d);
    if (editing) {
      // Use original arrow degree for the picker (not the reflected one from splitSides)
      var pickerDeg = (d._origIdx !== undefined && sign.dests[d._origIdx]) ? sign.dests[d._origIdx].deg : d.deg;
      html+=`<tr>
        <td>${arrowPickerHTML(pickerDeg,origIdx)}</td>
        <td class="combobox-wrap"><input class="edit-input" value="${escHtml(d.name)}" oninput="updateDest(${origIdx},'name',this.value);updateComboboxResults(this.value)" onfocus="openCombobox(this,${origIdx})" onblur="setTimeout(closeCombobox,200)"></td>
        <td><input class="edit-input ttd-input" value="${escHtml(d.ttd)}" oninput="updateDest(${origIdx},'ttd',this.value)"></td>
        <td><button class="remove-btn" onclick="removeDest(${origIdx})">×</button></td>
      </tr>`;
    } else {
      // Rotate arrow relative to facing direction
      var displayDeg = d.deg;
      if (offset && displayDeg !== null && displayDeg !== undefined) {
        displayDeg = ((Number(displayDeg) - offset) + 360) % 360;
      }
      viewRows.push({ displayDeg: displayDeg, name: d.name, ttd: d.ttd });
    }
  });
  if (!editing) {
    // Sort by direction then group same-direction destinations
    viewRows.sort(function(a, b) {
      var da = a.displayDeg === null || a.displayDeg === undefined ? 999 : Number(a.displayDeg);
      var db = b.displayDeg === null || b.displayDeg === undefined ? 999 : Number(b.displayDeg);
      return da - db;
    });
    // Render sorted rows — arrow on every row, same-direction rows adjacent
    viewRows.forEach(function(r) {
      html += `<tr>`;
      html += `<td>${arrowDisplay(r.displayDeg)}</td>`;
      html += `<td class="dest-name-cell${r.name?'':' empty'}">${escHtml(r.name)||'—'}</td>`;
      html += `<td>${r.ttd?`<span class="ttd-chip">${escHtml(r.ttd)}</span>`:''}</td>`;
      html += `</tr>`;
    });
  }
  var isSplitEdit = editing && dests.length > 0 && dests[0]._origIdx !== undefined;
  if (editing && !isSplitEdit) {
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
        <div class="facing-picker${window.IS_ADMIN ? '' : ' facing-locked'}">
          <span class="facing-label">Facing${window.IS_ADMIN ? '' : ' <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 16 16" fill="currentColor" style="margin-left:4px;opacity:.5"><path d="M4 4v2h-.25A1.75 1.75 0 0 0 2 7.75v5.5c0 .966.784 1.75 1.75 1.75h8.5A1.75 1.75 0 0 0 14 13.25v-5.5A1.75 1.75 0 0 0 12.25 6H12V4a4 4 0 1 0-8 0Zm6.5 2V4a2.5 2.5 0 0 0-5 0v2ZM8 9.5a1.5 1.5 0 0 1 .75 2.8v.95a.75.75 0 0 1-1.5 0v-.95A1.5 1.5 0 0 1 8 9.5Z"/></svg>'}</span>
          <div class="facing-row">
            <div class="facing-compass">${facingCompassSvg(s._facing)}</div>
            <div class="facing-btns">
              ${['N','NE','E','SE','S','SW','W','NW'].map(function(dir) {
                var active = s._facing===dir ? ' active' : '';
                if (window.IS_ADMIN) {
                  return '<button class="facing-btn'+active+'" onclick="setFacing(\''+dir+'\')">'+dir+'</button>';
                } else {
                  return '<button class="facing-btn'+active+'" disabled>'+dir+'</button>';
                }
              }).join('')}
              ${s._facing && window.IS_ADMIN ? '<button class="facing-btn facing-clear" onclick="setFacing(null)">&times;</button>' : ''}
            </div>
          </div>
        </div>
      </div>
      <div class="map-clip"><div id="sign-map"></div></div>
    </div>`;

  // Double-sided logic: split destinations into front/back
  const sides = splitSides(s.dests, s._facing);
  const hasBackSide = sides.back.length > 0;
  const frontDir = s._facing || '';
  const backDir = s._facing ? OPPOSITE_DIR[s._facing] : '';

  // Arrow rotation offset: subtract facing compass degrees from screen degrees
  // e.g. facing N (0°) = no change; facing E (90°) = east arrow becomes ↑
  var facingScreenOffset = s._facing ? DIR_DEGS[s._facing] : 0;

  if(hasBackSide) {
    html+=`<div class="sides-row">`;
    html+=`<div class="side-col"><div class="side-label">Side A <span class="side-hint">front${frontDir ? ' · '+frontDir : ''}</span></div>`;
    html+=buildDestTable(sides.front, s, s.editing, facingScreenOffset);
    if(s.editing) html+=`<button class="add-btn" onclick="addDestToSide('front')" style="margin:8px 1rem">+ Add destination</button>`;
    html+=`</div>`;
    html+=`<div class="side-col"><div class="side-label side-b">Side B <span class="side-hint">back${backDir ? ' · '+backDir : ''}</span></div>`;
    html+=buildDestTable(sides.back, s, s.editing, facingScreenOffset);
    if(s.editing) html+=`<button class="add-btn" onclick="addDestToSide('back')" style="margin:8px 1rem">+ Add destination</button>`;
    html+=`</div>`;
    html+=`</div>`;
  } else if(s.editing) {
    html+=buildDestTable(s.dests, s, true);
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
    if(s.status==='approved'){
      html+=`<button class="action-btn btn-unapprove" onclick="unapprove()">Remove approval</button>`;
    } else {
      html+=`<button class="action-btn btn-approve" onclick="approve()">Approve</button>`;
    }
    html+=`<button class="action-btn btn-edit" onclick="startEdit()">Edit destinations</button>`;
    if(s.status==='flagged'){
      html+=`<button class="action-btn btn-unflag" onclick="unflag()">Remove flag</button>`;
    } else {
      html+=`<button class="action-btn btn-flag" onclick="flag()">Flag for discussion</button>`;
    }
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
  // Load comments for this sign from Firebase (now in right panel)
  if (typeof loadComments === 'function') loadComments(s.id);
}

function postComment() {
  var input = document.getElementById('comment-input');
  var text = input ? input.value.trim() : '';
  if (!text) return;
  var s = state.filtered[state.current];
  requireReviewer(function() {
    if (typeof fbPostComment === 'function') {
      fbPostComment(s.id, text, getReviewer());
      input.value = '';
    }
  });
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

  // Remove old side labels, tables, and sides-row wrapper
  oldLabels.forEach(function(el){ el.remove(); });
  oldTables.forEach(function(el){ el.remove(); });
  var oldRow = signView.querySelector('.sides-row');
  if (oldRow) oldRow.remove();

  // Build new content
  var tableHtml = '';
  if (hasBackSide) {
    tableHtml += '<div class="sides-row">';
    tableHtml += '<div class="side-col"><div class="side-label">Side A <span class="side-hint">front' + (frontDir ? ' · '+frontDir : '') + '</span></div>';
    tableHtml += buildDestTable(sides.front, s, false, facingOffset);
    tableHtml += '</div>';
    tableHtml += '<div class="side-col"><div class="side-label side-b">Side B <span class="side-hint">back' + (backDir ? ' · '+backDir : '') + '</span></div>';
    tableHtml += buildDestTable(sides.back, s, false, facingOffset);
    tableHtml += '</div>';
    tableHtml += '</div>';
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
function approve()    { requireReviewer(function(){ const s=state.filtered[state.current]; s.status='approved'; s.reviewedBy=getReviewer(); render(); syncToSheet(s); }); }
function unapprove()  { requireReviewer(function(){ const s=state.filtered[state.current]; s.status='pending';  s.reviewedBy=''; render(); syncToSheet(s); }); }
function flag()       { requireReviewer(function(){ const s=state.filtered[state.current]; s.status='flagged';  s.reviewedBy=getReviewer(); render(); syncToSheet(s); }); }
function unflag()     { requireReviewer(function(){ const s=state.filtered[state.current]; s.status='pending';  s.reviewedBy=''; render(); syncToSheet(s); }); }
function startEdit(){state.filtered[state.current].editing=true; renderMain();if(map){map.remove();map=null;mapMarker=null;destMarkers=[];}setTimeout(initMap,50);}
function cancelEdit(){state.filtered[state.current].editing=false;render();}
function saveEdit() { requireReviewer(function(){ const s=state.filtered[state.current]; s.editing=false; s.status='edited'; s.reviewedBy=getReviewer(); render(); syncToSheet(s); }); }
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
function addDestToSide(side){
  var s = state.filtered[state.current];
  var facing = s._facing;
  // Set a default arrow direction based on which side
  var deg = null;
  if (facing) {
    var facingDeg = DIR_DEGS[facing];
    if (side === 'front') {
      // Arrow pointing away from sign in facing direction
      deg = (facingDeg + 360 - 90) % 360; // compass to screen degrees
    } else {
      // Arrow pointing away in opposite direction
      var oppDeg = (facingDeg + 180) % 360;
      deg = (oppDeg + 360 - 90) % 360;
    }
  }
  s.dests.push({deg: deg, name:'', ttd:''});
  renderMain();
  if(map){map.remove();map=null;mapMarker=null;destMarkers=[];}
  setTimeout(initMap,50);
}
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

  var rp = document.getElementById('right-panel');
  if (mapViewActive) {
    // Close other views
    if (freqViewActive) {
      freqViewActive = false;
      document.getElementById('freq-report').classList.remove('visible');
      var freqBtn = document.getElementById('freq-toggle-btn');
      freqBtn.style.borderColor = '';
      freqBtn.style.color = '';
    }
    if (bnViewActive) { bnViewActive = false; document.getElementById('building-names').classList.remove('visible'); }
    mainPanel.style.display = 'none';
    if (rp) rp.style.display = 'none';
    overviewPanel.classList.add('visible');
    btn.style.borderColor = 'var(--cu-gold)';
    btn.style.color = 'var(--cu-gold)';
    initOverviewMap();
  } else {
    mainPanel.style.display = '';
    if (rp) rp.style.display = '';
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

  overviewMap.on('load', function() { hideMapPOIs(overviewMap); updateOverviewMarkers(); });
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

  state.filtered.forEach((s, filteredIdx) => {
    const lat = parseFloat(s.lat), lng = parseFloat(s.lng);
    if (isNaN(lat) || isNaN(lng)) return;

    const ringColor = s.status==='approved'?'#30D158':s.status==='edited'?'#FFD60A':s.status==='flagged'?'#FF453A':'transparent';
    const ringStyle = ringColor !== 'transparent' ? `box-shadow:0 0 0 2px ${ringColor};border-radius:50%;` : '';

    const iconEl = document.createElement('div');
    iconEl.innerHTML = `<div style="width:18px;height:18px;${ringStyle}cursor:pointer;">${getTypeIcon(s.type)}</div>`;

    const destList = s.dests.slice(0,4).map(d => `<div>${escHtml(d.name)}</div>`).join('');
    const moreCount = s.dests.length > 4 ? `<div style="color:var(--cu-muted);font-size:11px">+${s.dests.length-4} more</div>` : '';

    const popupHtml = `
      <div class="popup-inner">
        <div class="popup-id">${s.id}</div>
        <div class="popup-nbhd">${s.nbhd} · ${TYPE_LABELS[s.type]||s.type}</div>
        <div class="popup-dests">${destList}${moreCount}</div>
        <button class="popup-review-btn" onclick="openReviewFromMap(${filteredIdx})">Review this sign →</button>
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

function openReviewFromMap(filteredIdx) {
  mapViewActive = true;
  toggleMapView();
  if (filteredIdx >= 0 && filteredIdx < state.filtered.length) goTo(filteredIdx);
}

function escHtml(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function cv(v){const s=(v||'').toString();return(s.includes(',')||s.includes('"')||s.includes('\n'))?`"${s.replace(/"/g,'""')}"`  :s;}

// ── BUILDING FREQUENCY REPORT ──
let freqViewActive = false;
let freqSortField = 'count';
let freqSortAsc = false;

function toggleFreqReport() {
  freqViewActive = !freqViewActive;
  const mainPanel = document.getElementById('main-panel');
  const freqPanel = document.getElementById('freq-report');
  const mapPanel = document.getElementById('map-overview');
  const freqBtn = document.getElementById('freq-toggle-btn');
  const mapBtn = document.getElementById('map-toggle-btn');

  var rp = document.getElementById('right-panel');
  if (freqViewActive) {
    // Close other views
    if (mapViewActive) {
      mapViewActive = false;
      mapPanel.classList.remove('visible');
      mapBtn.style.borderColor = '';
      mapBtn.style.color = '';
    }
    if (bnViewActive) { bnViewActive = false; document.getElementById('building-names').classList.remove('visible'); }
    mainPanel.style.display = 'none';
    if (rp) rp.style.display = 'none';
    freqPanel.classList.add('visible');
    freqBtn.style.borderColor = 'var(--cu-gold)';
    freqBtn.style.color = 'var(--cu-gold)';
    populateFreqZones();
    updateFreqReport();
  } else {
    mainPanel.style.display = '';
    if (rp) rp.style.display = '';
    freqPanel.classList.remove('visible');
    freqBtn.style.borderColor = '';
    freqBtn.style.color = '';
  }
}

function populateFreqZones() {
  const zoneSet = new Set();
  state.signs.forEach(function(s) { if (s.nbhd) zoneSet.add(s.nbhd); });
  const sel = document.getElementById('freq-zone-filter');
  const current = sel.value;
  sel.innerHTML = '<option value="">All zones</option>' +
    Array.from(zoneSet).sort().map(function(z) {
      return '<option value="' + escHtml(z) + '"' + (z === current ? ' selected' : '') + '>' + escHtml(z) + '</option>';
    }).join('');
}

function buildFreqData() {
  const typeFilter = document.getElementById('freq-type-filter').value;
  const zoneFilter = document.getElementById('freq-zone-filter').value;

  // Filter signs
  var signs = state.signs;
  if (typeFilter) signs = signs.filter(function(s) { return s.type === typeFilter; });
  if (zoneFilter) signs = signs.filter(function(s) { return s.nbhd === zoneFilter; });

  // Aggregate by building name
  var buildingMap = {};
  signs.forEach(function(s) {
    s.dests.forEach(function(d) {
      var name = (d.name || '').trim();
      if (!name) return;
      if (!buildingMap[name]) {
        buildingMap[name] = { name: name, count: 0, zones: new Set(), types: new Set(), signIds: [] };
      }
      buildingMap[name].count++;
      if (s.nbhd) buildingMap[name].zones.add(s.nbhd);
      if (s.type) buildingMap[name].types.add(s.type);
      if (buildingMap[name].signIds.indexOf(s.id) === -1) buildingMap[name].signIds.push(s.id);
    });
  });

  var rows = Object.values(buildingMap);

  // Sort
  rows.sort(function(a, b) {
    var va, vb;
    if (freqSortField === 'name') {
      va = a.name.toLowerCase(); vb = b.name.toLowerCase();
      return freqSortAsc ? (va < vb ? -1 : va > vb ? 1 : 0) : (vb < va ? -1 : vb > va ? 1 : 0);
    } else if (freqSortField === 'zones') {
      va = Array.from(a.zones).sort().join(', ').toLowerCase();
      vb = Array.from(b.zones).sort().join(', ').toLowerCase();
      return freqSortAsc ? (va < vb ? -1 : va > vb ? 1 : 0) : (vb < va ? -1 : vb > va ? 1 : 0);
    } else {
      va = a.count; vb = b.count;
      return freqSortAsc ? va - vb : vb - va;
    }
  });

  return { rows: rows, totalSigns: signs.length };
}

function updateFreqReport() {
  var data = buildFreqData();
  var tbody = document.getElementById('freq-tbody');
  var summary = document.getElementById('freq-summary');

  summary.innerHTML = '<span class="freq-stat">' + data.rows.length + ' buildings</span>' +
    '<span class="freq-stat">' + data.totalSigns + ' signs</span>' +
    '<span class="freq-stat">' + data.rows.reduce(function(s, r) { return s + r.count; }, 0) + ' destination references</span>';

  tbody.innerHTML = data.rows.map(function(r) {
    var zones = Array.from(r.zones).sort().map(function(z) {
      return '<span class="freq-zone-pill">' + escHtml(z) + '</span>';
    }).join(' ');
    var types = Array.from(r.types).sort().map(function(t) {
      return '<span class="freq-type-pill freq-type-' + t.toLowerCase() + '">' + t + '</span>';
    }).join(' ');
    return '<tr>' +
      '<td class="freq-name">' + escHtml(r.name) + '</td>' +
      '<td class="freq-count">' + r.count + '</td>' +
      '<td>' + zones + '</td>' +
      '<td>' + types + '</td>' +
      '<td><button class="freq-view-btn" onclick="freqViewSigns(this.dataset.name)" data-name="' + escHtml(r.name) + '">View signs →</button></td>' +
      '</tr>';
  }).join('');

  // Update sort icons
  ['name', 'count', 'zones'].forEach(function(f) {
    var el = document.getElementById('freq-sort-' + f);
    if (el) el.textContent = freqSortField === f ? (freqSortAsc ? '↑' : '↓') : '↕';
  });
}

function sortFreqBy(field) {
  if (freqSortField === field) {
    freqSortAsc = !freqSortAsc;
  } else {
    freqSortField = field;
    freqSortAsc = field === 'name';
  }
  updateFreqReport();
}

function freqViewSigns(buildingName) {
  // Close freq report
  freqViewActive = false;
  document.getElementById('freq-report').classList.remove('visible');
  document.getElementById('main-panel').style.display = '';
  var rp = document.getElementById('right-panel');
  if (rp) rp.style.display = '';
  var btn = document.getElementById('freq-toggle-btn');
  btn.style.borderColor = '';
  btn.style.color = '';

  // Filter sign list to show only signs containing this building
  state.filtered = state.signs.filter(function(s) {
    return s.dests.some(function(d) { return d.name === buildingName; });
  });
  state.current = 0;
  render();

  // Show a toast so the user knows what happened
  showSyncToast('Showing ' + state.filtered.length + ' signs with "' + buildingName + '"', 'success');
}

// ── RIGHT PANEL ──
function haversine(lat1, lng1, lat2, lng2) {
  var R = 20902231; // Earth radius in feet
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLng = (lng2 - lng1) * Math.PI / 180;
  var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
    Math.sin(dLng/2) * Math.sin(dLng/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function getNearbySignData(currentSign) {
  var MAX_DIST_FT = 400;
  var currentDests = {};
  currentSign.dests.forEach(function(d) {
    if (d.name) currentDests[d.name.trim().toLowerCase()] = true;
  });

  return state.signs
    .filter(function(s) { return s.id !== currentSign.id && s.lat && s.lng; })
    .map(function(s) {
      var dist = haversine(parseFloat(currentSign.lat), parseFloat(currentSign.lng), parseFloat(s.lat), parseFloat(s.lng));
      var shared = 0;
      s.dests.forEach(function(d) {
        if (d.name && currentDests[d.name.trim().toLowerCase()]) shared++;
      });
      return { sign: s, distFt: Math.round(dist), sharedCount: shared };
    })
    .filter(function(n) { return n.distFt <= MAX_DIST_FT; })
    .sort(function(a, b) { return b.sharedCount - a.sharedCount || a.distFt - b.distFt; })
    .slice(0, 8);
}

function renderRightPanel() {
  restoreRPCollapsed();
}

// ── NEARBY SIGNS PULLOUT SHEET ──
function toggleNearbySheet() {
  var sheet = document.getElementById('nearby-sheet');
  if (!sheet) return;
  var isHidden = sheet.classList.contains('hidden');
  sheet.classList.toggle('hidden');
  // Update toggle button state
  var btn = document.querySelector('.nearby-toggle-btn');
  if (btn) btn.classList.toggle('active', isHidden);
  if (isHidden) renderNearbySheet();
}

function renderNearbySheet() {
  var s = state.filtered[state.current];
  if (!s) return;
  // Current sign's destination names for overlap detection
  var currentDests = {};
  s.dests.forEach(function(d) { if (d.name) currentDests[d.name.trim().toLowerCase()] = true; });

  var nearby = getNearbySignData(s);
  var html = '';
  if (nearby.length === 0) {
    html = '<div class="ns-empty">No nearby signs share destinations</div>';
  } else {
    nearby.forEach(function(n) {
      var idx = state.filtered.indexOf(n.sign);
      var clickAttr = idx >= 0 ? ' onclick="goTo(' + idx + ')"' : '';
      var sharedBadge = '<span class="ns-shared">' + n.sharedCount + ' shared</span>';
      // Build destination list with overlaps highlighted
      var destsHtml = n.sign.dests.map(function(d) {
        if (!d.name) return '';
        var isOverlap = currentDests[d.name.trim().toLowerCase()];
        return '<div class="ns-dest' + (isOverlap ? ' ns-overlap' : '') + '">' + escHtml(d.name) + '</div>';
      }).join('');
      html += '<div class="ns-item">' +
        '<div class="ns-item-row"' + clickAttr + '>' +
        '<span class="ns-icon">' + getTypeIcon(n.sign.type) + '</span>' +
        '<span class="status-dot dot-' + n.sign.status + '"></span>' +
        '<span class="ns-id">' + escHtml(n.sign.id) + '</span>' +
        sharedBadge +
        '<span class="ns-dist">' + n.distFt + ' ft</span>' +
        '</div>' +
        '<div class="ns-dests">' + destsHtml + '</div>' +
        '</div>';
    });
    html += '<div class="ns-note">Red = shared with ' + escHtml(s.id) + '</div>';
  }
  var body = document.getElementById('nearby-sheet-body');
  if (body) body.innerHTML = html;
}


function toggleRPSection(id) {
  var el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('collapsed');
  var key = 'rp_collapsed';
  var stored = {};
  try { stored = JSON.parse(localStorage.getItem(key) || '{}'); } catch(e) {}
  stored[id] = el.classList.contains('collapsed');
  localStorage.setItem(key, JSON.stringify(stored));
}

function restoreRPCollapsed() {
  try {
    var stored = JSON.parse(localStorage.getItem('rp_collapsed') || '{}');
    Object.keys(stored).forEach(function(id) {
      var el = document.getElementById(id);
      if (el && stored[id]) el.classList.add('collapsed');
      else if (el) el.classList.remove('collapsed');
    });
  } catch(e) {}
}

// ── BUILDING NAMES REVIEW ──
let bnViewActive = false;
let bnSortField = 'count';
let bnSortAsc = false;
let bnData = []; // computed list of { name, count, zones, signs, status }

function openBuildingNames() {
  bnViewActive = true;
  var mainPanel = document.getElementById('main-panel');
  var bnPanel = document.getElementById('building-names');
  var rp = document.getElementById('right-panel');

  // Close other views
  if (mapViewActive) {
    mapViewActive = false;
    document.getElementById('map-overview').classList.remove('visible');
    var mapBtn = document.getElementById('map-toggle-btn');
    mapBtn.style.borderColor = ''; mapBtn.style.color = '';
  }
  if (freqViewActive) {
    freqViewActive = false;
    document.getElementById('freq-report').classList.remove('visible');
    var freqBtn = document.getElementById('freq-toggle-btn');
    freqBtn.style.borderColor = ''; freqBtn.style.color = '';
  }

  mainPanel.style.display = 'none';
  if (rp) rp.style.display = 'none';
  bnPanel.classList.add('visible');
  populateBNZones();
  computeBuildingNames();
  renderBuildingNames();
}

function closeBuildingNames() {
  bnViewActive = false;
  document.getElementById('building-names').classList.remove('visible');
  document.getElementById('main-panel').style.display = '';
  var rp = document.getElementById('right-panel');
  if (rp) rp.style.display = '';
}

function populateBNZones() {
  var zoneSet = new Set();
  state.signs.forEach(function(s) { if (s.nbhd) zoneSet.add(s.nbhd); });
  var sel = document.getElementById('bn-zone-filter');
  var current = sel.value;
  sel.innerHTML = '<option value="">All zones</option>';
  Array.from(zoneSet).sort().forEach(function(z) {
    sel.innerHTML += '<option value="' + escHtml(z) + '"' + (z === current ? ' selected' : '') + '>' + escHtml(z) + '</option>';
  });
}

function computeBuildingNames() {
  var nameMap = {};
  // Get BN statuses from localStorage
  var bnStatuses = {};
  try { bnStatuses = JSON.parse(localStorage.getItem('cub_bn_statuses') || '{}'); } catch(e) {}

  state.signs.forEach(function(s) {
    s.dests.forEach(function(d) {
      if (!d.name) return;
      var name = d.name.trim();
      if (!nameMap[name]) nameMap[name] = { name: name, count: 0, zones: new Set(), types: new Set(), signs: [] };
      nameMap[name].count++;
      if (s.nbhd) nameMap[name].zones.add(s.nbhd);
      if (s.type) nameMap[name].types.add(s.type);
      nameMap[name].signs.push(s);
    });
  });

  bnData = Object.values(nameMap).map(function(b) {
    return {
      name: b.name,
      count: b.count,
      zones: Array.from(b.zones).sort(),
      types: Array.from(b.types),
      signs: b.signs,
      status: bnStatuses[b.name] || 'pending'
    };
  });
}

function renderBuildingNames() {
  var search = (document.getElementById('bn-search').value || '').trim().toLowerCase();
  var zone = document.getElementById('bn-zone-filter').value;

  var filtered = bnData.filter(function(b) {
    if (search && b.name.toLowerCase().indexOf(search) < 0) return false;
    if (zone && b.zones.indexOf(zone) < 0) return false;
    return true;
  });

  // Sort
  filtered.sort(function(a, b) {
    var result = 0;
    if (bnSortField === 'name') result = a.name.localeCompare(b.name);
    else if (bnSortField === 'count') result = a.count - b.count;
    return bnSortAsc ? result : -result;
  });

  // Summary
  var approved = bnData.filter(function(b) { return b.status === 'approved'; }).length;
  var flagged = bnData.filter(function(b) { return b.status === 'flagged'; }).length;
  var pending = bnData.filter(function(b) { return b.status === 'pending'; }).length;
  document.getElementById('bn-summary').innerHTML =
    '<span class="bn-stat">' + bnData.length + ' buildings</span>' +
    '<span class="bn-stat" style="color:var(--approve)">' + approved + ' approved</span>' +
    '<span class="bn-stat" style="color:var(--flag)">' + flagged + ' flagged</span>' +
    '<span class="bn-stat">' + pending + ' pending</span>';

  // Sort icons
  ['name', 'count'].forEach(function(f) {
    var icon = document.getElementById('bn-sort-' + f);
    if (icon) icon.textContent = bnSortField === f ? (bnSortAsc ? '↑' : '↓') : '↕';
  });

  // Table rows
  var tbody = document.getElementById('bn-tbody');
  tbody.innerHTML = filtered.map(function(b) {
    var zonePills = b.zones.map(function(z) { return '<span class="bn-zone-pill">' + escHtml(z) + '</span>'; }).join('');
    var statusCls = 'bn-status-' + b.status;
    var statusLabel = b.status.charAt(0).toUpperCase() + b.status.slice(1);
    var actions = '';
    if (b.status !== 'approved') actions += '<button class="bn-approve-btn" onclick="setBNStatus(\'' + escHtml(b.name).replace(/'/g, "\\'") + '\',\'approved\')">✓</button>';
    if (b.status !== 'flagged') actions += '<button class="bn-flag-btn" onclick="setBNStatus(\'' + escHtml(b.name).replace(/'/g, "\\'") + '\',\'flagged\')">⚑</button>';
    if (b.status !== 'pending') actions += '<button class="bn-approve-btn" onclick="setBNStatus(\'' + escHtml(b.name).replace(/'/g, "\\'") + '\',\'pending\')" style="color:var(--cu-muted)">↺</button>';
    return '<tr>' +
      '<td class="bn-name">' + escHtml(b.name) + '</td>' +
      '<td class="bn-count">' + b.count + '</td>' +
      '<td>' + zonePills + '</td>' +
      '<td><span class="bn-status-pill ' + statusCls + '">' + statusLabel + '</span></td>' +
      '<td>' + actions + '</td>' +
      '</tr>';
  }).join('');
}

function sortBNBy(field) {
  if (bnSortField === field) bnSortAsc = !bnSortAsc;
  else { bnSortField = field; bnSortAsc = field === 'name'; }
  renderBuildingNames();
}

function filterBuildingNames() { renderBuildingNames(); }

function setBNStatus(name, status) {
  var bnStatuses = {};
  try { bnStatuses = JSON.parse(localStorage.getItem('cub_bn_statuses') || '{}'); } catch(e) {}
  if (status === 'pending') delete bnStatuses[name];
  else bnStatuses[name] = status;
  localStorage.setItem('cub_bn_statuses', JSON.stringify(bnStatuses));
  // Update in-memory
  bnData.forEach(function(b) { if (b.name === name) b.status = status; });
  renderBuildingNames();
}

// Keyboard: Escape exits map/freq/bn views
document.addEventListener('keydown', function(e) {
  var tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

  if (e.key === 'Escape') {
    if (mapViewActive) toggleMapView();
    else if (freqViewActive) toggleFreqReport();
    else if (bnViewActive) closeBuildingNames();
  }
});

// ── INIT ──
initTheme();
if (!loadSession()) {
  // no saved session — show load screen (default state)
}
