// ── greensignals · app.js ──
// Core application state, CSV parsing, rendering, actions, maps

// ── THEME ──
function toggleTheme() {
  const isLight = document.documentElement.classList.toggle('light');
  document.getElementById('theme-btn').textContent = isLight ? '☾' : '☀';
  localStorage.setItem('cub_theme', isLight ? 'light' : 'dark');
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

// ── DOUBLE-SIDED SIGN LOGIC ──
// Back-facing arrows (behind the viewer): ↓(90), ↘(45), ↙(135)
// Side arrows (perpendicular): →(0), ←(180)
// Front-facing arrows (ahead): ↑(270), ↗(315), ↖(225)
const BACK_DEGS = new Set([90, 45, 135]);
const SIDE_DEGS = new Set([0, 180]);
const REFLECT_MAP = { 90: 270, 45: 225, 135: 315 }; // ↓→↑, ↘→↖, ↙→↗

function splitSides(dests) {
  const front = [], back = [];
  dests.forEach(function(d) {
    const deg = d.deg;
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

// ── MAP ──
function initMap() {
  const el=document.getElementById('sign-map');
  if(!el||map)return;
  const s=state.filtered[state.current];
  const lat=s?parseFloat(s.lat):40.0;
  const lng=s?parseFloat(s.lng):-105.27;
  map=L.map('sign-map',{zoomControl:false,attributionControl:false,dragging:false,scrollWheelZoom:false,doubleClickZoom:false}).setView([lat,lng],16);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
  setTimeout(function(){map.invalidateSize();updateMap();},100);
}
function updateMap() {
  if(!map)return;
  const s=state.filtered[state.current];if(!s)return;
  const lat=parseFloat(s.lat),lng=parseFloat(s.lng);if(isNaN(lat)||isNaN(lng))return;

  // Clear previous markers and lines
  if(mapMarker)map.removeLayer(mapMarker);
  destMarkers.forEach(function(m){map.removeLayer(m);});
  destMarkers=[];

  // Sign marker
  const svgContent = getTypeIcon(s.type);
  const iconHtml = `<div style="width:14px;height:14px;filter:drop-shadow(0 1px 3px rgba(0,0,0,.8));">${svgContent}</div>`;
  const icon=L.divIcon({html:iconHtml,iconSize:[14,14],iconAnchor:[7,7],className:''});
  mapMarker=L.marker([lat,lng],{icon}).addTo(map);

  // Walking radius circle (meters ≈ walk minutes × 80m/min)
  // N: ~2 min, SD: ~5 min, M: ~7 min, PM: ~10 min
  const maxDist = {N:150, SD:400, M:560, PM:800}[s.type] || 400;
  const radiusCircle = L.circle([lat,lng], {
    radius: maxDist, color:'#CFB87C', fillColor:'rgba(207,184,124,0.06)',
    weight:1.5, dashArray:'6 4', fillOpacity:1
  }).addTo(map);
  destMarkers.push(radiusCircle);

  // Destination markers with labels and connecting lines
  const bounds = radiusCircle.getBounds();
  s.dests.forEach(function(d) {
    if(!d.name) return;
    const pos = estimateDestPos(lat, lng, d.deg, d.ttd);
    if(!pos) return;
    const dlat = pos.lat, dlng = pos.lng;

    // Connecting line
    const line = L.polyline([[lat,lng],[dlat,dlng]], {
      color:'rgba(207,184,124,0.35)', weight:1.5, dashArray:'4 4'
    }).addTo(map);
    destMarkers.push(line);

    // Destination dot
    const dot = L.circleMarker([dlat,dlng], {
      radius:3, fillColor:'#CFB87C', fillOpacity:0.9,
      color:'rgba(0,0,0,0.5)', weight:1
    }).addTo(map);
    destMarkers.push(dot);

    // Name label at destination
    const label = L.marker([dlat,dlng], {
      icon: L.divIcon({
        html: `<div class="map-dest-label">${escHtml(d.name)}</div>`,
        iconSize:[0,0], iconAnchor:[-8,-4], className:''
      })
    }).addTo(map);
    destMarkers.push(label);

    bounds.extend([dlat,dlng]);
  });

  map.invalidateSize();
  map.fitBounds(bounds.pad(0.1));
  setTimeout(function(){map.invalidateSize();map.fitBounds(bounds.pad(0.1));},150);
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

function buildDestTable(dests, sign, editing) {
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
      html+=`<tr>
        <td>${arrowDisplay(d.deg)}</td>
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
        <div class="sign-rotation">
          <span class="rotation-label">Facing${s._facing ? ': '+s._facing : ''}</span>
          <div class="compass-widget" onclick="handleCompassClick(event)">
            <svg viewBox="0 0 80 80" class="compass-svg">
              <circle cx="40" cy="40" r="36" fill="none" stroke="rgba(207,184,124,0.2)" stroke-width="1"/>
              <circle cx="40" cy="40" r="28" fill="none" stroke="rgba(207,184,124,0.1)" stroke-width="1"/>
              ${['N','NE','E','SE','S','SW','W','NW'].map(function(dir,i) {
                var a = i*45*Math.PI/180;
                var tx = 40 + 36*Math.sin(a);
                var ty = 40 - 36*Math.cos(a);
                var isActive = s._facing===dir;
                var fill = isActive ? '#CFB87C' : 'rgba(207,184,124,0.4)';
                var fs = i%2===0 ? '7' : '5.5';
                return '<text x="'+tx+'" y="'+ty+'" text-anchor="middle" dominant-baseline="central" fill="'+fill+'" font-size="'+fs+'" font-family="monospace" style="cursor:pointer;font-weight:'+(isActive?'bold':'normal')+'">'+dir+'</text>';
              }).join('')}
              ${s._facing ? (function(){
                var fi = ['N','NE','E','SE','S','SW','W','NW'].indexOf(s._facing);
                var fa = fi*45*Math.PI/180;
                var nx = 40 + 24*Math.sin(fa);
                var ny = 40 - 24*Math.cos(fa);
                return '<line x1="40" y1="40" x2="'+nx+'" y2="'+ny+'" stroke="#CFB87C" stroke-width="2" stroke-linecap="round"/>' +
                       '<circle cx="'+nx+'" cy="'+ny+'" r="3" fill="#CFB87C"/>' +
                       '<circle cx="40" cy="40" r="2" fill="#CFB87C"/>';
              })() : '<circle cx="40" cy="40" r="2" fill="rgba(207,184,124,0.3)"/>'}
            </svg>
          </div>
          ${s._facing ? '<button class="compass-clear" onclick="setFacing(null)">clear</button>' : ''}
        </div>
      </div>
      <div id="sign-map"></div>
    </div>`;

  // Double-sided logic: split destinations into front/back when not editing
  const sides = !s.editing ? splitSides(s.dests) : null;
  const hasBackSide = sides && sides.back.length > 0;

  if(s.editing) {
    // Editing mode: single flat table (edit all destinations)
    html+=buildDestTable(s.dests, s, true);
  } else if(hasBackSide) {
    // Double-sided: show Side A and Side B
    html+=`<div class="side-label">Side A <span class="side-hint">front</span></div>`;
    html+=buildDestTable(sides.front, s, false);
    html+=`<div class="side-label side-b">Side B <span class="side-hint">back</span></div>`;
    html+=buildDestTable(sides.back, s, false);
  } else {
    // Single-sided: all destinations on front
    html+=buildDestTable(s.dests, s, false);
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
  if(map){map.remove();map=null;mapMarker=null;}
  setTimeout(initMap,200);
}

// ── ACTIONS ──
function setFacing(dir) {
  const s = state.filtered[state.current];
  s._facing = dir;
  renderMain();
}
function handleCompassClick(e) {
  const svg = e.currentTarget.querySelector('svg');
  const rect = svg.getBoundingClientRect();
  const cx = rect.left + rect.width/2, cy = rect.top + rect.height/2;
  const dx = e.clientX - cx, dy = -(e.clientY - cy); // flip Y for math
  const angle = ((Math.atan2(dx, dy) * 180 / Math.PI) + 360) % 360;
  // Snap to nearest 45°
  const dirs = ['N','NE','E','SE','S','SW','W','NW'];
  const idx = Math.round(angle / 45) % 8;
  setFacing(dirs[idx]);
}

function goTo(i){
  if(i<0||i>=state.filtered.length)return;
  state.filtered[state.current].editing=false;
  state.current=i; render();
  document.querySelector('.main-panel').scrollTo({top:0,behavior:'smooth'});
}
function approve()  { const s=state.filtered[state.current]; s.status='approved'; s.reviewedBy=typeof getReviewer==='function'?getReviewer():''; render(); syncToSheet(s); }
function flag()     { const s=state.filtered[state.current]; s.status='flagged';  s.reviewedBy=typeof getReviewer==='function'?getReviewer():''; render(); syncToSheet(s); }
function startEdit(){state.filtered[state.current].editing=true; renderMain();if(map){map.remove();map=null;mapMarker=null;}setTimeout(initMap,50);}
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
function removeDest(i){state.filtered[state.current].dests.splice(i,1);renderMain();if(map){map.remove();map=null;mapMarker=null;}setTimeout(initMap,50);}
function addDest(){state.filtered[state.current].dests.push({deg:null,name:'',ttd:''});renderMain();if(map){map.remove();map=null;mapMarker=null;}setTimeout(initMap,50);}
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
  if (overviewMap) { overviewMap.invalidateSize(); updateOverviewMarkers(); return; }

  overviewMap = L.map('overview-map', { zoomControl: true, attributionControl: false });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(overviewMap);

  const coords = state.signs.filter(s => s.lat && s.lng).map(s => [parseFloat(s.lat), parseFloat(s.lng)]);
  if (coords.length) overviewMap.fitBounds(coords, { padding: [40, 40] });

  updateOverviewMarkers();
}

function updateOverviewMarkers() {
  if (!overviewMap) return;
  overviewMarkers.forEach(m => overviewMap.removeLayer(m));
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

    const iconHtml = `<div style="width:18px;height:18px;${ringStyle}filter:drop-shadow(0 1px 4px rgba(0,0,0,.9));">${getTypeIcon(s.type)}</div>`;
    const icon = L.divIcon({ html: iconHtml, iconSize:[18,18], iconAnchor:[9,9], className:'' });

    const destList = s.dests.slice(0,4).map(d => `<div>${escHtml(d.name)}</div>`).join('');
    const moreCount = s.dests.length > 4 ? `<div style="color:var(--cu-muted);font-size:11px">+${s.dests.length-4} more</div>` : '';

    const popup = L.popup({ closeButton: false, maxWidth: 240, className: 'cu-popup' }).setContent(`
      <div class="popup-inner">
        <div class="popup-id">${s.id}</div>
        <div class="popup-nbhd">${s.nbhd} · ${TYPE_LABELS[s.type]||s.type}</div>
        <div class="popup-dests">${destList}${moreCount}</div>
        <button class="popup-review-btn" onclick="openReviewFromMap(${globalIdx})">Review this sign →</button>
      </div>
    `);

    const marker = L.marker([lat, lng], { icon }).bindPopup(popup).addTo(overviewMap);
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
