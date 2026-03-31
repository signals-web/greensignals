// ── greensignals · firebase.js ──
// Firebase Realtime Database: multi-user sync, activity feed, reviewer identity

// ── FIREBASE CONFIG ──
// Loaded from env.js (gitignored) — see env.example.js for template
const FIREBASE_CONFIG = window.__ENV__?.FIREBASE_CONFIG || {};

const FIREBASE_ENABLED = FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey !== "REPLACE_WITH_API_KEY";

function _initFirebase() {
  if (!FIREBASE_ENABLED) return;
  const projectPath = window.PROJECT ? window.PROJECT.firebasePath : 'default';

  import('https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js').then(({ initializeApp }) => {
  import('https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js').then(({ getDatabase, ref, push, onValue, serverTimestamp }) => {

    const app = initializeApp(FIREBASE_CONFIG);
    const db  = getDatabase(app);
    const actRef = ref(db, `projects/${projectPath}/activity`);
    const stateRef = ref(db, `projects/${projectPath}/signState`);

    // ── WRITE ACTION TO FIREBASE ──
    window.fbLogAction = function(signId, action, reviewer) {
      push(actRef, {
        signId,
        action,
        reviewer: reviewer || 'Anonymous',
        ts: serverTimestamp()
      });
    };

    // ── WRITE SIGN STATE TO FIREBASE ──
    window.fbSyncSign = function(sign, reviewer) {
      import('https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js').then(({ ref: dbRef, set }) => {
        const safeId = sign.id.replace(/[.#$/[\]]/g, '_');
        set(dbRef(db, `projects/${projectPath}/signState/${safeId}`), {
          id: sign.id,
          status: sign.status,
          notes: sign.notes,
          dests: sign.dests,
          reviewedBy: reviewer || 'Anonymous',
          updatedAt: Date.now()
        });
      });
    };

    // ── LISTEN FOR SIGN STATE CHANGES (other users) ──
    onValue(stateRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) return;
      let changed = false;
      Object.values(data).forEach(remote => {
        const local = state.signs.find(s => s.id === remote.id);
        if (!local) return;
        const reviewer = localStorage.getItem('cub_reviewer_name') || 'Anonymous';
        if (remote.reviewedBy !== reviewer) {
          local.status = remote.status;
          local.notes  = remote.notes;
          if (remote.dests) local.dests = remote.dests;
          changed = true;
        }
      });
      if (changed && typeof render === 'function') render();
    });

    // ── LISTEN FOR ACTIVITY FEED ──
    onValue(actRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) return;
      const items = Object.values(data)
        .filter(d => d.ts)
        .sort((a, b) => b.ts - a.ts)
        .slice(0, 20);
      const list = document.getElementById('activity-list');
      if (!list) return;
      list.innerHTML = items.map(item => {
        const age = _timeAgo(item.ts);
        const cls = 'act-' + item.action;
        return `<div class="activity-item"><strong>${item.reviewer}</strong> <span class="${cls}">${item.action}</span> ${item.signId}<span class="activity-time">${age}</span></div>`;
      }).join('');
    });

    window.firebaseReady = true;
    console.log(`Firebase connected (project: ${projectPath})`);

  });
  });
}

// Wait for project config before connecting Firebase
if (window.PROJECT_READY) {
  _initFirebase();
} else {
  window.addEventListener('project-ready', () => _initFirebase(), { once: true });
}

function _timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)  return 'just now';
  if (s < 3600) return Math.floor(s/60) + 'm ago';
  return Math.floor(s/3600) + 'h ago';
}

// ── USER NAME ──
function promptUserName() {
  document.getElementById('user-prompt-overlay').style.display = 'flex';
  setTimeout(() => document.getElementById('user-name-input').focus(), 50);
}

function saveUserName() {
  const name = document.getElementById('user-name-input').value.trim();
  if (!name) return;
  localStorage.setItem('cub_reviewer_name', name);
  document.getElementById('user-prompt-overlay').style.display = 'none';
  updateReviewerChip();
  // Run pending action if any
  if (window._pendingReviewAction) {
    const fn = window._pendingReviewAction;
    window._pendingReviewAction = null;
    fn();
  }
}

function updateReviewerChip() {
  const name = localStorage.getItem('cub_reviewer_name');
  const chip = document.getElementById('reviewer-chip');
  if (chip) chip.textContent = name ? '● ' + name : 'Set your name';
}

function getReviewer() {
  return localStorage.getItem('cub_reviewer_name') || '';
}

// Gate: require name before any review action
function requireReviewer(callback) {
  if (getReviewer()) { callback(); return; }
  // Store callback to run after name is set
  window._pendingReviewAction = callback;
  promptUserName();
}

// ── ACTIVITY FEED TOGGLE ──
let activityOpen = true;
function toggleActivityFeed() {
  activityOpen = !activityOpen;
  document.getElementById('activity-list').style.display = activityOpen ? '' : 'none';
  document.getElementById('activity-toggle').textContent = activityOpen ? '▲' : '▼';
}

// ── PATCH ACTIONS TO LOG TO FIREBASE ──
const _origApprove = window.approve;
window.approve = function() {
  _origApprove();
  const s = state.filtered[state.current];
  if (window.firebaseReady) { fbLogAction(s.id, 'approved', getReviewer()); fbSyncSign(s, getReviewer()); }
};
const _origFlag = window.flag;
window.flag = function() {
  _origFlag();
  const s = state.filtered[state.current];
  if (window.firebaseReady) { fbLogAction(s.id, 'flagged', getReviewer()); fbSyncSign(s, getReviewer()); }
};
const _origSaveEdit = window.saveEdit;
window.saveEdit = function() {
  _origSaveEdit();
  const s = state.filtered[state.current];
  if (window.firebaseReady) { fbLogAction(s.id, 'edited', getReviewer()); fbSyncSign(s, getReviewer()); }
};

// ── INIT ──
const _origLoadData = window.loadData;
window.loadData = function(text) {
  _origLoadData(text);
  setTimeout(() => {
    if (!localStorage.getItem('cub_reviewer_name')) promptUserName();
    updateReviewerChip();
  }, 400);
};

const _origLoadSession = window.loadSession;
window.loadSession = function() {
  const result = _origLoadSession();
  if (result) {
    setTimeout(() => {
      if (!localStorage.getItem('cub_reviewer_name')) promptUserName();
      updateReviewerChip();
    }, 400);
  }
  return result;
};

// Also hook loadFromSheets
const _origLoadFromSheets = window.loadFromSheets;
window.loadFromSheets = function(rows) {
  _origLoadFromSheets(rows);
  setTimeout(() => {
    if (!localStorage.getItem('cub_reviewer_name')) promptUserName();
    updateReviewerChip();
  }, 400);
};
