// ── sosisu signal · config.js ──
// Reads ?project= from URL, loads projects.json, sets global config + branding

(async function() {
  'use strict';

  // ── Read project key from URL ──
  const params = new URLSearchParams(window.location.search);
  const projectKey = params.get('project');

  // ── Fetch project configs ──
  let projects;
  try {
    const resp = await fetch('projects.json');
    if (!resp.ok) throw new Error('Failed to load projects.json');
    projects = await resp.json();
  } catch (err) {
    console.error('Config error:', err);
    showProjectError('Could not load project configuration.');
    return;
  }

  // ── No project param → show project picker ──
  if (!projectKey) {
    showProjectPicker();
    return;
  }

  // ── Invalid project key ──
  const config = projects[projectKey];
  if (!config) {
    showProjectError(`Project "${projectKey}" not found. Check your URL.`);
    return;
  }

  // ── Set global config ──
  config.key = projectKey;
  window.PROJECT = config;
  window.IS_ADMIN = params.get('admin') === 'true';
  console.log(`Config: loaded project "${projectKey}" (${config.name})${window.IS_ADMIN ? ' [ADMIN]' : ''}`);

  // ── Hide admin-only elements for reviewers ──
  if (!window.IS_ADMIN) {
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
  }

  // ── Apply branding ──
  document.title = config.title;

  // Override accent color CSS variable
  document.documentElement.style.setProperty('--cu-gold', config.accentColor);

  // Compute accent rgba from hex for background tints
  const r = parseInt(config.accentColor.slice(1,3), 16);
  const g = parseInt(config.accentColor.slice(3,5), 16);
  const b = parseInt(config.accentColor.slice(5,7), 16);
  document.documentElement.style.setProperty('--accent-r', r);
  document.documentElement.style.setProperty('--accent-g', g);
  document.documentElement.style.setProperty('--accent-b', b);

  // Update DOM branding text
  const sidebarBrand = document.querySelector('.sidebar-brand');
  if (sidebarBrand) sidebarBrand.textContent = config.brand;

  const sidebarTitle = document.querySelector('.sidebar-title');
  if (sidebarTitle) sidebarTitle.textContent = 'Messaging Review';

  // Inject the full load screen UI with project branding
  const screen = document.getElementById('load-screen');
  if (screen) {
    const isAdmin = window.IS_ADMIN;

    // Google Sheets connect button removed (2026-04-09) — data now flows through internal DB + CSV import
    const sheetsBtn = `
      <div class="drop-zone" id="drop-zone">
        <input type="file" id="file-input" accept=".csv">
        <div class="drop-icon">↑</div>
        <div class="drop-label">
          <strong>Drop CSV file here</strong><br>or click to browse
        </div>
      </div>
      <div class="paste-toggle" onclick="togglePaste()">Or paste CSV data directly</div>
      <div id="paste-area">
        <textarea id="paste-input" placeholder="Paste CSV content here..."></textarea>
        <button class="paste-btn" onclick="loadFromPaste()">Load pasted data</button>
      </div>`;

    const reviewerLoad = `
      <div class="load-subtitle" style="margin-bottom:1.5rem">Loading sign data...</div>
      <div style="font-size:13px;color:var(--cu-muted)">Data is loaded automatically from the project database.<br>If this takes too long, contact your SOSISU project manager.</div>`;

    screen.innerHTML = `
      <div class="load-logo"><span>${config.brand}</span> · ${config.studio}</div>
      <div class="load-title">Sign Messaging Review</div>
      <div class="load-subtitle">${isAdmin ? 'Load a CSV file to begin' : 'Welcome, reviewer'}</div>
      ${isAdmin ? sheetsBtn : reviewerLoad}
    `;

    // Re-attach file input and drag/drop listeners (since DOM was replaced)
    setTimeout(() => {
      const fi = document.getElementById('file-input');
      if (fi) fi.addEventListener('change', e => {
        const f = e.target.files[0]; if (!f) return;
        const r = new FileReader(); r.onload = ev => loadData(ev.target.result); r.readAsText(f);
      });
      const dz = document.getElementById('drop-zone');
      if (dz) {
        dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
        dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
        dz.addEventListener('drop', e => {
          e.preventDefault(); dz.classList.remove('drag-over');
          const f = e.dataTransfer.files[0]; if (!f) return;
          const r = new FileReader(); r.onload = ev => loadData(ev.target.result); r.readAsText(f);
        });
      }
    }, 0);
  }

  // Mark config as ready — other scripts wait for this
  window.PROJECT_READY = true;
  window.dispatchEvent(new Event('project-ready'));

})();

// ── MISSING PROJECT SCREEN ──
function showProjectPicker() {
  const screen = document.getElementById('load-screen');
  if (!screen) return;

  screen.innerHTML = `
    <div class="load-logo">Signal</div>
    <div class="load-title">Sign Messaging Review</div>
    <div class="load-subtitle">Use the project link provided by your team to get started.</div>
    <div style="margin-top:2rem;font-size:13px;color:var(--cu-muted)">
      If you don't have a link, contact your SOSISU project manager.
    </div>
  `;
}

// ── ERROR SCREEN ──
function showProjectError(message) {
  const screen = document.getElementById('load-screen');
  if (!screen) return;

  screen.innerHTML = `
    <div class="load-logo">Signal</div>
    <div class="load-title" style="color:#FF453A">Configuration Error</div>
    <div class="load-subtitle">${message}</div>
    <div style="margin-top:2rem;font-size:13px;color:var(--cu-muted)">
      Please check your URL or contact your SOSISU project manager.
    </div>
  `;
}
