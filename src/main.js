import './styles.css';
import { APP_VERSION, AUTH_ENABLED } from './config.js';
import { parseInstagramZip } from './instagramImport.js';
import { compareSnapshots, calculateNotFollowingBack } from './compare.js';
import { getLatestSnapshot, saveSnapshot, getActivity, appendActivity } from './repository.js';
import { getAuthUser, sendOtpEmail, logoutUser, subscribeToAuth } from './auth.js';
import { supabaseReady } from './supabase.js';
import { loadLocalKnownAccounts, saveLocalKnownAccounts } from './storage.js';
import { syncKnownAccounts, classifyAccount, categorizeNotFollowingBack } from './accounts.js';

const state = {
  user: null,
  snapshot: null,
  activity: [],
  knownAccounts: loadLocalKnownAccounts(),
  lastImportOutcome: localStorage.getItem('fc_last_outcome') || null,
  currentView: 'homeView',
  notBackSearch: '',
  activityFilter: 'all', // 'all' | 'unfollowed' | 'followed'
  pendingEmail: '',
  activeMenuUser: null,
  collapsedCategories: {
    famous: true,
    ignored: true,
    deleted: true
  }
};

const esc = s => String(s).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const initials = u => (u ? u.slice(0, 2).toUpperCase() : '??');

