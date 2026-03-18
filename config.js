// ── greensignals · config.js ──
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
    showProjectPicker(projects);
    return;
  }

  // ── Invalid project key ──
  const config = projects[projectKey];
  if (!config) {
    showProjectError(`Project "${projectKey}" not found. Check your URL.`, projects);
    return;
  }

  // ── Set global config ──
  config.key = projectKey;
  window.PROJECT = config;
  console.log(`Config: loaded project "${projectKey}" (${config.name})`);

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
    screen.innerHTML = `
      <div class="load-logo"><span>${config.brand}</span> · ${config.studio}</div>
      <div class="load-title">Sign Messaging Review</div>
      <div class="load-subtitle">Connect to Google Sheets or load a CSV to begin</div>

      <button class="sheets-connect-btn" id="sheets-connect-btn" onclick="connectToSheets()">
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M19.3 3H14V0L9 5l5 5V7h4.3c1 0 1.7.7 1.7 1.7v6.6c0 1-.7 1.7-1.7 1.7H4.7C3.7 17 3 16.3 3 15.3V8.7C3 7.7 3.7 7 4.7 7H7V3H4.7C1.6 3 0 4.7 0 7.7v8.6C0 19.3 1.6 21 4.7 21h14.6c3.1 0 4.7-1.7 4.7-4.7V7.7C24 4.7 22.4 3 19.3 3z" fill="currentColor"/>
        </svg>
        Connect to Google Sheets
      </button>

      <div class="load-divider">or load a CSV file</div>

      <div class="drop-zone" id="drop-zone">
        <input type="file" id="file-input" accept=".csv">
        <div class="drop-icon">↑</div>
        <div class="drop-label">
          <strong>Drop CSV file here</strong><br>or click to browse<br>
          <span style="font-size:12px;margin-top:4px;display:block">Google Sheets → File → Download → CSV</span>
        </div>
      </div>
      <div class="paste-toggle" onclick="togglePaste()">Or paste CSV data directly</div>
      <div id="paste-area">
        <textarea id="paste-input" placeholder="Paste CSV content here..."></textarea>
        <button class="paste-btn" onclick="loadFromPaste()">Load pasted data</button>
      </div>
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

// ── PROJECT PICKER SCREEN ──
function showProjectPicker(projects) {
  const screen = document.getElementById('load-screen');
  if (!screen) return;

  const keys = Object.keys(projects);
  const cards = keys.map(key => {
    const p = projects[key];
    return `<a class="project-card" href="?project=${key}" style="border-color:${p.accentColor}">
      <div class="project-card-name" style="color:${p.accentColor}">${p.name}</div>
      <div class="project-card-sub">Sign Messaging Review</div>
    </a>`;
  }).join('');

  screen.innerHTML = `
    <div class="load-logo">SIGNALS Studio</div>
    <div class="load-title">Select a project</div>
    <div class="load-subtitle">Choose which project to review</div>
    <div class="project-grid">${cards}</div>
  `;
}

// ── ERROR SCREEN ──
function showProjectError(message, projects) {
  const screen = document.getElementById('load-screen');
  if (!screen) return;

  let extra = '';
  if (projects) {
    const keys = Object.keys(projects);
    extra = `<div style="margin-top:2rem;font-size:13px;color:var(--cu-muted)">Available projects:
      ${keys.map(k => `<a href="?project=${k}" style="color:var(--cu-gold);margin-left:8px">${k}</a>`).join('')}
    </div>`;
  }

  screen.innerHTML = `
    <div class="load-logo">SIGNALS Studio</div>
    <div class="load-title" style="color:#FF453A">Configuration Error</div>
    <div class="load-subtitle">${message}</div>
    ${extra}
  `;
}
