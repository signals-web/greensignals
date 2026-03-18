// ── greensignals · sheets.js ──
// Google Sheets API integration via Google Identity Services (GIS) OAuth

// ── CONFIG (loaded from window.PROJECT) ──
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
function getSheetsClientId() { return window.PROJECT ? window.PROJECT.oauthClientId : ''; }
function getSheetId() { return window.PROJECT ? window.PROJECT.sheetId : ''; }
function getSheetTab() { return window.PROJECT ? window.PROJECT.sheetTab : 'MESSAGING'; }

// Column indices (0-based) in the Sheet
const COL = {
  SIGN_ID: 0,    // A
  TYPE: 1,       // B
  LAT: 2,        // C
  LNG: 3,        // D
  NBHD: 4,       // E
  // R1-R8: columns F-AI (5-34), each group of 4: Arrow, Auto, Override, ttd
  STATUS: 36,    // AK (was AJ in plan — adjusting to 0-indexed from header count)
  NOTES: 37,     // AL
  LAST_UPDATED: 38, // AM
  REVIEWED_BY: 39   // AN — will create this column
};

// Column letters for write-back
function colLetter(idx) {
  let s = '';
  idx++;
  while (idx > 0) {
    idx--;
    s = String.fromCharCode(65 + (idx % 26)) + s;
    idx = Math.floor(idx / 26);
  }
  return s;
}

// ── STATE ──
let tokenClient = null;
let accessToken = null;
let sheetsInitialized = false;

// ── INIT ──
function initSheetsAuth() {
  const clientId = getSheetsClientId();
  if (!clientId || clientId.startsWith('REPLACE_WITH')) {
    console.warn('Google Sheets: Client ID not configured for this project. Sheets integration disabled.');
    const btn = document.getElementById('sheets-connect-btn');
    if (btn) {
      btn.style.opacity = '0.4';
      btn.style.cursor = 'not-allowed';
      btn.title = 'OAuth Client ID not configured — see README';
    }
    return;
  }

  // Wait for GIS library to load
  if (typeof google === 'undefined' || !google.accounts) {
    setTimeout(initSheetsAuth, 200);
    return;
  }

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SHEETS_SCOPE,
    callback: handleTokenResponse,
  });

  sheetsInitialized = true;
  console.log('Google Sheets auth initialized for project:', window.PROJECT.key);
}

function handleTokenResponse(response) {
  if (response.error) {
    console.error('Sheets auth error:', response);
    showSyncToast('Auth failed: ' + (response.error_description || response.error), 'error');
    setSheetsButtonLoading(false);
    return;
  }

  accessToken = response.access_token;
  console.log('Sheets: access token obtained');
  updateSheetsStatus('connected');

  // Auto-load data from Sheet
  fetchSheetData();
}

// ── CONNECT BUTTON ──
function connectToSheets() {
  if (!sheetsInitialized) {
    alert('Google Sheets integration is not configured.\n\nTo set it up:\n1. Create a Google Cloud project\n2. Enable Sheets API\n3. Create an OAuth Client ID\n4. Add the Client ID to sheets.js');
    return;
  }

  setSheetsButtonLoading(true);

  // Request access token — opens Google consent popup
  tokenClient.requestAccessToken({ prompt: '' });
}

