import './styles.css';
import { APP_VERSION, BUILD_ID, AUTH_ENABLED, META_ACCOUNTS_CENTER_URL } from './config.js';
import { parseInstagramZip } from './instagramImport.js';
import { compareSnapshots, calculateNotFollowingBack } from './compare.js';
import {
  getLatestSnapshot, saveSnapshot,
  getActivity, appendActivity,
  getRemotePreferences, upsertRemotePreferences, upsertSingleRemotePreference
} from './repository.js';
import {
  getAuthUser, getAuthSession, loginWithPassword, registerWithPassword, resetPassword,
  logoutUser, subscribeToAuth
} from './auth.js';
import { supabaseReady } from './supabase.js';
import {
  loadLocalKnownAccounts, saveLocalKnownAccounts,
  loadLocalSnapshot, loadLocalActivity
} from './storage.js';
import { syncKnownAccounts, classifyAccount, categorizeNotFollowingBack } from './accounts.js';
import { initPwa, checkPwaUpdate, applyPwaUpdate, reloadApp } from './pwa.js';
import { loadExportState, recordExportRequested, recordSuccessfulImport, isExportPending } from './exportState.js';
import {
  reconcilePreferences, deduplicateActivity,
  hasPendingLocalDataToMigrate, isLocalDataMigrated, markLocalDataMigrated, dismissMigrationPrompt,
  knownAccountToPreferenceRow
} from './sync.js';


