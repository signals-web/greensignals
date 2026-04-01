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

    // ── COMMENTS ──
    let _commentUnsub = null;

    window.fbPostComment = function(signId, text, reviewer) {
      const safeId = signId.replace(/[.#$/[\]]/g, '_');
      const commentRef = ref(db, `projects/${projectPath}/comments/${safeId}`);
      push(commentRef, {
        text,
        author: reviewer || 'Anonymous',
        ts: serverTimestamp()
      });
    };

    window.loadComments = function(signId) {
      const safeId = signId.replace(/[.#$/[\]]/g, '_');
      const commentRef = ref(db, `projects/${projectPath}/comments/${safeId}`);
      window._currentCommentSignId = safeId;
      // Detach previous listener
      if (_commentUnsub) { _commentUnsub(); _commentUnsub = null; }
      _commentUnsub = onValue(commentRef, (snapshot) => {
        const data = snapshot.val();
        const thread = document.getElementById('comment-thread');
        const count = document.getElementById('comment-count');
        if (!thread) return;
        if (!data) {
          thread.innerHTML = '<div class="comment-empty">No comments yet</div>';
          if (count) count.textContent = '';
          return;
        }
        const entries = Object.entries(data).filter(([,c]) => c.ts).sort((a, b) => a[1].ts - b[1].ts);
        const active = entries.filter(([,c]) => !c.resolved);
        if (count) count.textContent = active.length || '';
        thread.innerHTML = entries.map(([key, c]) => {
          const resolved = c.resolved ? ' resolved' : '';
          return `<div class="comment-item${resolved}">
            <div class="comment-meta">
              <strong>${_escComment(c.author)}</strong>
              <span class="comment-time">${_timeAgo(c.ts)}</span>
              <span class="comment-actions">
                ${c.resolved
                  ? `<button class="comment-action-btn" onclick="fbUnresolveComment('${key}')">reopen</button>`
                  : `<button class="comment-action-btn" onclick="fbResolveComment('${key}')">resolve</button>`}
                <button class="comment-action-btn" onclick="fbDeleteComment('${key}')">delete</button>
              </span>
            </div>
            <div class="comment-text">${_escComment(c.text)}</div>
          </div>`;
        }).join('');
        thread.scrollTop = thread.scrollHeight;
      });
    };

    window.fbResolveComment = function(key) {
      const safeId = window._currentCommentSignId;
      if (!safeId) return;
      import('https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js').then(({ ref: dbRef, update }) => {
        update(dbRef(db, `projects/${projectPath}/comments/${safeId}/${key}`), { resolved: true });
      });
    };

    window.fbUnresolveComment = function(key) {
      const safeId = window._currentCommentSignId;
      if (!safeId) return;
      import('https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js').then(({ ref: dbRef, update }) => {
        update(dbRef(db, `projects/${projectPath}/comments/${safeId}/${key}`), { resolved: false });
      });
    };

    window.fbDeleteComment = function(key) {
      const safeId = window._currentCommentSignId;
      if (!safeId) return;
      import('https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js').then(({ ref: dbRef, remove: fbRemove }) => {
        fbRemove(dbRef(db, `projects/${projectPath}/comments/${safeId}/${key}`));
      });
    };

    // ── DIRECTION COMMENTS ──
    let _dirCommentUnsub = null;

    window.fbPostDirectionComment = function(signId, text, reviewer) {
      const safeId = signId.replace(/[.#$/[\]]/g, '_');
      const dirRef = ref(db, `projects/${projectPath}/directionComments/${safeId}`);
      push(dirRef, {
        text,
        author: reviewer || 'Anonymous',
        ts: serverTimestamp()
      });
    };

    window.fbLogDirectionChange = function(signId, dir, reviewer) {
      const safeId = signId.replace(/[.#$/[\]]/g, '_');
      const dirRef = ref(db, `projects/${projectPath}/directionComments/${safeId}`);
      push(dirRef, {
        text: dir ? `Set facing to ${dir}` : 'Cleared facing direction',
        author: reviewer || 'Admin',
        ts: serverTimestamp(),
        isSystem: true
      });
    };

    window.loadDirectionComments = function(signId) {
      const safeId = signId.replace(/[.#$/[\]]/g, '_');
      const dirRef = ref(db, `projects/${projectPath}/directionComments/${safeId}`);
      if (_dirCommentUnsub) { _dirCommentUnsub(); _dirCommentUnsub = null; }
      _dirCommentUnsub = onValue(dirRef, (snapshot) => {
        const data = snapshot.val();
        const thread = document.getElementById('dir-comment-thread');
        if (!thread) return;
        if (!data) {
          thread.innerHTML = '';
          return;
        }
        const entries = Object.entries(data).filter(([,c]) => c.ts).sort((a, b) => a[1].ts - b[1].ts);
        thread.innerHTML = entries.map(([, c]) => {
          const sys = c.isSystem ? ' dir-system' : '';
          return `<div class="dir-comment-item${sys}">
            <strong>${_escComment(c.author)}</strong>
            <span class="comment-time">${_timeAgo(c.ts)}</span>
            <span class="dir-comment-text">${_escComment(c.text)}</span>
          </div>`;
        }).join('');
        thread.scrollTop = thread.scrollHeight;
      });
    };

    function _escComment(s) { return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

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