function setSheetsButtonLoading(loading) {
  const btn = document.getElementById('sheets-connect-btn');
  if (!btn) return;
  if (loading) {
    btn.classList.add('loading');
    btn.innerHTML = `<span style="font-size:14px">⟳</span> Connecting...`;
  } else {
    btn.classList.remove('loading');
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M19.3 3H14V0L9 5l5 5V7h4.3c1 0 1.7.7 1.7 1.7v6.6c0 1-.7 1.7-1.7 1.7H4.7C3.7 17 3 16.3 3 15.3V8.7C3 7.7 3.7 7 4.7 7H7V3H4.7C1.6 3 0 4.7 0 7.7v8.6C0 19.3 1.6 21 4.7 21h14.6c3.1 0 4.7-1.7 4.7-4.7V7.7C24 4.7 22.4 3 19.3 3z" fill="currentColor"/>
      </svg>
      Connect to Google Sheets`;
  }
}

// ── FETCH DATA ──
async function fetchSheetData() {
  if (!accessToken) return;

  try {
    const sheetTab = getSheetTab();
    const sheetId = getSheetId();
    const range = `${sheetTab}!A:AO`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`;

    const resp = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + accessToken }
    });

    if (resp.status === 401) {
      // Token expired — re-prompt
      accessToken = null;
      updateSheetsStatus('offline');
      showSyncToast('Session expired — please reconnect', 'error');
      setSheetsButtonLoading(false);
      return;
    }

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Sheets API error ${resp.status}: ${err}`);
    }

    const data = await resp.json();
    const rows = data.values;

    if (!rows || rows.length < 2) {
      showSyncToast('No data found in MESSAGING tab', 'error');
      setSheetsButtonLoading(false);
      return;
    }

    console.log(`Sheets: loaded ${rows.length - 1} rows from ${getSheetTab()}`);

    // Use the app's loadFromSheets function
    loadFromSheets(rows);

    setSheetsButtonLoading(false);
    showSyncToast(`Loaded ${rows.length - 1} signs from Google Sheets`, 'success');

  } catch (err) {
    console.error('Sheets fetch error:', err);
    showSyncToast('Failed to load: ' + err.message, 'error');
    setSheetsButtonLoading(false);
  }
}

// ── WRITE BACK ──
/**
 * Write a sign's status, notes, arrow/dest edits back to the Google Sheet.
 * Called by app.js syncToSheet() after approve/flag/saveEdit.
 */
async function sheetsWriteBack(sign) {
  if (!accessToken || !sign._sheetRow) return;

  const row = sign._sheetRow;
  const now = new Date();
  const dateStr = `${now.getMonth()+1}/${now.getDate()}/${now.getFullYear()}`;
  const reviewer = (typeof getReviewer === 'function') ? getReviewer() : 'Anonymous';

  // Build batch of cell updates
  const updates = [];

  // Status column
  updates.push({
    range: `${getSheetTab()}!${colLetter(COL.STATUS)}${row}`,
    values: [[sign.status.charAt(0).toUpperCase() + sign.status.slice(1)]]
  });

  // Notes column
  updates.push({
    range: `${getSheetTab()}!${colLetter(COL.NOTES)}${row}`,
    values: [[sign.notes || '']]
  });

  // Last Updated column
  updates.push({
    range: `${getSheetTab()}!${colLetter(COL.LAST_UPDATED)}${row}`,
    values: [[dateStr]]
  });

  // Reviewed By column
  updates.push({
    range: `${getSheetTab()}!${colLetter(COL.REVIEWED_BY)}${row}`,
    values: [[reviewer]]
  });

  // If edited, also write back arrows and destination overrides
  if (sign.status === 'edited') {
    for (let r = 0; r < 8; r++) {
      const d = sign.dests[r];
      const baseCol = 5 + r * 4; // F=5 for R1, J=9 for R2, etc.

      // Arrow column
      const arrowVal = d ? degToSymbol(d.deg) : '';
      updates.push({
        range: `${getSheetTab()}!${colLetter(baseCol)}${row}`,
        values: [[arrowVal]]
      });

      // Override column (baseCol + 2)
      const overVal = d ? d.name : '';
      updates.push({
        range: `${getSheetTab()}!${colLetter(baseCol + 2)}${row}`,
        values: [[overVal]]
      });

      // ttd column (baseCol + 3)
      const ttdVal = d ? d.ttd : '';
      updates.push({
        range: `${getSheetTab()}!${colLetter(baseCol + 3)}${row}`,
        values: [[ttdVal]]
      });
    }
  }

  try {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${getSheetId()}/values:batchUpdate`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: updates
      })
    });

    if (resp.status === 401) {
      accessToken = null;
      updateSheetsStatus('offline');
      showSyncToast('Session expired — changes saved locally only', 'error');
      return;
    }

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Write error ${resp.status}: ${err}`);
    }

    console.log(`Sheets: wrote back ${sign.id} (${sign.status})`);
    showSyncToast(`${sign.id} synced to Sheet ✓`, 'success');

  } catch (err) {
    console.error('Sheets write-back error:', err);
    showSyncToast('Write failed: ' + err.message, 'error');
  }
}

// ── UI HELPERS ──
function updateSheetsStatus(status) {
  const el = document.getElementById('sheets-status');
  if (!el) return;

  if (status === 'connected') {
    el.className = 'sheets-status connected';
    el.innerHTML = `<span class="status-indicator"></span>Connected to Sheets`;
    el.style.display = 'inline-flex';
  } else {
    el.className = 'sheets-status offline';
    el.innerHTML = `<span class="status-indicator"></span>Offline — CSV mode`;
    el.style.display = 'inline-flex';
  }
}

let syncToastTimer = null;
function showSyncToast(message, type) {
  let toast = document.getElementById('sync-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'sync-toast';
    toast.className = 'sync-toast';
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.className = `sync-toast ${type || ''}`;

  // Force reflow then show
  toast.offsetHeight;
  toast.classList.add('visible');

  clearTimeout(syncToastTimer);
  syncToastTimer = setTimeout(() => {
    toast.classList.remove('visible');
  }, 3000);
}

// ── INITIALIZE ON LOAD ──
// Wait for project config to be ready, then init Sheets auth
function _initSheetsWhenReady() {
  if (window.PROJECT_READY) {
    initSheetsAuth();
  } else {
    window.addEventListener('project-ready', () => initSheetsAuth(), { once: true });
  }
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(_initSheetsWhenReady, 100));
} else {
  setTimeout(_initSheetsWhenReady, 100);
}