const state = {
  user: null,
  snapshot: loadLocalSnapshot(),
  activity: loadLocalActivity(),
  knownAccounts: loadLocalKnownAccounts(),
  exportState: loadExportState(),
  lastImportOutcome: localStorage.getItem('fc_last_outcome') || null,
  currentView: 'homeView', // 'homeView' | 'notBackView' | 'activityView' | 'settingsView'
  notBackSearch: '',
  activityFilter: 'all', // 'all' | 'unfollowed' | 'followed'
  activeMenuUser: null,
  collapsedCategories: {
    famous: true,
    ignored: true,
    deleted: true
  },
  pwaStatusText: 'Estás usando la última versión.',
  pwaUpdateAvailable: false,
  isCheckingUpdate: false,

  // Autenticación tipo Orbit
  authView: 'login', // 'login' | 'register' | 'forgot'
  authEmail: '',
  authPassword: '',
  authConfirmPassword: '',
  authError: '',
  authSuccess: '',
  isAuthLoading: false,

  // Sincronización Nube + Dispositivo
  syncStatus: 'idle', // 'idle' | 'syncing' | 'synced' | 'offline' | 'error'
  lastSyncAt: localStorage.getItem('fc_last_sync_at') || null,
  showMigrationPrompt: false,

  // Modal de actualización guiada
  isUpdateModalOpen: false,
  updateModalStep: 1, // 1: Solicitud, 2: Importación, 3: Resumen
  updateModalError: '',
  isAnalyzingZip: false,
  lastImportResult: null
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

// Iconos SVG Minimalistas
const icons = {
  home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>`,
  users: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`,
  activity: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>`,
  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`,
  down: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>`,
  up: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"></polyline></svg>`,
  chevron: `<svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>`,
  clock: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
  close: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`
};

function renderAuth() {
  const app = document.querySelector('#app');

  let formHtml = '';
  if (state.authView === 'login') {
    formHtml = `
      <h2 class="auth-title">Iniciar sesión</h2>
      <p class="auth-sub">Accede a tu cuenta privada para sincronizar tus datos.</p>

      <form class="auth-form" id="loginForm">
        <div class="auth-field">
          <label class="auth-label" for="authEmailInput">Correo electrónico</label>
          <input
            id="authEmailInput"
            type="email"
            placeholder="tu@email.com"
            value="${esc(state.authEmail)}"
            required
            autocomplete="email"
          />
        </div>
        <div class="auth-field">
          <label class="auth-label" for="authPasswordInput">Contraseña</label>
          <input
            id="authPasswordInput"
            type="password"
            placeholder="••••••••"
            value="${esc(state.authPassword)}"
            required
            autocomplete="current-password"
          />
        </div>
        <button type="submit" class="primary" id="submitAuthBtn" ${state.isAuthLoading ? 'disabled' : ''}>
          ${state.isAuthLoading ? 'Iniciando sesión…' : 'Iniciar sesión'}
        </button>
      </form>

      ${state.authError ? `
        <div class="status error" style="margin-top: 12px;">${esc(state.authError)}</div>
      ` : ''}

      ${state.authSuccess ? `
        <div class="status success" style="margin-top: 12px;">${esc(state.authSuccess)}</div>
      ` : ''}

      <div class="auth-links">
        <button type="button" class="auth-link-btn" id="toRegisterBtn">¿No tienes cuenta? Crear cuenta</button>
        <button type="button" class="auth-link-btn subtle" id="toForgotBtn">¿Has olvidado tu contraseña?</button>
      </div>
    `;
  } else if (state.authView === 'register') {
    formHtml = `
      <h2 class="auth-title">Crear cuenta</h2>
      <p class="auth-sub">Registra tu usuario privado para almacenar tus datos en la nube.</p>

      <form class="auth-form" id="registerForm">
        <div class="auth-field">
          <label class="auth-label" for="authEmailInput">Correo electrónico</label>
          <input
            id="authEmailInput"
            type="email"
            placeholder="tu@email.com"
            value="${esc(state.authEmail)}"
            required
            autocomplete="email"
          />
        </div>
        <div class="auth-field">
          <label class="auth-label" for="authPasswordInput">Contraseña</label>
          <input
            id="authPasswordInput"
            type="password"
            placeholder="Mínimo 6 caracteres"
            value="${esc(state.authPassword)}"
            required
            autocomplete="new-password"
          />
        </div>
        <div class="auth-field">
          <label class="auth-label" for="authConfirmPasswordInput">Confirmar contraseña</label>
          <input
            id="authConfirmPasswordInput"
            type="password"
            placeholder="Repite la contraseña"
            value="${esc(state.authConfirmPassword)}"
            required
            autocomplete="new-password"
          />
        </div>
        <button type="submit" class="primary" id="submitAuthBtn" ${state.isAuthLoading ? 'disabled' : ''}>
          ${state.isAuthLoading ? 'Creando cuenta…' : 'Crear cuenta'}
        </button>
      </form>

      ${state.authError ? `
        <div class="status error" style="margin-top: 12px;">${esc(state.authError)}</div>
      ` : ''}

      ${state.authSuccess ? `
        <div class="status success" style="margin-top: 12px;">${esc(state.authSuccess)}</div>
      ` : ''}

      <div class="auth-links">
        <button type="button" class="auth-link-btn" id="toLoginBtn">¿Ya tienes cuenta? Iniciar sesión</button>
      </div>
    `;
  } else if (state.authView === 'forgot') {
    formHtml = `
      <h2 class="auth-title">Recuperar contraseña</h2>
      <p class="auth-sub">Introduce tu correo para recibir un enlace oficial de recuperación.</p>

      <form class="auth-form" id="forgotForm">
        <div class="auth-field">
          <label class="auth-label" for="authEmailInput">Correo electrónico</label>
          <input
            id="authEmailInput"
            type="email"
            placeholder="tu@email.com"
            value="${esc(state.authEmail)}"
            required
            autocomplete="email"
          />
        </div>
        <button type="submit" class="primary" id="submitAuthBtn" ${state.isAuthLoading ? 'disabled' : ''}>
          ${state.isAuthLoading ? 'Enviando…' : 'Enviar enlace de recuperación'}
        </button>
      </form>

      ${state.authError ? `
        <div class="status error" style="margin-top: 12px;">${esc(state.authError)}</div>
      ` : ''}

      ${state.authSuccess ? `
        <div class="status success" style="margin-top: 12px;">${esc(state.authSuccess)}</div>
      ` : ''}

      <div class="auth-links">
        <button type="button" class="auth-link-btn" id="toLoginBtn">Volver a Iniciar sesión</button>
      </div>
    `;
  }

  app.innerHTML = `
    <main class="app auth-view">
      <div class="auth-container">
        <div class="auth-brand">
          <h1>FollowCheck</h1>
          <div class="badge">v${APP_VERSION}</div>
        </div>

        <section class="auth-card">
          ${formHtml}
        </section>
      </div>
    </main>
  `;

  attachAuthListeners();
}

function attachAuthListeners() {
  const emailInput = document.querySelector('#authEmailInput');
  const passInput = document.querySelector('#authPasswordInput');
  const confirmPassInput = document.querySelector('#authConfirmPasswordInput');

  if (emailInput) {
    emailInput.addEventListener('input', (e) => { state.authEmail = e.target.value; });
  }
  if (passInput) {
    passInput.addEventListener('input', (e) => { state.authPassword = e.target.value; });
  }
  if (confirmPassInput) {
    confirmPassInput.addEventListener('input', (e) => { state.authConfirmPassword = e.target.value; });
  }

  const toRegisterBtn = document.querySelector('#toRegisterBtn');
  if (toRegisterBtn) {
    toRegisterBtn.addEventListener('click', () => {
      state.authView = 'register';
      state.authError = '';
      state.authSuccess = '';
      render();
    });
  }

  const toLoginBtn = document.querySelector('#toLoginBtn');
  if (toLoginBtn) {
    toLoginBtn.addEventListener('click', () => {
      state.authView = 'login';
      state.authError = '';
      state.authSuccess = '';
      render();
    });
  }

  const toForgotBtn = document.querySelector('#toForgotBtn');
  if (toForgotBtn) {
    toForgotBtn.addEventListener('click', () => {
      state.authView = 'forgot';
      state.authError = '';
      state.authSuccess = '';
      render();
    });
  }

  const loginForm = document.querySelector('#loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      state.isAuthLoading = true;
      state.authError = '';
      state.authSuccess = '';
      render();

      try {
        const data = await loginWithPassword(state.authEmail, state.authPassword);
        state.user = data.user;
        state.isAuthLoading = false;
        await onUserAuthenticated(data.user);
      } catch (err) {
        state.isAuthLoading = false;
        state.authError = err.message;
        render();
      }
    });
  }

  const registerForm = document.querySelector('#registerForm');
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      state.isAuthLoading = true;
      state.authError = '';
      state.authSuccess = '';
      render();

      try {
        const data = await registerWithPassword(state.authEmail, state.authPassword, state.authConfirmPassword);
        state.isAuthLoading = false;
        if (data.user) {
          state.user = data.user;
          await onUserAuthenticated(data.user);
        } else {
          state.authSuccess = 'Cuenta creada correctamente.';
          state.authView = 'login';
          render();
        }
      } catch (err) {
        state.isAuthLoading = false;
        state.authError = err.message;
        render();
      }
    });
  }


  const forgotForm = document.querySelector('#forgotForm');
  if (forgotForm) {
    forgotForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      state.isAuthLoading = true;
      state.authError = '';
      state.authSuccess = '';
      render();

      try {
        await resetPassword(state.authEmail);
        state.isAuthLoading = false;
        state.authSuccess = 'Se ha enviado un enlace a tu correo para restablecer la contraseña.';
        render();
      } catch (err) {
        state.isAuthLoading = false;
        state.authError = err.message;
        render();
      }
    });
  }
}

async function syncWithCloud(silent = false) {
  if (!AUTH_ENABLED || !supabaseReady() || !state.user) return;

  try {
    if (!silent) {
      state.syncStatus = 'syncing';
      render();
    }

    const userId = state.user.id;

    // 1. Sincronizar Snapshot
    const remoteSnapshot = await getLatestSnapshot();
    if (remoteSnapshot) {
      state.snapshot = remoteSnapshot;
    } else if (state.snapshot && state.snapshot.followers && state.snapshot.followers.length > 0) {
      // Subir snapshot local si no hay en remoto
      await saveSnapshot(state.snapshot);
    }

    // 2. Sincronizar Activity
    const remoteActivity = await getActivity();
    state.activity = deduplicateActivity(state.activity, remoteActivity);

    // 3. Sincronizar Account Preferences (knownAccounts)
    const remotePrefs = await getRemotePreferences(userId);
    const { mergedKnownAccounts, pendingPushRows } = reconcilePreferences(state.knownAccounts, remotePrefs, userId);

    state.knownAccounts = mergedKnownAccounts;
    saveLocalKnownAccounts(mergedKnownAccounts);

    if (pendingPushRows.length > 0) {
      await upsertRemotePreferences(userId, pendingPushRows);
    }

    const now = new Date().toISOString();
    state.lastSyncAt = now;
    localStorage.setItem('fc_last_sync_at', now);
    state.syncStatus = 'synced';
  } catch (err) {
    console.warn('Error durante sincronización con Supabase:', err);
    state.syncStatus = 'error';
  } finally {
    render();
  }
}

let isAuthSyncing = false;

async function onUserAuthenticated(user) {
  if (!user || isAuthSyncing) return;
  isAuthSyncing = true;
  state.user = user;
  render();

  try {
    const remoteSnapshot = await getLatestSnapshot();
    const remoteActivity = await getActivity();
    const remotePrefs = await getRemotePreferences(user.id);

    console.log('[sync] local snapshots:', state.snapshot ? 1 : 0);
    console.log('[sync] remote snapshots:', remoteSnapshot ? 1 : 0);

    const isPending = hasPendingLocalDataToMigrate({
      userId: user.id,
      localSnapshot: state.snapshot,
      localActivity: state.activity,
      localKnownAccounts: state.knownAccounts,
      remoteSnapshot,
      remoteActivity,
      remotePrefs
    });

    console.log('[sync] migration pending:', isPending);

    if (isPending) {
      state.showMigrationPrompt = true;
      render();
    } else {
      markLocalDataMigrated(user.id, state.snapshot);
      console.log('[sync] migration completed for user:', user.id.slice(0, 8));
      await syncWithCloud(false);
    }
  } catch (err) {
    console.warn('Error comprobando migración local:', err);
    await syncWithCloud(false);
  } finally {
    isAuthSyncing = false;
  }
}


function renderMigrationModal() {
  if (!state.showMigrationPrompt) return '';

  return `
    <div class="modal-backdrop" id="migrationModalBackdrop">
      <div class="modal-sheet">
        <div class="modal-header">
          <h3 class="modal-title">Datos guardados en este dispositivo</h3>
        </div>
        <p class="sub" style="margin-top: 0; line-height: 1.5;">
          Hemos detectado datos e importaciones previas en este navegador. ¿Deseas sincronizarlos y vincularlos a tu cuenta de usuario?
        </p>

        <div style="margin: 20px 0 10px; display: flex; flex-direction: column; gap: 8px;">
          <button id="btnConfirmMigration" class="primary">Sincronizar con mi cuenta</button>
          <button id="btnDismissMigration" class="ghost">Mantener solo local por ahora</button>
        </div>
      </div>
    </div>
  `;
}

function renderAccountPopover(u, category, acc) {
  let actionsHtml = '';
  if (category === 'normal') {
    actionsHtml = `
      <button class="popover-item" data-action="famous" data-user="${esc(u)}">Marcar como relevante</button>
      <button class="popover-item" data-action="ignore" data-user="${esc(u)}">Ignorar cuenta</button>
      <button class="popover-item danger" data-action="delete" data-user="${esc(u)}">Marcar como eliminada</button>
    `;
  } else if (category === 'famous') {
    const isAuto = acc?.famousSource === 'auto';
    const reasonText = acc?.autoFamousReason || 'Detectada en catálogo de cuentas relevantes';
    actionsHtml = `
      ${isAuto ? `<div class="popover-reason">${esc(reasonText)}</div>` : ''}
      ${isAuto ? `<button class="popover-item" data-action="famous-manual" data-user="${esc(u)}">Confirmar como relevante manual</button>` : ''}
      <button class="popover-item" data-action="restore" data-user="${esc(u)}">${isAuto ? 'Mover a No me siguen (descartar)' : 'Mover a No me siguen'}</button>
      <button class="popover-item" data-action="ignore" data-user="${esc(u)}">Ignorar cuenta</button>
      <button class="popover-item danger" data-action="delete" data-user="${esc(u)}">Marcar como eliminada</button>
    `;
  } else if (category === 'ignored') {
    actionsHtml = `
      <button class="popover-item" data-action="restore" data-user="${esc(u)}">Volver a incluir (No me siguen)</button>
      <button class="popover-item" data-action="famous" data-user="${esc(u)}">Marcar como relevante</button>
      <button class="popover-item danger" data-action="delete" data-user="${esc(u)}">Marcar como eliminada</button>
    `;
  } else if (category === 'deleted') {
    actionsHtml = `
      <button class="popover-item" data-action="restore" data-user="${esc(u)}">Restaurar como activa</button>
      <button class="popover-item" data-action="famous" data-user="${esc(u)}">Marcar como relevante</button>
      <button class="popover-item" data-action="ignore" data-user="${esc(u)}">Ignorar cuenta</button>
    `;
  }
  return `
    <div class="account-popover" data-popover-for="${esc(u)}">
      ${actionsHtml}
    </div>
  `;
}

function renderAccountRow(u, category, acc) {
  const isMenuOpen = state.activeMenuUser === u;
  let pillHtml = '<div class="pill bad">no te sigue</div>';
  if (category === 'famous') {
    if (acc?.famousSource === 'auto') {
      pillHtml = '<div class="pill auto">Detectada automáticamente</div>';
    } else {
      pillHtml = '<div class="pill info">Manual</div>';
    }
  }
  if (category === 'ignored') pillHtml = '<div class="pill muted-pill">Ignorada</div>';
  if (category === 'deleted') pillHtml = '<div class="pill bad-soft-pill">Eliminada</div>';

  return `
    <div class="account-row">
      <a class="account-link" href="https://www.instagram.com/${encodeURIComponent(u)}/" target="_blank" rel="noopener noreferrer">
        <div class="avatar">${esc(initials(u))}</div>
        <div class="grow">
          <div class="name">@${esc(u)}</div>
          <div class="sub">${category === 'famous' && acc?.famousSource === 'auto' ? esc(acc?.autoFamousReason || 'Cuenta relevante') : 'Tocar para abrir en Instagram'}</div>
        </div>
      </a>
      <div class="account-actions">
        ${pillHtml}
        <button class="menu-btn ${isMenuOpen ? 'active' : ''}" data-menu-user="${esc(u)}" title="Opciones" aria-label="Opciones de cuenta">⋯</button>
      </div>
      ${isMenuOpen ? renderAccountPopover(u, category, acc) : ''}
    </div>
  `;
}

function renderUpdateModal() {
  if (!state.isUpdateModalOpen) return '';

  const step = state.updateModalStep;

  let contentHtml = '';
  if (step === 1) {
    contentHtml = `
      <div class="modal-header">
        <h3 class="modal-title">Paso 1: Solicitar exportación</h3>
        <button class="modal-close" id="btnCloseModalHeader" title="Cerrar">${icons.close}</button>
      </div>
      <p class="sub" style="margin-top: 0; line-height: 1.5;">
        Instagram permite descargar oficialmente tu lista de seguidores y seguidos desde el Centro de cuentas.
      </p>
      
      <a href="${META_ACCOUNTS_CENTER_URL}" target="_blank" rel="noopener noreferrer" class="primary" style="display:block;text-align:center;text-decoration:none;margin: 14px 0 16px;">
        Abrir Centro de cuentas
      </a>

      <div class="card" style="padding: 12px 14px; background: var(--panel2); margin-bottom: 16px;">
        <div class="name" style="font-size: 12px; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.5px; margin-bottom: 8px;">Guía rápida</div>
        <ol class="guide-steps" style="margin: 0; padding-left: 18px;">
          <li>Selecciona tu cuenta de Instagram.</li>
          <li>Elige <strong>Descargar o transferir información</strong>.</li>
          <li>Selecciona <strong>Seguidores y seguidos</strong>.</li>
          <li>Formato: <strong>JSON</strong>.</li>
          <li>Periodo: <strong>Cualquier fecha</strong>.</li>
          <li>Solicita la descarga.</li>
        </ol>
      </div>

      <button id="btnStep1Done" class="secondary" style="width: 100%; margin-bottom: 8px;">
        He solicitado la exportación
      </button>
      <button id="btnStep1Skip" class="ghost" style="width: 100%;">
        Ya tengo el archivo ZIP descargado
      </button>

      <div class="privacy-note">El archivo se procesa únicamente en este dispositivo.</div>
    `;
  } else if (step === 2) {
    contentHtml = `
      <div class="modal-header">
        <h3 class="modal-title">Paso 2: Importar archivo ZIP</h3>
        <button class="modal-close" id="btnCloseModalHeader" title="Cerrar">${icons.close}</button>
      </div>
      <p class="sub" style="margin-top: 0; line-height: 1.5;">
        Cuando Instagram te avise de que el archivo está listo, descárgalo y selecciónalo a continuación.
      </p>

      <input type="file" id="modalZipInput" accept=".zip,application/zip" class="hidden" />

      <div style="margin: 20px 0 14px;">
        <button id="btnSelectZip" class="primary" ${state.isAnalyzingZip ? 'disabled' : ''}>
          ${state.isAnalyzingZip ? 'Analizando archivo…' : 'Seleccionar archivo ZIP'}
        </button>
      </div>

      ${state.updateModalError ? `
        <div class="status error" style="margin-bottom: 12px;">${esc(state.updateModalError)}</div>
      ` : ''}

      <button id="btnBackToStep1" class="ghost" style="width: 100%;">
        Volver al paso anterior
      </button>

      <div class="privacy-note">Tus datos nunca salen de este navegador sin tu consentimiento.</div>
    `;
  } else if (step === 3) {
    const res = state.lastImportResult || {};
    contentHtml = `
      <div class="modal-header">
        <h3 class="modal-title">Datos actualizados</h3>
        <button class="modal-close" id="btnCloseModalHeader" title="Cerrar">${icons.close}</button>
      </div>
      <p class="sub" style="margin-top: 0;">
        Tu listado de seguidores y seguidos ha sido sincronizado correctamente.
      </p>

      <div class="result-metric-grid">
        <div class="result-metric-box">
          <strong>${res.followersCount ?? '—'}</strong>
          <span>Seguidores</span>
        </div>
        <div class="result-metric-box">
          <strong>${res.followingCount ?? '—'}</strong>
          <span>Seguidos</span>
        </div>
        <div class="result-metric-box">
          <strong style="color: var(--bad);">${res.notBackCount ?? '—'}</strong>
          <span>No te siguen</span>
        </div>
        <div class="result-metric-box">
          <strong style="color: var(--good);">${res.newFollowersCount > 0 ? '+' + res.newFollowersCount : '0'}</strong>
          <span>Nuevos seguidores</span>
        </div>
      </div>

      <div class="card" style="padding: 12px 14px; background: var(--panel2); margin-bottom: 16px; font-size: 13px;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
          <span style="color: var(--text-muted);">Bajas detectadas</span>
          <span style="font-weight: 600; color: var(--bad);">${res.unfollowedCount ?? 0}</span>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span style="color: var(--text-muted);">Altas registradas</span>
          <span style="font-weight: 600; color: var(--good);">${res.newFollowersCount ?? 0}</span>
        </div>
      </div>

      <button id="btnCloseModalResults" class="primary">
        Ver resultados
      </button>
    `;
  }

  return `
    <div class="modal-backdrop" id="updateModalBackdrop">
      <div class="modal-sheet">
        ${contentHtml}
      </div>
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
  const suggestionsFiltered = categorized.suggestions.filter(u => u.toLowerCase().includes(query));

  const unfollowedCount = state.activity.filter(e => e.type === 'unfollowed').length;
  const followedCount = state.activity.filter(e => e.type === 'followed').length;

  const isPending = isExportPending(state.exportState.exportRequestedAt, state.exportState.lastSuccessfulImportAt);

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

        ${isPending ? `
          <div class="pending-banner">
            <div class="pending-banner-icon">${icons.clock}</div>
            <div class="grow">
              <div class="title">Tienes una exportación pendiente</div>
              <div class="sub">Solicitada el ${formatDate(state.exportState.exportRequestedAt)}</div>
            </div>
            <button id="btnQuickImportZip" class="secondary btn-sm">Importar ZIP</button>
          </div>
        ` : ''}

        <div style="margin: 16px 0 20px;">
          <button id="openUpdateModalBtn" class="primary">Actualizar datos</button>
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
                  ${e.type === 'unfollowed' ? icons.down : icons.up}
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

          ${snapshot && suggestionsFiltered.length ? `
            <div class="suggestions-box card">
              <div class="suggestions-header">
                <div class="grow">
                  <strong>Sugerencias de cuentas relevantes</strong>
                  <div class="sub">Posibles cuentas públicas detectadas en el listado</div>
                </div>
              </div>
              <div class="suggestions-list">
                ${suggestionsFiltered.map(sugUser => {
                  const sugAcc = state.knownAccounts[sugUser];
                  return `
                    <div class="suggestion-row">
                      <div class="grow">
                        <div class="name">@${esc(sugUser)}</div>
                        <div class="sub">${esc(sugAcc?.autoFamousReason || 'Cuenta pública')}</div>
                      </div>
                      <div class="suggestion-actions">
                        <button class="btn-sug accept" data-sug-action="famous" data-user="${esc(sugUser)}">Mover</button>
                        <button class="btn-sug dismiss" data-sug-action="dismiss" data-user="${esc(sugUser)}">Mantener</button>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          ` : ''}

          <!-- 1. Lista principal: No me siguen -->
          <div class="card" id="notBackList">
            ${snapshot ? (
              normalFiltered.length ? normalFiltered.map(u => renderAccountRow(u, 'normal', state.knownAccounts[u])).join('') : '<div class="empty">No se encontraron cuentas en esta sección.</div>'
            ) : '<div class="empty">Actualiza tus datos para empezar.</div>'}
          </div>

          ${snapshot ? `
            <!-- 2. Categoría: Famosas / Relevantes -->
            <div class="category-group">
              <div class="category-header ${!state.collapsedCategories.famous ? 'open' : ''}" data-toggle-cat="famous">
                <div class="category-title">
                  <span>Famosas / relevantes</span>
                </div>
                <div class="category-meta">
                  <span class="category-count">${famousFiltered.length}</span>
                  ${icons.chevron}
                </div>
              </div>
              <div class="card category-card ${state.collapsedCategories.famous ? 'hidden' : ''}">
                ${famousFiltered.length ? famousFiltered.map(u => renderAccountRow(u, 'famous', state.knownAccounts[u])).join('') : '<div class="empty">No hay cuentas marcadas como famosas.</div>'}
              </div>
            </div>

            <!-- 3. Categoría: Ignoradas -->
            <div class="category-group">
              <div class="category-header ${!state.collapsedCategories.ignored ? 'open' : ''}" data-toggle-cat="ignored">
                <div class="category-title">
                  <span>Ignoradas</span>
                </div>
                <div class="category-meta">
                  <span class="category-count">${ignoredFiltered.length}</span>
                  ${icons.chevron}
                </div>
              </div>
              <div class="card category-card ${state.collapsedCategories.ignored ? 'hidden' : ''}">
                ${ignoredFiltered.length ? ignoredFiltered.map(u => renderAccountRow(u, 'ignored', state.knownAccounts[u])).join('') : '<div class="empty">No hay cuentas ignoradas.</div>'}
              </div>
            </div>

            <!-- 4. Categoría: Cuentas eliminadas -->
            <div class="category-group">
              <div class="category-header ${!state.collapsedCategories.deleted ? 'open' : ''}" data-toggle-cat="deleted">
                <div class="category-title">
                  <span>Cuentas eliminadas</span>
                </div>
                <div class="category-meta">
                  <span class="category-count">${deletedFiltered.length}</span>
                  ${icons.chevron}
                </div>
              </div>
              <div class="card category-card ${state.collapsedCategories.deleted ? 'hidden' : ''}">
                ${deletedFiltered.length ? deletedFiltered.map(u => renderAccountRow(u, 'deleted', state.knownAccounts[u])).join('') : '<div class="empty">No hay cuentas eliminadas.</div>'}
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
                  ${e.type === 'unfollowed' ? icons.down : icons.up}
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

      <!-- VISTA 4: AJUSTES -->
      <section id="settingsView" class="${state.currentView === 'settingsView' ? '' : 'hidden'}">
        <div class="section">
          <div class="section-title">
            <h2>Ajustes</h2>
            <small>Configuración y estado</small>
          </div>

          <!-- Sección Cuenta -->
          <div class="card settings-card">
            <div class="settings-title">Cuenta</div>
            <div class="settings-list">
              <div class="settings-item">
                <span class="settings-label">Usuario</span>
                <span class="settings-value">${esc(state.user?.email || 'Modo local')}</span>
              </div>
              <div class="settings-item">
                <span class="settings-label">Estado</span>
                <span class="settings-value">${AUTH_ENABLED && state.user ? 'Sesión activa' : 'Desconectado'}</span>
              </div>
            </div>
            ${AUTH_ENABLED && state.user ? `
              <div style="margin-top: 12px;">
                <button class="ghost" id="logoutBtn" style="width: 100%; color: var(--bad); border-color: rgba(255, 71, 87, 0.2);">
                  Cerrar sesión
                </button>
              </div>
            ` : ''}
          </div>

          <!-- Sección Sincronización -->
          ${AUTH_ENABLED && state.user ? `
            <div class="card settings-card">
              <div class="settings-title">Sincronización en la Nube</div>
              <div class="settings-list">
                <div class="settings-item">
                  <span class="settings-label">Estado</span>
                  <span class="settings-value">${state.syncStatus === 'syncing' ? 'Sincronizando…' : (state.syncStatus === 'error' ? 'Error al sincronizar' : 'Sincronizado')}</span>
                </div>
                <div class="settings-item">
                  <span class="settings-label">Última sincronización</span>
                  <span class="settings-value">${formatDate(state.lastSyncAt)}</span>
                </div>
              </div>
              <div style="margin-top: 12px;">
                <button class="secondary" id="syncNowBtn" style="width: 100%;" ${state.syncStatus === 'syncing' ? 'disabled' : ''}>
                  ${state.syncStatus === 'syncing' ? 'Sincronizando…' : 'Sincronizar ahora'}
                </button>
              </div>
            </div>
          ` : ''}

          <!-- Diagnóstico del sistema -->
          <div class="card settings-card">
            <div class="settings-title">Información de la App</div>
            <div class="settings-list">
              <div class="settings-item">
                <span class="settings-label">Versión</span>
                <span class="settings-value">v${APP_VERSION}</span>
              </div>
              <div class="settings-item">
                <span class="settings-label">Build / Commit</span>
                <span class="settings-value">${BUILD_ID}</span>
              </div>
              <div class="settings-item">
                <span class="settings-label">Almacenamiento</span>
                <span class="settings-value">${AUTH_ENABLED && state.user ? 'Nube Supabase + Dispositivo' : 'Almacenamiento local'}</span>
              </div>
              <div class="settings-item">
                <span class="settings-label">Última importación</span>
                <span class="settings-value">${formatDate(snapshot?.importedAt)}</span>
              </div>
              <div class="settings-item">
                <span class="settings-label">Cuentas registradas</span>
                <span class="settings-value">${Object.keys(state.knownAccounts).length} cuentas</span>
              </div>
            </div>
          </div>

          <!-- Control de Actualización PWA -->
          <div class="card settings-card">
            <div class="settings-title">Control de Actualización PWA</div>

            <div class="update-status-box ${state.pwaUpdateAvailable ? 'has-update' : ''}">
              <div class="grow">${esc(state.pwaStatusText)}</div>
            </div>

            <div class="settings-btn-grid">
              ${state.pwaUpdateAvailable ? `
                <button class="primary" id="applyUpdateBtn">Actualizar ahora</button>
              ` : ''}
              <button class="secondary" id="checkUpdateBtn" ${state.isCheckingUpdate ? 'disabled' : ''}>
                ${state.isCheckingUpdate ? 'Comprobando actualización…' : 'Comprobar actualización'}
              </button>
              <button class="secondary" id="reloadAppBtn">
                Recargar FollowCheck
              </button>
            </div>
          </div>
        </div>
      </section>

      ${renderUpdateModal()}
      ${renderMigrationModal()}
    </main>

    <nav>
      <button class="${state.currentView === 'homeView' ? 'active' : ''}" data-view="homeView">
        ${icons.home}
        Inicio
      </button>
      <button class="${state.currentView === 'notBackView' ? 'active' : ''}" data-view="notBackView">
        ${icons.users}
        No me siguen
      </button>
      <button class="${state.currentView === 'activityView' ? 'active' : ''}" data-view="activityView">
        ${icons.activity}
        Actividad
      </button>
      <button class="${state.currentView === 'settingsView' ? 'active' : ''}" data-view="settingsView">
        ${icons.settings}
        Ajustes
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
      state.syncStatus = 'idle';
      render();
    });
  }

  const syncNowBtn = document.querySelector('#syncNowBtn');
  if (syncNowBtn) {
    syncNowBtn.addEventListener('click', async () => {
      await syncWithCloud(false);
    });
  }

  // Controles del Modal de Migración
  const btnConfirmMigration = document.querySelector('#btnConfirmMigration');
  if (btnConfirmMigration) {
    btnConfirmMigration.addEventListener('click', async () => {
      state.showMigrationPrompt = false;
      render();
      if (state.user) {
        if (state.snapshot && state.snapshot.followers && state.snapshot.followers.length > 0) {
          await saveSnapshot(state.snapshot);
        }
        markLocalDataMigrated(state.user.id, state.snapshot);
        console.log('[sync] migration confirmed by user:', state.user.id.slice(0, 8));
        await syncWithCloud(false);
      }
    });
  }

  const btnDismissMigration = document.querySelector('#btnDismissMigration');
  if (btnDismissMigration) {
    btnDismissMigration.addEventListener('click', async () => {
      state.showMigrationPrompt = false;
      render();
      if (state.user) {
        dismissMigrationPrompt(state.user.id);
        console.log('[sync] migration dismissed for user:', state.user.id.slice(0, 8));
        await syncWithCloud(true);
      }
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

  // Acciones en sugerencias rápidas
  document.querySelectorAll('[data-sug-action]').forEach(sugBtn => {
    sugBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const action = sugBtn.dataset.sugAction;
      const user = sugBtn.dataset.user;

      if (!user) return;

      if (action === 'famous') {
        state.knownAccounts = classifyAccount(state.knownAccounts, user, { famous: true, famousSource: 'manual' });
      } else if (action === 'dismiss') {
        state.knownAccounts = classifyAccount(state.knownAccounts, user, { dismissSuggestion: true });
      }

      saveLocalKnownAccounts(state.knownAccounts);
      render();

      if (AUTH_ENABLED && state.user && state.knownAccounts[user]) {
        upsertSingleRemotePreference(state.user.id, user, state.knownAccounts[user]);
      }
    });
  });

  // Acciones dentro del menú contextual
  document.querySelectorAll('.popover-item').forEach(actionBtn => {
    actionBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const action = actionBtn.dataset.action;
      const user = actionBtn.dataset.user;

      if (!user) return;

      if (action === 'famous') {
        state.knownAccounts = classifyAccount(state.knownAccounts, user, { famous: true, famousSource: 'manual' });
      } else if (action === 'famous-manual') {
        state.knownAccounts = classifyAccount(state.knownAccounts, user, { famous: true, famousSource: 'manual' });
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

      if (AUTH_ENABLED && state.user && state.knownAccounts[user]) {
        upsertSingleRemotePreference(state.user.id, user, state.knownAccounts[user]);
      }
    });
  });

  // Botones para abrir Modal de Actualización
  const openUpdateModalBtn = document.querySelector('#openUpdateModalBtn');
  if (openUpdateModalBtn) {
    openUpdateModalBtn.addEventListener('click', () => {
      state.isUpdateModalOpen = true;
      state.updateModalStep = 1;
      state.updateModalError = '';
      render();
    });
  }

  const btnQuickImportZip = document.querySelector('#btnQuickImportZip');
  if (btnQuickImportZip) {
    btnQuickImportZip.addEventListener('click', () => {
      state.isUpdateModalOpen = true;
      state.updateModalStep = 2;
      state.updateModalError = '';
      render();
    });
  }

  // Controles del Modal de Actualización
  const btnCloseModalHeader = document.querySelector('#btnCloseModalHeader');
  if (btnCloseModalHeader) {
    btnCloseModalHeader.addEventListener('click', () => {
      state.isUpdateModalOpen = false;
      render();
    });
  }

  const btnCloseModalResults = document.querySelector('#btnCloseModalResults');
  if (btnCloseModalResults) {
    btnCloseModalResults.addEventListener('click', () => {
      state.isUpdateModalOpen = false;
      state.currentView = 'notBackView';
      render();
    });
  }

  const updateModalBackdrop = document.querySelector('#updateModalBackdrop');
  if (updateModalBackdrop) {
    updateModalBackdrop.addEventListener('click', (e) => {
      if (e.target === updateModalBackdrop) {
        state.isUpdateModalOpen = false;
        render();
      }
    });
  }

  const btnStep1Done = document.querySelector('#btnStep1Done');
  if (btnStep1Done) {
    btnStep1Done.addEventListener('click', () => {
      const now = new Date().toISOString();
      recordExportRequested(now);
      state.exportState = loadExportState();
      state.updateModalStep = 2;
      state.updateModalError = '';
      render();
    });
  }

  const btnStep1Skip = document.querySelector('#btnStep1Skip');
  if (btnStep1Skip) {
    btnStep1Skip.addEventListener('click', () => {
      state.updateModalStep = 2;
      state.updateModalError = '';
      render();
    });
  }

  const btnBackToStep1 = document.querySelector('#btnBackToStep1');
  if (btnBackToStep1) {
    btnBackToStep1.addEventListener('click', () => {
      state.updateModalStep = 1;
      state.updateModalError = '';
      render();
    });
  }

  const btnSelectZip = document.querySelector('#btnSelectZip');
  const modalZipInput = document.querySelector('#modalZipInput');
  if (btnSelectZip && modalZipInput) {
    btnSelectZip.addEventListener('click', () => {
      modalZipInput.click();
    });

    modalZipInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        state.isAnalyzingZip = true;
        state.updateModalError = '';
        render();

        const current = await parseInstagramZip(file);
        const previous = state.snapshot;
        const comparison = compareSnapshots(previous, current);

        let outcomeText = '';
        let events = [];

        if (comparison.isInitial) {
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

        // Sincronizar known accounts
        state.knownAccounts = syncKnownAccounts(state.knownAccounts, current);
        saveLocalKnownAccounts(state.knownAccounts);

        // Si está conectado, sincronizar preferencias
        if (AUTH_ENABLED && state.user) {
          const rows = Object.entries(state.knownAccounts).map(([u, acc]) =>
            knownAccountToPreferenceRow(state.user.id, u, acc)
          );
          upsertRemotePreferences(state.user.id, rows);
        }

        // Registrar fecha de importación exitosa
        recordSuccessfulImport();
        state.exportState = loadExportState();

        state.snapshot = savedSnapshot;
        if (events.length > 0) {
          state.activity = [...events, ...state.activity].slice(0, 500);
        }
        state.lastImportOutcome = outcomeText;
        localStorage.setItem('fc_last_outcome', outcomeText);

        const notBackAll = calculateNotFollowingBack(savedSnapshot);
        const categorized = categorizeNotFollowingBack(notBackAll, state.knownAccounts);

        state.lastImportResult = {
          followersCount: savedSnapshot.followers.length,
          followingCount: savedSnapshot.following.length,
          notBackCount: categorized.notFollowingBack.length,
          newFollowersCount: comparison.newFollowers.length,
          unfollowedCount: comparison.unfollowed.length
        };

        state.isAnalyzingZip = false;
        state.updateModalStep = 3;
        render();
      } catch (err) {
        console.error(err);
        state.isAnalyzingZip = false;
        state.updateModalError = `Error al procesar el archivo: ${err.message}`;
        render();
      }
    });
  }

  // Botones de Ajustes
  const checkUpdateBtn = document.querySelector('#checkUpdateBtn');

  if (checkUpdateBtn) {
    checkUpdateBtn.addEventListener('click', async () => {
      state.isCheckingUpdate = true;
      state.pwaStatusText = 'Comprobando si hay actualizaciones…';
      render();

      const result = await checkPwaUpdate();
      state.isCheckingUpdate = false;
      state.pwaStatusText = result.message;
      state.pwaUpdateAvailable = result.status === 'update-available';
      render();
    });
  }

  const applyUpdateBtn = document.querySelector('#applyUpdateBtn');
  if (applyUpdateBtn) {
    applyUpdateBtn.addEventListener('click', () => {
      state.pwaStatusText = 'Aplicando actualización y recargando…';
      render();
      applyPwaUpdate();
    });
  }

  const reloadAppBtn = document.querySelector('#reloadAppBtn');
  if (reloadAppBtn) {
    reloadAppBtn.addEventListener('click', () => {
      reloadApp();
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
    state.snapshot = loadLocalSnapshot();
    state.activity = loadLocalActivity();
    state.exportState = loadExportState();

    // Inicializar ciclo de vida de PWA
    initPwa(({ status, updateAvailable }) => {
      if (updateAvailable) {
        state.pwaUpdateAvailable = true;
        state.pwaStatusText = 'Nueva versión disponible para instalar.';
        render();
      }
    });

    if (AUTH_ENABLED && supabaseReady()) {
      const session = await getAuthSession();
      state.user = session?.user || null;
      console.log('[auth] initial session:', state.user ? 'yes' : 'no');

      let initialProcessed = false;
      subscribeToAuth(async (event, currentSession) => {
        console.log('[auth] event:', event);
        const currentUser = currentSession?.user || null;

        if (event === 'SIGNED_OUT') {
          state.user = null;
          state.showMigrationPrompt = false;
          render();
          return;
        }

        if (currentUser && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION')) {
          const isNewUser = !state.user || state.user.id !== currentUser.id;
          state.user = currentUser;
          if (isNewUser || !initialProcessed) {
            initialProcessed = true;
            await onUserAuthenticated(currentUser);
          } else {
            render();
          }
        }
      });

      if (state.user && !initialProcessed) {
        initialProcessed = true;
        await onUserAuthenticated(state.user);
      }
    }
  } catch (err) {
    console.error('Boot error:', err);
  }
  render();
}

boot();