function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '—';
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${day}/${month}/${year} · ${hours}:${minutes}`;
  } catch {
    return '—';
  }
}

let cooldownTimer = null;
let cooldownSeconds = 0;

function startCooldown(seconds = 60) {
  cooldownSeconds = seconds;
  const btn = document.querySelector('#sendOtpBtn');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = `Reenviar en ${cooldownSeconds}s`;

  if (cooldownTimer) clearInterval(cooldownTimer);
  cooldownTimer = setInterval(() => {
    cooldownSeconds -= 1;
    const currentBtn = document.querySelector('#sendOtpBtn');
    if (cooldownSeconds <= 0) {
      clearInterval(cooldownTimer);
      cooldownTimer = null;
      if (currentBtn) {
        currentBtn.disabled = false;
        currentBtn.textContent = 'Enviar enlace de acceso';
      }
    } else if (currentBtn) {
      currentBtn.textContent = `Reenviar en ${cooldownSeconds}s`;
    }
  }, 1000);
}

function renderAuth() {
  const app = document.querySelector('#app');
  app.innerHTML = `
    <main class="app auth-view">
      <header>
        <div class="header-brand">
          <h1>FollowCheck</h1>
          <div class="badge">v${APP_VERSION}</div>
        </div>
      </header>

      <section class="card auth-card">
        <h2>Acceso Privado</h2>
        <p>Inicia sesión con tu correo para sincronizar tus seguidores de forma privada y segura con Supabase.</p>

        <form class="auth-form" id="authEmailForm">
          <input
            id="authEmailInput"
            type="email"
            placeholder="tu@email.com"
            value="${esc(state.pendingEmail)}"
            required
            autocomplete="email"
          />
          <button type="submit" class="primary" id="sendOtpBtn" ${cooldownSeconds > 0 ? 'disabled' : ''}>
            ${cooldownSeconds > 0 ? `Reenviar en ${cooldownSeconds}s` : 'Enviar enlace de acceso'}
          </button>
        </form>

        <div class="status" id="authStatus"></div>
      </section>
    </main>
  `;

  const emailForm = document.querySelector('#authEmailForm');
  const authStatus = document.querySelector('#authStatus');

  emailForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const emailInput = document.querySelector('#authEmailInput');
    const btn = document.querySelector('#sendOtpBtn');
    const email = emailInput.value.trim();

    if (!email || cooldownSeconds > 0) return;

    btn.disabled = true;
    authStatus.className = 'status';
    authStatus.textContent = 'Enviando enlace de acceso…';

    try {
      await sendOtpEmail(email);
      state.pendingEmail = email;
      authStatus.className = 'status success';
      authStatus.textContent = 'Te hemos enviado un enlace de acceso. Abre tu correo y pulsa Sign in.';
      startCooldown(60);
    } catch (err) {
      const errMsg = String(err?.message || '').toLowerCase();
      authStatus.className = 'status error';
      if (errMsg.includes('rate limit') || err?.status === 429) {
        authStatus.textContent = 'Has solicitado demasiados enlaces. Espera unos minutos antes de volver a intentarlo.';
        startCooldown(60);
      } else {
        authStatus.textContent = `Error: ${err.message}`;
        btn.disabled = false;
      }
    }
  });
}

function renderAccountPopover(u, category) {
  let actionsHtml = '';
  if (category === 'normal') {
    actionsHtml = `
      <button class="popover-item" data-action="famous" data-user="${esc(u)}">⭐ Marcar como famosa</button>
      <button class="popover-item" data-action="ignore" data-user="${esc(u)}">👁️ Ignorar cuenta</button>
      <button class="popover-item danger" data-action="delete" data-user="${esc(u)}">🗑️ Marcar como eliminada</button>
    `;
  } else if (category === 'famous') {
    actionsHtml = `
      <button class="popover-item" data-action="restore" data-user="${esc(u)}">↩️ Mover a No me siguen</button>
      <button class="popover-item" data-action="ignore" data-user="${esc(u)}">👁️ Ignorar cuenta</button>
      <button class="popover-item danger" data-action="delete" data-user="${esc(u)}">🗑️ Marcar como eliminada</button>
    `;
  } else if (category === 'ignored') {
    actionsHtml = `
      <button class="popover-item" data-action="restore" data-user="${esc(u)}">↩️ Volver a incluir (No me siguen)</button>
      <button class="popover-item" data-action="famous" data-user="${esc(u)}">⭐ Marcar como famosa</button>
      <button class="popover-item danger" data-action="delete" data-user="${esc(u)}">🗑️ Marcar como eliminada</button>
    `;
  } else if (category === 'deleted') {
    actionsHtml = `
      <button class="popover-item" data-action="restore" data-user="${esc(u)}">↩️ Restaurar como activa</button>
      <button class="popover-item" data-action="famous" data-user="${esc(u)}">⭐ Marcar como famosa</button>
      <button class="popover-item" data-action="ignore" data-user="${esc(u)}">👁️ Ignorar cuenta</button>
    `;
  }
  return `
    <div class="account-popover" data-popover-for="${esc(u)}">
      ${actionsHtml}
    </div>
  `;
}

function renderAccountRow(u, category) {
  const isMenuOpen = state.activeMenuUser === u;
  let pillHtml = '<div class="pill bad">no te sigue</div>';
  if (category === 'famous') pillHtml = '<div class="pill info">⭐ Famosa</div>';
  if (category === 'ignored') pillHtml = '<div class="pill muted-pill">👁️ Ignorada</div>';
  if (category === 'deleted') pillHtml = '<div class="pill bad-soft-pill">🗑️ Eliminada</div>';

  return `
    <div class="account-row">
      <a class="account-link" href="https://www.instagram.com/${encodeURIComponent(u)}/" target="_blank" rel="noopener noreferrer">
        <div class="avatar">${esc(initials(u))}</div>
        <div class="grow">
          <div class="name">@${esc(u)}</div>
          <div class="sub">Tocar para abrir en Instagram</div>
        </div>
      </a>
      <div class="account-actions">
        ${pillHtml}
        <button class="menu-btn ${isMenuOpen ? 'active' : ''}" data-menu-user="${esc(u)}" title="Opciones" aria-label="Opciones de cuenta">⋯</button>
      </div>
      ${isMenuOpen ? renderAccountPopover(u, category) : ''}
    </div>
  `;
}

function renderApp() {
  const snapshot = state.snapshot;
  const notBackAll = calculateNotFollowingBack(snapshot);
  const categorized = categorizeNotFollowingBack(notBackAll, state.knownAccounts);
  
  const query = state.notBackSearch.toLowerCase().trim();
  const normalFiltered = categorized.notFollowingBack.filter(u => u.toLowerCase().includes(query));
  const famousFiltered = categorized.famous.filter(u => u.toLowerCase().includes(query));
  const ignoredFiltered = categorized.ignored.filter(u => u.toLowerCase().includes(query));
  const deletedFiltered = categorized.deleted.filter(u => u.toLowerCase().includes(query));

  const unfollowedCount = state.activity.filter(e => e.type === 'unfollowed').length;
  const followedCount = state.activity.filter(e => e.type === 'followed').length;

  const filteredActivity = state.activity.filter(e => {
    if (state.activityFilter === 'unfollowed') return e.type === 'unfollowed';
    if (state.activityFilter === 'followed') return e.type === 'followed';
    return true;
  });

  const app = document.querySelector('#app');
  app.innerHTML = `
    <main class="app">
      <header>
        <div class="header-brand">
          <h1>FollowCheck</h1>
          <div class="badge">v${APP_VERSION}</div>
        </div>
        ${AUTH_ENABLED ? `
          <div class="header-user">
            <span class="user-tag" title="${esc(state.user?.email || '')}">
              ${esc(state.user?.email || (supabaseReady() ? 'Conectado' : 'Modo local'))}
            </span>
            ${state.user ? '<button class="btn-logout" id="logoutBtn">Salir</button>' : ''}
          </div>
        ` : ''}
      </header>

      <!-- VISTA 1: INICIO -->
      <section id="homeView" class="${state.currentView === 'homeView' ? '' : 'hidden'}">
        <div class="grid">
          <div class="stat"><strong id="followersCount">${snapshot?.followers?.length ?? '—'}</strong><span>Seguidores</span></div>
          <div class="stat"><strong id="followingCount">${snapshot?.following?.length ?? '—'}</strong><span>Seguidos</span></div>
          <div class="stat"><strong id="notBackCount">${snapshot ? categorized.notFollowingBack.length : '—'}</strong><span>No te siguen</span></div>
        </div>

        <div class="info-banner">
          <div>
            <div class="label">Última actualización</div>
            <div class="value">${formatDate(snapshot?.importedAt)}</div>
          </div>
          <div>
            <span class="badge">${state.lastImportOutcome ? esc(state.lastImportOutcome) : (snapshot ? 'Sincronizado' : 'Sin datos')}</span>
          </div>
        </div>

        <div class="section">
          <div class="section-title">
            <h2>Actualizar Instagram</h2>
            <small>${AUTH_ENABLED ? (supabaseReady() ? (state.user ? 'Supabase conectado' : 'Sin sesión') : 'Modo local') : 'Almacenamiento local'}</small>
          </div>
          <div class="card import-box">
            <div class="name">Importa tu ZIP oficial</div>
            <div class="sub">Exportación JSON de Instagram (Seguidores y seguidos).</div>
            <input id="zipInput" type="file" accept=".zip,application/zip">
            <button id="importBtn" class="primary">Analizar y guardar</button>
            <div class="status" id="importStatus"></div>
          </div>
        </div>

        <div class="section">
          <div class="section-title">
            <h2>Actividad reciente</h2>
            <small>${state.activity.length} cambios registrados</small>
          </div>
          <div class="card" id="activityPreview">
            ${state.activity.length ? state.activity.slice(0, 3).map(e => `
              <div class="row">
                <div class="avatar ${e.type === 'unfollowed' ? 'down' : 'up'}">
                  ${e.type === 'unfollowed' ? '↓' : '↑'}
                </div>
                <div class="grow">
                  <div class="name">@${esc(e.username)}</div>
                  <div class="sub">${e.type === 'unfollowed' ? 'Te dejó de seguir' : 'Empezó a seguirte'}</div>
                </div>
                <div class="pill ${e.type === 'unfollowed' ? 'bad' : 'good'}">${formatDate(e.createdAt)}</div>
              </div>
            `).join('') : '<div class="empty">Todavía no hay cambios registrados.</div>'}
          </div>
        </div>
      </section>

      <!-- VISTA 2: NO ME SIGUEN -->
      <section id="notBackView" class="${state.currentView === 'notBackView' ? '' : 'hidden'}">
        <div class="section">
          <div class="section-title">
            <h2>No me siguen</h2>
            <small id="notBackLabel">${snapshot ? normalFiltered.length + ' de ' + categorized.notFollowingBack.length + ' cuentas' : '0 cuentas'}</small>
          </div>
          <div class="search-bar">
            <input id="searchNotBack" type="text" placeholder="Buscar por usuario…" value="${esc(state.notBackSearch)}" />
          </div>

          <!-- 1. Lista principal: No me siguen -->
          <div class="card" id="notBackList">
            ${snapshot ? (
              normalFiltered.length ? normalFiltered.map(u => renderAccountRow(u, 'normal')).join('') : '<div class="empty">No se encontraron cuentas en esta sección.</div>'
            ) : '<div class="empty">Importa un ZIP para empezar.</div>'}
          </div>

          ${snapshot ? `
            <!-- 2. Categoría: Famosas / Relevantes -->
            <div class="category-group">
              <div class="category-header ${!state.collapsedCategories.famous ? 'open' : ''}" data-toggle-cat="famous">
                <div class="category-title">
                  <span class="icon">⭐</span>
                  <span>Famosas / relevantes</span>
                </div>
                <div class="category-meta">
                  <span class="category-count">${famousFiltered.length}</span>
                  <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </div>
              </div>
              <div class="card category-card ${state.collapsedCategories.famous ? 'hidden' : ''}">
                ${famousFiltered.length ? famousFiltered.map(u => renderAccountRow(u, 'famous')).join('') : '<div class="empty">No hay cuentas marcadas como famosas.</div>'}
              </div>
            </div>

            <!-- 3. Categoría: Ignoradas -->
            <div class="category-group">
              <div class="category-header ${!state.collapsedCategories.ignored ? 'open' : ''}" data-toggle-cat="ignored">
                <div class="category-title">
                  <span class="icon">👁️</span>
                  <span>Ignoradas</span>
                </div>
                <div class="category-meta">
                  <span class="category-count">${ignoredFiltered.length}</span>
                  <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </div>
              </div>
              <div class="card category-card ${state.collapsedCategories.ignored ? 'hidden' : ''}">
                ${ignoredFiltered.length ? ignoredFiltered.map(u => renderAccountRow(u, 'ignored')).join('') : '<div class="empty">No hay cuentas ignoradas.</div>'}
              </div>
            </div>

            <!-- 4. Categoría: Cuentas eliminadas -->
            <div class="category-group">
              <div class="category-header ${!state.collapsedCategories.deleted ? 'open' : ''}" data-toggle-cat="deleted">
                <div class="category-title">
                  <span class="icon">🗑️</span>
                  <span>Cuentas eliminadas</span>
                </div>
                <div class="category-meta">
                  <span class="category-count">${deletedFiltered.length}</span>
                  <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </div>
              </div>
              <div class="card category-card ${state.collapsedCategories.deleted ? 'hidden' : ''}">
                ${deletedFiltered.length ? deletedFiltered.map(u => renderAccountRow(u, 'deleted')).join('') : '<div class="empty">No hay cuentas eliminadas.</div>'}
              </div>
            </div>
          ` : ''}
        </div>
      </section>

      <!-- VISTA 3: ACTIVIDAD -->
      <section id="activityView" class="${state.currentView === 'activityView' ? '' : 'hidden'}">
        <div class="section">
          <div class="section-title">
            <h2>Historial de Actividad</h2>
            <small>${unfollowedCount} bajas · ${followedCount} nuevos</small>
          </div>

          <div class="filter-group">
            <button class="filter-btn ${state.activityFilter === 'all' ? 'active' : ''}" data-filter="all">
              Todos (${state.activity.length})
            </button>
            <button class="filter-btn ${state.activityFilter === 'unfollowed' ? 'active' : ''}" data-filter="unfollowed">
              Bajas (${unfollowedCount})
            </button>
            <button class="filter-btn ${state.activityFilter === 'followed' ? 'active' : ''}" data-filter="followed">
              Nuevos (${followedCount})
            </button>
          </div>

          <div class="card" id="activityList">
            ${filteredActivity.length ? filteredActivity.map(e => `
              <div class="row">
                <div class="avatar ${e.type === 'unfollowed' ? 'down' : 'up'}">
                  ${e.type === 'unfollowed' ? '↓' : '↑'}
                </div>
                <div class="grow">
                  <div class="name">@${esc(e.username)}</div>
                  <div class="sub">${e.type === 'unfollowed' ? 'Te dejó de seguir' : 'Empezó a seguirte'}</div>
                </div>
                <div class="pill ${e.type === 'unfollowed' ? 'bad' : 'good'}">${formatDate(e.createdAt)}</div>
              </div>
            `).join('') : '<div class="empty">No hay eventos en este filtro.</div>'}
          </div>
        </div>
      </section>
    </main>

    <nav>
      <button class="${state.currentView === 'homeView' ? 'active' : ''}" data-view="homeView">
        <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
        Inicio
      </button>
      <button class="${state.currentView === 'notBackView' ? 'active' : ''}" data-view="notBackView">
        <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
        No me siguen
      </button>
      <button class="${state.currentView === 'activityView' ? 'active' : ''}" data-view="activityView">
        <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
        Actividad
      </button>
    </nav>
  `;

  attachAppListeners();
}

function attachAppListeners() {
  const logoutBtn = document.querySelector('#logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await logoutUser();
      state.user = null;
      state.snapshot = null;
      state.activity = [];
      render();
    });
  }

  // Navegación
  document.querySelectorAll('nav button').forEach(btn => {
    btn.addEventListener('click', () => {
      state.currentView = btn.dataset.view;
      state.activeMenuUser = null;
      render();
    });
  });

  // Filtros de actividad
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.activityFilter = btn.dataset.filter;
      render();
    });
  });

  // Búsqueda No me siguen
  const searchInput = document.querySelector('#searchNotBack');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.notBackSearch = e.target.value;
      state.activeMenuUser = null;
      render();
      // Restore focus to search input
      const newSearchInput = document.querySelector('#searchNotBack');
      if (newSearchInput) {
        newSearchInput.focus();
        newSearchInput.setSelectionRange(newSearchInput.value.length, newSearchInput.value.length);
      }
    });
  }

  // Toggles de Acordeones
  document.querySelectorAll('[data-toggle-cat]').forEach(header => {
    header.addEventListener('click', () => {
      const cat = header.dataset.toggleCat;
      if (cat && state.collapsedCategories[cat] !== undefined) {
        state.collapsedCategories[cat] = !state.collapsedCategories[cat];
        render();
      }
    });
  });

  // Botón de menú en cada fila de cuenta
  document.querySelectorAll('[data-menu-user]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const user = btn.dataset.menuUser;
      state.activeMenuUser = state.activeMenuUser === user ? null : user;
      render();
    });
  });

  // Acciones dentro del menú contextual
  document.querySelectorAll('.popover-item').forEach(actionBtn => {
    actionBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const action = actionBtn.dataset.action;
      const user = actionBtn.dataset.user;

      if (!user) return;

      if (action === 'famous') {
        state.knownAccounts = classifyAccount(state.knownAccounts, user, { famous: true });
      } else if (action === 'ignore') {
        state.knownAccounts = classifyAccount(state.knownAccounts, user, { ignored: true });
      } else if (action === 'delete') {
        state.knownAccounts = classifyAccount(state.knownAccounts, user, { deleted: true });
      } else if (action === 'restore') {
        state.knownAccounts = classifyAccount(state.knownAccounts, user, { restore: true });
      }

      saveLocalKnownAccounts(state.knownAccounts);
      state.activeMenuUser = null;
      render();
    });
  });

  // Importar ZIP
  const importBtn = document.querySelector('#importBtn');
  if (importBtn) {
    importBtn.addEventListener('click', async () => {
      const input = document.querySelector('#zipInput');
      const status = document.querySelector('#importStatus');

      if (!input.files?.[0]) {
        status.className = 'status error';
        status.textContent = 'Selecciona primero el archivo ZIP de Instagram.';
        return;
      }

      try {
        importBtn.disabled = true;
        status.className = 'status';
        status.textContent = 'Analizando archivo ZIP…';

        const current = await parseInstagramZip(input.files[0]);
        const previous = state.snapshot;
        const comparison = compareSnapshots(previous, current);

        let outcomeText = '';
        let events = [];

        if (comparison.isInitial) {
          // Primera importación: No generar falsos eventos
          outcomeText = `Estado inicial guardado: ${current.followers.length} seguidores · ${current.following.length} seguidos`;
        } else {
          const now = new Date().toISOString();
          events = [
            ...comparison.unfollowed.map(username => ({ type: 'unfollowed', username, createdAt: now })),
            ...comparison.newFollowers.map(username => ({ type: 'followed', username, createdAt: now }))
          ];

          if (events.length === 0) {
            outcomeText = 'Sin cambios detectados respecto al snapshot anterior';
          } else {
            outcomeText = `-${comparison.unfollowed.length} bajas · +${comparison.newFollowers.length} nuevos`;
          }
        }

        const savedSnapshot = await saveSnapshot(current);
        if (events.length > 0) {
          await appendActivity(events);
        }

        // Sincronizar known accounts conservando clasificaciones previas
        state.knownAccounts = syncKnownAccounts(state.knownAccounts, current);
        saveLocalKnownAccounts(state.knownAccounts);

        state.snapshot = savedSnapshot;
        if (events.length > 0) {
          state.activity = [...events, ...state.activity].slice(0, 500);
        }
        state.lastImportOutcome = outcomeText;
        localStorage.setItem('fc_last_outcome', outcomeText);

        status.className = 'status success';
        status.textContent = `${outcomeText}. Guardado correctamente.`;

        render();
      } catch (err) {
        console.error(err);
        status.className = 'status error';
        status.textContent = `Error: ${err.message}`;
      } finally {
        importBtn.disabled = false;
      }
    });
  }
}

// Cerrar menú emergente si se hace click fuera
document.addEventListener('click', (e) => {
  if (state.activeMenuUser && !e.target.closest('.account-popover') && !e.target.closest('[data-menu-user]')) {
    state.activeMenuUser = null;
    render();
  }
});

function render() {
  if (AUTH_ENABLED && supabaseReady() && !state.user) {
    renderAuth();
  } else {
    renderApp();
  }
}

async function boot() {
  try {
    state.knownAccounts = loadLocalKnownAccounts();

    if (AUTH_ENABLED && supabaseReady()) {
      state.user = await getAuthUser();
      subscribeToAuth(async (event, session) => {
        state.user = session?.user || null;
        if (state.user) {
          state.snapshot = await getLatestSnapshot();
          state.activity = await getActivity();
          if (state.snapshot) {
            state.knownAccounts = syncKnownAccounts(state.knownAccounts, state.snapshot);
            saveLocalKnownAccounts(state.knownAccounts);
          }
        } else {
          state.snapshot = null;
          state.activity = [];
        }
        render();
      });
    }

    if (!AUTH_ENABLED || state.user || !supabaseReady()) {
      state.snapshot = await getLatestSnapshot();
      state.activity = await getActivity();
      if (state.snapshot) {
        state.knownAccounts = syncKnownAccounts(state.knownAccounts, state.snapshot);
        saveLocalKnownAccounts(state.knownAccounts);
      }
    }
  } catch (err) {
    console.error('Boot error:', err);
  }
  render();
}

boot();

