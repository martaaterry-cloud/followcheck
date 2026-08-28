import './styles.css';
import { APP_VERSION, BUILD_ID, AUTH_ENABLED, META_ACCOUNTS_CENTER_URL } from './config.js';
import { parseInstagramZip } from './instagramImport.js';
import { compareSnapshots, calculateNotFollowingBack } from './compare.js';
import {
  getLatestSnapshot, saveSnapshot,
  getActivity, appendActivity,
  getRemotePreferences, upsertRemotePreferences, upsertSingleRemotePreference,
  deleteRemotePreferences,
  getRemoteProfile, saveRemoteProfile,
  getRemoteCategories, saveRemoteCategories, deleteRemoteCategory,
  getRemoteCategoryMemberships, saveRemoteAccountCategories,
  deleteRemoteCategoryMemberships
} from './repository.js';
import {
  getAuthUser, getAuthSession, loginWithPassword, registerWithPassword, resetPassword, updateUserPassword,
  logoutUser, subscribeToAuth
} from './auth.js';
import { supabaseReady } from './supabase.js';
import {
  loadLocalKnownAccounts, saveLocalKnownAccounts,
  loadLocalSnapshot, loadLocalActivity,
  loadLocalProfile, saveLocalProfile,
  loadLocalCategories, saveLocalCategories,
  loadLocalCategoryMemberships, saveLocalCategoryMemberships
} from './storage.js';
import {
  syncKnownAccounts, classifyAccount, categorizeNotFollowingBack,
  pruneAbsentAccounts, normalizeUsername,
  instagramProfileUrl
} from './accounts.js';
import {
  initDefaultCategories, addCategory, renameCategory, deleteCategory,
  getAccountCategories, setAccountCategories, toggleAccountCategory,
  isAccountUncategorized, countAccountsPerCategory
} from './categories.js';
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
  profile: loadLocalProfile(),
  categories: initDefaultCategories(loadLocalCategories()),
  categoryMemberships: loadLocalCategoryMemberships(),
  exportState: loadExportState(),
  lastImportOutcome: localStorage.getItem('fc_last_outcome') || null,
  currentView: 'homeView', // 'homeView' | 'notBackView' | 'activityView' | 'settingsView'
  notBackSearch: '',
  selectedCategoryFilter: 'all', // 'all' | 'uncategorized' | categoryId
  systemStateFilter: 'notBack', // 'notBack' | 'relevant' | 'secondary' | 'unavailable'
  activityFilter: 'all', // 'all' | 'unfollowed' | 'followed'
  activeMenuUser: null,
  activeMenuPosition: null, // { top, bottom, left, openUp }

  // Modales
  isOrganizeModalOpen: false,
  organizeTargetUser: null,
  isManageCategoriesModalOpen: false,
  newCategoryNameInput: '',
  editingCategoryId: null,
  editingCategoryNameInput: '',
  isDeleteModalOpen: false,
  deleteTargetUser: null,


  pwaStatusText: 'Estás usando la última versión.',
  pwaUpdateAvailable: false,
  isCheckingUpdate: false,

  // Autenticación
  authView: 'login', // 'login' | 'register' | 'forgot' | 'updatePassword'
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

const esc = s => String(s || '').replace(/[&<>"']/g, c => ({
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

function renderUsername(username, extraClass = '') {
  const url = instagramProfileUrl(username);
  const safeName = esc(username);
  if (url) {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="username-link ${extraClass}">@${safeName}</a>`;
  }
  return `<span class="username-plain ${extraClass}">${safeName}</span>`;
}

function renderAccountCategoryBadges(username, isRelevant = true) {
  const catIds = getAccountCategories(state.categoryMemberships, username);
  if (!catIds || catIds.length === 0) {
    if (isRelevant) {
      return `<div class="account-badges"><span class="account-category-tag uncat-tag">Sin categoría</span></div>`;
    }
    return '';
  }
  const catMap = new Map((state.categories || []).map(c => [c.id, c.name]));
  const tags = catIds
    .map(id => catMap.get(id))
    .filter(Boolean)
    .map(name => `<span class="account-category-tag">${esc(name)}</span>`)
    .join('');
  return tags ? `<div class="account-badges">${tags}</div>` : '';
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
  } else if (state.authView === 'updatePassword') {
    formHtml = `
      <h2 class="auth-title">Crear nueva contraseña</h2>
      <p class="auth-sub">Define la nueva contraseña para acceder a tu cuenta.</p>

      <form class="auth-form" id="updatePasswordForm">
        <div class="auth-field">
          <label class="auth-label" for="authPasswordInput">Nueva contraseña</label>
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
          <label class="auth-label" for="authConfirmPasswordInput">Confirmar nueva contraseña</label>
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
          ${state.isAuthLoading ? 'Guardando…' : 'Guardar nueva contraseña'}
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
        state.authSuccess = 'Te hemos enviado un enlace para crear una nueva contraseña. Revisa tu bandeja de entrada o spam.';
        render();
      } catch (err) {
        state.isAuthLoading = false;
        state.authError = err.message;
        render();
      }
    });
  }

  const updatePasswordForm = document.querySelector('#updatePasswordForm');
  if (updatePasswordForm) {
    updatePasswordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      state.isAuthLoading = true;
      state.authError = '';
      state.authSuccess = '';
      render();

      try {
        const data = await updateUserPassword(state.authPassword, state.authConfirmPassword);
        state.isAuthLoading = false;
        state.user = data.user;
        state.authPassword = '';
        state.authConfirmPassword = '';
        state.authSuccess = 'Contraseña actualizada correctamente.';
        state.authView = 'login';

        if (typeof window !== 'undefined' && window.history?.replaceState) {
          window.history.replaceState(null, '', window.location.pathname);
        }

        await onUserAuthenticated(data.user);
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

    // 4. Sincronizar Perfil de Usuario
    const remoteProf = await getRemoteProfile(userId);
    if (remoteProf && (remoteProf.instagramUsername || remoteProf.displayName)) {
      state.profile = remoteProf;
      saveLocalProfile(remoteProf);
    } else if (state.profile.instagramUsername || state.profile.displayName) {
      await saveRemoteProfile(userId, state.profile);
    }

    // 5. Sincronizar Categorías
    const remoteCats = await getRemoteCategories(userId);
    if (remoteCats && remoteCats.length > 0) {
      state.categories = remoteCats;
      saveLocalCategories(remoteCats);
    } else if (state.categories && state.categories.length > 0) {
      await saveRemoteCategories(userId, state.categories);
    }

    // 6. Sincronizar Memberships
    const remoteMemberships = await getRemoteCategoryMemberships(userId);
    if (remoteMemberships && Object.keys(remoteMemberships).length > 0) {
      state.categoryMemberships = remoteMemberships;
      saveLocalCategoryMemberships(remoteMemberships);
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

function renderAccountPopover(u, group, acc) {
  if (state.activeMenuUser !== u) return '';

  const pos = state.activeMenuPosition;
  const stylePos = pos?.openUp
    ? `bottom: ${pos.bottom}px; left: ${pos.left}px;`
    : `top: ${pos?.top || 100}px; left: ${pos?.left || 20}px;`;

  let actionsHtml = '';

  if (group === 'normal') {
    actionsHtml = `
      <button class="popover-item" data-action="move-relevant" data-user="${esc(u)}">Mover a relevantes</button>
      <button class="popover-item" data-action="move-secondary" data-user="${esc(u)}">Mover a cuentas secundarias</button>
      <button class="popover-item" data-action="move-unavailable" data-user="${esc(u)}">Marcar como no disponible</button>
      <button class="popover-item danger" data-action="move-possible-block" data-user="${esc(u)}">Marcar como posible bloqueo</button>
    `;
  } else if (group === 'relevant') {
    const isAuto = acc?.famousSource === 'auto';
    const reasonText = acc?.autoFamousReason || 'Detectada en catálogo de cuentas relevantes';
    actionsHtml = `
      <button class="popover-item" data-action="organize" data-user="${esc(u)}">Organizar subcategorías…</button>
      ${isAuto ? `<div class="popover-reason">${esc(reasonText)}</div>` : ''}
      <button class="popover-item" data-action="move-normal" data-user="${esc(u)}">Mover a No me siguen</button>
      <button class="popover-item" data-action="move-secondary" data-user="${esc(u)}">Mover a cuentas secundarias</button>
      <button class="popover-item danger" data-action="move-unavailable" data-user="${esc(u)}">Marcar como no disponible</button>
    `;
  } else if (group === 'secondary') {
    actionsHtml = `
      <button class="popover-item" data-action="move-normal" data-user="${esc(u)}">Mover a No me siguen</button>
      <button class="popover-item" data-action="move-relevant" data-user="${esc(u)}">Mover a relevantes</button>
      <button class="popover-item danger" data-action="move-unavailable" data-user="${esc(u)}">Marcar como no disponible</button>
    `;
  } else if (group === 'unavailable') {
    actionsHtml = `
      <button class="popover-item" data-action="move-normal" data-user="${esc(u)}">Restaurar a No me siguen</button>
      <button class="popover-item" data-action="move-relevant" data-user="${esc(u)}">Mover a relevantes</button>
      ${acc?.unavailableReason !== 'possible_block' ? `
        <button class="popover-item danger" data-action="move-possible-block" data-user="${esc(u)}">Marcar como posible bloqueo</button>
      ` : ''}
    `;
  }

  const igUrl = instagramProfileUrl(u);
  if (igUrl) {
    actionsHtml += `
      <button class="popover-item" data-action="open-ig" data-user="${esc(u)}">Abrir en Instagram</button>
    `;
  }

  return `
    <div class="account-popover" style="${stylePos}" data-popover-for="${esc(u)}">
      ${actionsHtml}
    </div>
  `;
}

function renderAccountRow(u, group, acc) {
  const isMenuOpen = state.activeMenuUser === u;
  let pillHtml = '<div class="pill bad">no te sigue</div>';

  if (group === 'relevant') {
    if (acc?.famousSource === 'auto') {
      pillHtml = '<div class="pill auto">Automática</div>';
    } else {
      pillHtml = '<div class="pill info">Relevante</div>';
    }
  } else if (group === 'secondary') {
    pillHtml = '<div class="pill muted-pill">Secundaria</div>';
  } else if (group === 'unavailable') {
    if (acc?.unavailableReason === 'possible_block') {
      pillHtml = '<div class="pill bad-soft-pill">Posible bloqueo</div>';
    } else if (isAutoDeleted(u)) {
      pillHtml = '<div class="pill bad-soft-pill">Eliminada</div>';
    } else {
      pillHtml = '<div class="pill bad-soft-pill">No disponible</div>';
    }
  }

  const categoryBadgesHtml = group === 'relevant' ? renderAccountCategoryBadges(u, true) : '';

  return `
    <div class="account-row-wrapper" data-account-wrapper="${esc(u)}">
      <div class="account-swipe-bg">
        <button class="account-swipe-btn" data-swipe-delete-user="${esc(u)}">Eliminar</button>
      </div>
      <div class="account-row" data-account-swipe-row="${esc(u)}">
        <div class="account-link grow" style="cursor: default;">
          <div class="avatar">${esc(initials(u))}</div>
          <div class="grow" style="min-width: 0;">
            <div class="name">${renderUsername(u)}</div>
            <div class="sub">${group === 'relevant' && acc?.famousSource === 'auto' ? esc(acc?.autoFamousReason || 'Cuenta relevante') : 'Cuenta analizada'}</div>
            ${categoryBadgesHtml}
          </div>
        </div>
        <div class="account-actions">
          ${group === 'relevant' ? `
            <button class="btn-organize" data-organize-user="${esc(u)}" title="Organizar subcategorías">Organizar</button>
          ` : pillHtml}
          <button class="menu-btn ${isMenuOpen ? 'active' : ''}" data-menu-user="${esc(u)}" title="Opciones" aria-label="Opciones de cuenta">⋯</button>
        </div>
        ${isMenuOpen ? renderAccountPopover(u, group, acc) : ''}
      </div>
    </div>
  `;
}


function renderOrganizeModal() {
  if (!state.isOrganizeModalOpen || !state.organizeTargetUser) return '';

  const u = state.organizeTargetUser;
  const assigned = getAccountCategories(state.categoryMemberships, u);
  const categories = state.categories || [];

  return `
    <div class="modal-backdrop" id="organizeModalBackdrop">
      <div class="modal-sheet">
        <div class="modal-header">
          <h3 class="modal-title">Organizar cuenta ${renderUsername(u)}</h3>
          <button class="modal-close" id="btnCloseOrganizeModal" title="Cerrar">${icons.close}</button>
        </div>
        <p class="sub" style="margin-top: 0; line-height: 1.4;">
          Selecciona las subcategorías en las que deseas clasificar esta cuenta relevante:
        </p>

        <div class="category-select-list">
          ${categories.map(cat => {
            const isChecked = assigned.includes(cat.id);
            return `
              <label class="category-select-item">
                <span>${esc(cat.name)}</span>
                <input
                  type="checkbox"
                  data-cat-toggle="${esc(cat.id)}"
                  data-cat-user="${esc(u)}"
                  ${isChecked ? 'checked' : ''}
                />
              </label>
            `;
          }).join('')}
        </div>

        <!-- Añadir nueva subcategoría rápida -->
        <div style="display: flex; gap: 6px; margin-top: 10px;">
          <input
            id="quickNewCatInput"
            type="text"
            placeholder="Nueva subcategoría…"
            value="${esc(state.newCategoryNameInput)}"
            style="flex: 1;"
          />
          <button id="btnQuickAddCat" class="secondary btn-sm">+ Añadir</button>
        </div>

        <div style="margin-top: 16px;">
          <button id="btnDoneOrganize" class="primary" style="width: 100%;">Guardar</button>
        </div>
      </div>
    </div>
  `;
}


function renderManageCategoriesModal() {
  if (!state.isManageCategoriesModalOpen) return '';

  const categories = state.categories || [];

  return `
    <div class="modal-backdrop" id="manageCategoriesModalBackdrop">
      <div class="modal-sheet">
        <div class="modal-header">
          <h3 class="modal-title">Gestionar Categorías</h3>
          <button class="modal-close" id="btnCloseManageCategoriesModal" title="Cerrar">${icons.close}</button>
        </div>
        <p class="sub" style="margin-top: 0; line-height: 1.4;">
          Crea, renombra o elimina categorías para organizar tus cuentas.
        </p>

        <div class="category-select-list">
          ${categories.map(cat => {
            const isEditing = state.editingCategoryId === cat.id;
            return `
              <div class="manage-category-item">
                ${isEditing ? `
                  <input
                    type="text"
                    id="editCategoryNameInput"
                    value="${esc(state.editingCategoryNameInput)}"
                    style="flex: 1; margin-right: 6px;"
                  />
                  <div class="manage-category-actions">
                    <button class="btn-mini" data-cat-save-edit="${esc(cat.id)}">Guardar</button>
                    <button class="btn-mini" data-cat-cancel-edit>Cancelar</button>
                  </div>
                ` : `
                  <span style="font-weight: 500;">${esc(cat.name)}</span>
                  <div class="manage-category-actions">
                    <button class="btn-mini" data-cat-edit="${esc(cat.id)}" data-cat-name="${esc(cat.name)}">Renombrar</button>
                    <button class="btn-mini danger" data-cat-delete="${esc(cat.id)}">Eliminar</button>
                  </div>
                `}
              </div>
            `;
          }).join('')}
        </div>

        <!-- Añadir categoría -->
        <div style="display: flex; gap: 6px; margin-top: 14px;">
          <input
            id="manageNewCategoryInput"
            type="text"
            placeholder="Nombre de categoría…"
            value="${esc(state.newCategoryNameInput)}"
            style="flex: 1;"
          />
          <button id="btnManageAddCategory" class="primary btn-sm">Crear</button>
        </div>
      </div>
    </div>
  `;
}

function renderDeleteConfirmModal() {
  if (!state.isDeleteModalOpen || !state.deleteTargetUser) return '';
  const u = state.deleteTargetUser;

  return `
    <div class="modal-backdrop" id="deleteModalBackdrop">
      <div class="modal-sheet">
        <div class="modal-header">
          <h3 class="modal-title">Eliminar cuenta</h3>
          <button class="modal-close" id="btnCloseDeleteModal" title="Cerrar">${icons.close}</button>
        </div>
        <p style="font-size: 14px; font-weight: 600; margin: 10px 0 6px;">
          ¿Eliminar @${esc(u)} de FollowCheck?
        </p>
        <p class="sub" style="line-height: 1.4; margin-bottom: 20px;">
          Esta cuenta se eliminará de tus listas y clasificaciones locales. Solo se elimina de FollowCheck, no afecta a tu cuenta de Instagram.
        </p>
        <div style="display: flex; gap: 10px;">
          <button id="btnCancelDelete" class="secondary" style="flex: 1;">Cancelar</button>
          <button id="btnConfirmDelete" class="primary" style="flex: 1; background: #eb4d4b; border-color: #eb4d4b;">Eliminar</button>
        </div>
      </div>
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

  // Lista base según el estado del sistema seleccionado
  let baseList = categorized.notFollowingBack;
  if (state.systemStateFilter === 'relevant' || state.systemStateFilter === 'famous') baseList = categorized.relevant;
  if (state.systemStateFilter === 'secondary' || state.systemStateFilter === 'ignored') baseList = categorized.secondary;
  if (state.systemStateFilter === 'unavailable' || state.systemStateFilter === 'deleted') baseList = categorized.unavailable;

  // Filtrado por subcategoría SOLO si estamos en el grupo Relevantes
  let categoryFiltered = baseList;
  if (state.systemStateFilter === 'relevant' || state.systemStateFilter === 'famous') {
    if (state.selectedCategoryFilter === 'uncategorized') {
      categoryFiltered = baseList.filter(u => isAccountUncategorized(state.categoryMemberships, u));
    } else if (state.selectedCategoryFilter !== 'all') {
      const selectedCatId = state.selectedCategoryFilter;
      categoryFiltered = baseList.filter(u => getAccountCategories(state.categoryMemberships, u).includes(selectedCatId));
    }
  }

  // Filtrado por buscador
  const query = state.notBackSearch.toLowerCase().trim();
  const searchFiltered = categoryFiltered.filter(u => u.toLowerCase().includes(query));
  const suggestionsFiltered = categorized.suggestions.filter(u => u.toLowerCase().includes(query));

  // Conteos de subcategorías en Relevantes
  const categoryCounts = countAccountsPerCategory(categorized.relevant, state.categoryMemberships, state.categories);

  const unfollowedCount = state.activity.filter(e => e.type === 'unfollowed').length;
  const followedCount = state.activity.filter(e => e.type === 'followed').length;
  const isPending = isExportPending(state.exportState.exportRequestedAt, state.exportState.lastSuccessfulImportAt);

  const filteredActivity = state.activity.filter(e => {
    if (state.activityFilter === 'unfollowed') return e.type === 'unfollowed';
    if (state.activityFilter === 'followed') return e.type === 'followed';
    return true;
  });

  // Iniciales y display del perfil para la Home
  const profileInitials = state.profile.displayName
    ? state.profile.displayName.slice(0, 2).toUpperCase()
    : (state.profile.instagramUsername ? state.profile.instagramUsername.slice(0, 2).toUpperCase() : 'FC');
  const profileHandle = state.profile.instagramUsername ? `@${state.profile.instagramUsername}` : '@tu_cuenta';
  const profileUrl = instagramProfileUrl(state.profile.instagramUsername);

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

      <!-- VISTA 1: INICIO (ESTILO PERFIL DE INSTAGRAM) -->
      <section id="homeView" class="${state.currentView === 'homeView' ? '' : 'hidden'}">
        <div class="profile-header-card">
          <div class="profile-main-row">
            <div class="profile-avatar">${esc(profileInitials)}</div>
            <div class="profile-info">
              ${profileUrl
                ? `<a href="${profileUrl}" target="_blank" rel="noopener noreferrer" class="username-link" style="font-size: 18px;">${esc(profileHandle)}</a>`
                : `<span class="username-plain" style="font-size: 18px;">${esc(profileHandle)}</span>`
              }
              ${state.profile.displayName ? `<div class="display-name">${esc(state.profile.displayName)}</div>` : ''}
            </div>
          </div>

          <div class="profile-stats-grid">
            <div class="profile-stat-box">
              <strong>${snapshot?.followers?.length ?? '—'}</strong>
              <span>Seguidores</span>
            </div>
            <div class="profile-stat-box">
              <strong>${snapshot?.following?.length ?? '—'}</strong>
              <span>Seguidos</span>
            </div>
            <div class="profile-stat-box">
              <strong style="color: var(--accent);">${snapshot ? categorized.notFollowingBack.length : '—'}</strong>
              <span>No te siguen</span>
            </div>
          </div>

          <div class="profile-actions">
            <button id="openUpdateModalBtn" class="primary">Actualizar datos</button>
            <button id="goToNotBackBtn" class="secondary">Revisar cuentas</button>
          </div>

          ${state.lastImportOutcome ? `
            <div class="profile-last-sync">
              ${icons.clock} <span>${esc(state.lastImportOutcome)}</span>
            </div>
          ` : (snapshot ? `
            <div class="profile-last-sync">
              ${icons.clock} <span>Última sincronización: ${formatDate(snapshot?.importedAt)}</span>
            </div>
          ` : '')}
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

        <div class="section" style="margin-top: 18px;">
          <div class="section-title">
            <h2>Actividad reciente</h2>
            <small>${state.activity.length} cambios registrados</small>
          </div>
          <div class="card" id="activityPreview">
            ${state.activity.length ? state.activity.slice(0, 4).map(e => `
              <div class="row">
                <div class="avatar ${e.type === 'unfollowed' ? 'down' : 'up'}">
                  ${e.type === 'unfollowed' ? icons.down : icons.up}
                </div>
                <div class="grow" style="min-width: 0;">
                  <div class="name">${renderUsername(e.username)}</div>
                  <div class="sub">${e.type === 'unfollowed' ? 'Te dejó de seguir' : 'Empezó a seguirte'}</div>
                </div>
                <div class="pill ${e.type === 'unfollowed' ? 'bad' : 'good'}">${formatDate(e.createdAt)}</div>
              </div>
            `).join('') : '<div class="empty">Todavía no hay cambios registrados.</div>'}
          </div>
        </div>
      </section>


      <!-- VISTA 2: NO ME SIGUEN (4 GRUPOS PRINCIPALES + SUBCATEGORÍAS EN RELEVANTES) -->
      <section id="notBackView" class="${state.currentView === 'notBackView' ? '' : 'hidden'}">
        <div class="section">
          <div class="section-title">
            <h2>Cuentas</h2>
            <small id="notBackLabel">${snapshot ? searchFiltered.length + ' de ' + baseList.length + ' cuentas' : '0 cuentas'}</small>
          </div>

          <!-- Buscador -->
          <div class="search-bar">
            <input id="searchNotBack" type="text" placeholder="Buscar por usuario…" value="${esc(state.notBackSearch)}" />
          </div>

          <!-- Nivel 1: Selector de 4 Grupos Principales -->
          <div class="filter-group">
            <button class="filter-btn ${state.systemStateFilter === 'notBack' ? 'active' : ''}" data-state-filter="notBack">
              <span>No me siguen</span>
              <span class="filter-btn-count">${categorized.notFollowingBack.length}</span>
            </button>
            <button class="filter-btn ${state.systemStateFilter === 'relevant' || state.systemStateFilter === 'famous' ? 'active' : ''}" data-state-filter="relevant">
              <span>Relevantes</span>
              <span class="filter-btn-count">${categorized.relevant.length}</span>
            </button>
            <button class="filter-btn ${state.systemStateFilter === 'secondary' || state.systemStateFilter === 'ignored' ? 'active' : ''}" data-state-filter="secondary">
              <span>Secundarias</span>
              <span class="filter-btn-count">${categorized.secondary.length}</span>
            </button>
            <button class="filter-btn ${state.systemStateFilter === 'unavailable' || state.systemStateFilter === 'deleted' ? 'active' : ''}" data-state-filter="unavailable">
              <span>No disponibles</span>
              <span class="filter-btn-count">${categorized.unavailable.length}</span>
            </button>
          </div>

          <!-- Nivel 2: Barra horizontal de Subcategorías (SOLO para Relevantes) -->
          ${(state.systemStateFilter === 'relevant' || state.systemStateFilter === 'famous') ? `
            <div class="subcategories-section">
              <div class="subcategories-title">
                <span>Subcategorías</span>
                <button id="btnQuickManageCats" class="btn-text-action">Gestionar</button>
              </div>
              <div class="category-pills-bar">
                <button class="category-pill ${state.selectedCategoryFilter === 'all' ? 'active' : ''}" data-cat-filter="all">
                  Todos <span class="pill-count">${categoryCounts.all}</span>
                </button>
                <button class="category-pill ${state.selectedCategoryFilter === 'uncategorized' ? 'active' : ''}" data-cat-filter="uncategorized">
                  Sin categoría <span class="pill-count">${categoryCounts.uncategorized}</span>
                </button>
                ${(state.categories || []).map(cat => `
                  <button class="category-pill ${state.selectedCategoryFilter === cat.id ? 'active' : ''}" data-cat-filter="${esc(cat.id)}">
                    ${esc(cat.name)} <span class="pill-count">${categoryCounts[cat.id] || 0}</span>
                  </button>
                `).join('')}
              </div>
            </div>
          ` : ''}


          <!-- Sugerencias de cuentas relevantes (en No me siguen) -->
          ${snapshot && state.systemStateFilter === 'notBack' && suggestionsFiltered.length ? `
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
                      <div class="grow" style="min-width: 0;">
                        <div class="name">${renderUsername(sugUser)}</div>
                        <div class="sub">${esc(sugAcc?.autoFamousReason || 'Cuenta pública')}</div>
                      </div>
                      <div class="suggestion-actions">
                        <button class="btn-sug accept" data-sug-action="relevant" data-user="${esc(sugUser)}">Mover</button>
                        <button class="btn-sug dismiss" data-sug-action="dismiss" data-user="${esc(sugUser)}">Mantener</button>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          ` : ''}

          <!-- Lista de Cuentas Filtradas -->
          <div class="card" id="notBackList">
            ${snapshot ? (
              searchFiltered.length ? searchFiltered.map(u => {
                let groupType = 'normal';
                if (state.systemStateFilter === 'relevant' || state.systemStateFilter === 'famous') groupType = 'relevant';
                if (state.systemStateFilter === 'secondary' || state.systemStateFilter === 'ignored') groupType = 'secondary';
                if (state.systemStateFilter === 'unavailable' || state.systemStateFilter === 'deleted') groupType = 'unavailable';
                return renderAccountRow(u, groupType, state.knownAccounts[u]);
              }).join('') : '<div class="empty">No se encontraron cuentas en este filtro.</div>'
            ) : '<div class="empty">Actualiza tus datos para empezar.</div>'}
          </div>
        </div>
      </section>

      <!-- VISTA 3: HISTORIAL DE ACTIVIDAD -->
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
                <div class="grow" style="min-width: 0;">
                  <div class="name">${renderUsername(e.username)}</div>
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

          <!-- Perfil de Instagram Propio -->
          <div class="card settings-card">
            <div class="settings-title">Perfil de Instagram</div>
            <p class="sub" style="margin: 0 0 12px;">Configura tu usuario para personalizar la cabecera de la app.</p>
            <form id="profileForm" style="display: flex; flex-direction: column; gap: 10px;">
              <div class="auth-field">
                <label class="auth-label" for="settingIgUsername">Usuario de Instagram (@)</label>
                <input id="settingIgUsername" type="text" placeholder="ej. marta_99" value="${esc(state.profile.instagramUsername)}" />
              </div>
              <div class="auth-field">
                <label class="auth-label" for="settingDisplayName">Nombre visible (opcional)</label>
                <input id="settingDisplayName" type="text" placeholder="ej. Marta" value="${esc(state.profile.displayName)}" />
              </div>
              <button type="submit" class="secondary" style="align-self: flex-start; margin-top: 4px;">Guardar perfil</button>
            </form>
          </div>

          <!-- Organización y Categorías de Relevantes -->
          <div class="card settings-card">
            <div class="settings-title">Organización de Relevantes</div>
            <p class="sub" style="margin: 0 0 12px;">Crea y gestiona subcategorías para clasificar tus cuentas relevantes.</p>
            <button class="secondary" id="btnOpenManageCategoriesModal" style="width: 100%;">
              Gestionar subcategorías (${state.categories.length})
            </button>
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

      <!-- MODALES -->
      ${renderUpdateModal()}
      ${renderMigrationModal()}
      ${renderOrganizeModal()}
      ${renderManageCategoriesModal()}
      ${renderDeleteConfirmModal()}


      <!-- NAVEGACIÓN INFERIOR -->
      <nav>
        <button class="${state.currentView === 'homeView' ? 'active' : ''}" data-view="homeView">
          ${icons.home}
          <span>Inicio</span>
        </button>
        <button class="${state.currentView === 'notBackView' ? 'active' : ''}" data-view="notBackView">
          ${icons.users}
          <span>Cuentas</span>
        </button>
        <button class="${state.currentView === 'activityView' ? 'active' : ''}" data-view="activityView">
          ${icons.activity}
          <span>Actividad</span>
        </button>
        <button class="${state.currentView === 'settingsView' ? 'active' : ''}" data-view="settingsView">
          ${icons.settings}
          <span>Ajustes</span>
        </button>
      </nav>
    </main>
  `;

  attachListeners();
}

function attachListeners() {
  // Búsqueda
  const searchInput = document.querySelector('#searchNotBack');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.notBackSearch = e.target.value;
      render();
    });
  }

  // Filtros de Actividad
  document.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.activityFilter = btn.dataset.filter;
      render();
    });
  });

  // Filtros de Grupo Principal en Cuentas (Nivel 1)
  document.querySelectorAll('[data-state-filter]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const targetFilter = btn.dataset.stateFilter || btn.closest('[data-state-filter]')?.dataset.stateFilter;
      if (targetFilter) {
        state.systemStateFilter = targetFilter;
        state.selectedCategoryFilter = 'all';
        state.activeMenuUser = null;
        state.activeMenuPosition = null;
        render();
      }
    });
  });

  // Filtros de Subcategorías (Nivel 2)
  document.querySelectorAll('[data-cat-filter]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const targetCat = btn.dataset.catFilter || btn.closest('[data-cat-filter]')?.dataset.catFilter;
      if (targetCat) {
        state.selectedCategoryFilter = targetCat;
        state.activeMenuUser = null;
        state.activeMenuPosition = null;
        render();
      }
    });
  });

  // Botón directo "Organizar" en cada cuenta relevante
  document.querySelectorAll('[data-organize-user]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const user = btn.dataset.organizeUser;
      if (user) {
        state.activeMenuUser = null;
        state.activeMenuPosition = null;
        state.organizeTargetUser = user;
        state.isOrganizeModalOpen = true;
        state.newCategoryNameInput = '';
        render();
      }
    });
  });

  // Botón rápido "Gestionar" subcategorías desde la barra
  const btnQuickManageCats = document.querySelector('#btnQuickManageCats');
  if (btnQuickManageCats) {
    btnQuickManageCats.addEventListener('click', (e) => {
      e.stopPropagation();
      state.isManageCategoriesModalOpen = true;
      state.newCategoryNameInput = '';
      state.editingCategoryId = null;
      render();
    });
  }

  // Botón "Revisar cuentas" desde la Home
  const goToNotBackBtn = document.querySelector('#goToNotBackBtn');
  if (goToNotBackBtn) {
    goToNotBackBtn.addEventListener('click', () => {
      state.currentView = 'notBackView';
      render();
    });
  }


  // Acciones de Sugerencias
  document.querySelectorAll('[data-sug-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.sugAction;
      const user = btn.dataset.user;
      if (!user) return;

      if (action === 'relevant' || action === 'famous') {
        state.knownAccounts = classifyAccount(state.knownAccounts, user, { group: 'relevant', famousSource: 'manual' });
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

  // Botones de Menú Contextual (Cálculo dinámico de posición fija)
  document.querySelectorAll('[data-menu-user]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const user = btn.dataset.menuUser;
      if (state.activeMenuUser === user) {
        state.activeMenuUser = null;
        state.activeMenuPosition = null;
      } else {
        const rect = btn.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        const openUp = spaceBelow < 250 && rect.top > 250;

        state.activeMenuUser = user;
        state.activeMenuPosition = {
          top: rect.bottom + 4,
          bottom: window.innerHeight - rect.top + 4,
          left: Math.max(10, Math.min(rect.right - 210, window.innerWidth - 220)),
          openUp
        };
      }
      render();
    });
  });

  // Acciones dentro del menú desplegable
  document.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const user = btn.dataset.user;

      if (!user) return;

      if (action === 'organize') {
        state.activeMenuUser = null;
        state.organizeTargetUser = user;
        state.isOrganizeModalOpen = true;
        state.newCategoryNameInput = '';
        render();
        return;
      }

      if (action === 'open-ig') {
        state.activeMenuUser = null;
        render();
        const url = instagramProfileUrl(user);
        if (url) window.open(url, '_blank', 'noopener,noreferrer');
        return;
      }

      if (action === 'move-relevant' || action === 'famous' || action === 'famous-manual') {
        state.knownAccounts = classifyAccount(state.knownAccounts, user, { group: 'relevant', famousSource: 'manual' });
      } else if (action === 'move-secondary' || action === 'ignore') {
        state.knownAccounts = classifyAccount(state.knownAccounts, user, { group: 'secondary' });
      } else if (action === 'move-unavailable' || action === 'delete') {
        state.knownAccounts = classifyAccount(state.knownAccounts, user, { group: 'unavailable', unavailableReason: 'manual' });
      } else if (action === 'move-possible-block') {
        state.knownAccounts = classifyAccount(state.knownAccounts, user, { group: 'unavailable', possibleBlock: true });
      } else if (action === 'move-normal' || action === 'restore') {
        state.knownAccounts = classifyAccount(state.knownAccounts, user, { group: 'normal' });
      }

      saveLocalKnownAccounts(state.knownAccounts);
      state.activeMenuUser = null;
      state.activeMenuPosition = null;
      render();

      if (AUTH_ENABLED && state.user && state.knownAccounts[user]) {
        upsertSingleRemotePreference(state.user.id, user, state.knownAccounts[user]);
      }
    });
  });


  // Modal Organizar Cuenta
  const btnCloseOrganizeModal = document.querySelector('#btnCloseOrganizeModal');
  const btnDoneOrganize = document.querySelector('#btnDoneOrganize');
  const organizeModalBackdrop = document.querySelector('#organizeModalBackdrop');

  const closeOrganizeModal = () => {
    state.isOrganizeModalOpen = false;
    state.organizeTargetUser = null;
    render();
  };

  if (btnCloseOrganizeModal) btnCloseOrganizeModal.addEventListener('click', closeOrganizeModal);
  if (btnDoneOrganize) btnDoneOrganize.addEventListener('click', closeOrganizeModal);
  if (organizeModalBackdrop) {
    organizeModalBackdrop.addEventListener('click', (e) => {
      if (e.target === organizeModalBackdrop) closeOrganizeModal();
    });
  }

  // Toggles de categorías dentro del modal Organizar
  document.querySelectorAll('[data-cat-toggle]').forEach(chk => {
    chk.addEventListener('change', async () => {
      const catId = chk.dataset.catToggle;
      const user = chk.dataset.catUser;
      if (!user || !catId) return;

      state.categoryMemberships = toggleAccountCategory(state.categoryMemberships, user, catId);
      saveLocalCategoryMemberships(state.categoryMemberships);
      render();

      if (AUTH_ENABLED && state.user) {
        const assigned = getAccountCategories(state.categoryMemberships, user);
        await saveRemoteAccountCategories(state.user.id, user, assigned);
      }
    });
  });

  // Añadir categoría rápida desde modal Organizar
  const quickNewCatInput = document.querySelector('#quickNewCatInput');
  const btnQuickAddCat = document.querySelector('#btnQuickAddCat');
  if (quickNewCatInput) {
    quickNewCatInput.addEventListener('input', (e) => {
      state.newCategoryNameInput = e.target.value;
    });
  }
  if (btnQuickAddCat && quickNewCatInput) {
    btnQuickAddCat.addEventListener('click', async () => {
      const name = quickNewCatInput.value.trim();
      if (!name) return;
      try {
        state.categories = addCategory(state.categories, name);
        saveLocalCategories(state.categories);
        const newCat = state.categories.find(c => c.name.toLowerCase() === name.toLowerCase());

        if (newCat && state.organizeTargetUser) {
          state.categoryMemberships = toggleAccountCategory(state.categoryMemberships, state.organizeTargetUser, newCat.id);
          saveLocalCategoryMemberships(state.categoryMemberships);
        }
        state.newCategoryNameInput = '';
        render();

        if (AUTH_ENABLED && state.user) {
          await saveRemoteCategories(state.user.id, state.categories);
          if (state.organizeTargetUser) {
            const assigned = getAccountCategories(state.categoryMemberships, state.organizeTargetUser);
            await saveRemoteAccountCategories(state.user.id, state.organizeTargetUser, assigned);
          }
        }
      } catch (err) {
        alert(err.message);
      }
    });
  }

  // Modal Gestionar Categorías
  const btnOpenManageCategoriesModal = document.querySelector('#btnOpenManageCategoriesModal');
  if (btnOpenManageCategoriesModal) {
    btnOpenManageCategoriesModal.addEventListener('click', () => {
      state.isManageCategoriesModalOpen = true;
      state.newCategoryNameInput = '';
      state.editingCategoryId = null;
      render();
    });
  }

  const btnCloseManageCategoriesModal = document.querySelector('#btnCloseManageCategoriesModal');
  const manageCategoriesModalBackdrop = document.querySelector('#manageCategoriesModalBackdrop');
  const closeManageCategoriesModal = () => {
    state.isManageCategoriesModalOpen = false;
    state.editingCategoryId = null;
    render();
  };
  if (btnCloseManageCategoriesModal) btnCloseManageCategoriesModal.addEventListener('click', closeManageCategoriesModal);
  if (manageCategoriesModalBackdrop) {
    manageCategoriesModalBackdrop.addEventListener('click', (e) => {
      if (e.target === manageCategoriesModalBackdrop) closeManageCategoriesModal();
    });
  }

  // Crear categoría desde Gestionar
  const manageNewCategoryInput = document.querySelector('#manageNewCategoryInput');
  const btnManageAddCategory = document.querySelector('#btnManageAddCategory');
  if (manageNewCategoryInput) {
    manageNewCategoryInput.addEventListener('input', (e) => {
      state.newCategoryNameInput = e.target.value;
    });
  }
  if (btnManageAddCategory && manageNewCategoryInput) {
    btnManageAddCategory.addEventListener('click', async () => {
      const name = manageNewCategoryInput.value.trim();
      if (!name) return;
      try {
        state.categories = addCategory(state.categories, name);
        saveLocalCategories(state.categories);
        state.newCategoryNameInput = '';
        render();

        if (AUTH_ENABLED && state.user) {
          await saveRemoteCategories(state.user.id, state.categories);
        }
      } catch (err) {
        alert(err.message);
      }
    });
  }

  // Renombrar / Eliminar categoría en Gestionar
  document.querySelectorAll('[data-cat-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.editingCategoryId = btn.dataset.catEdit;
      state.editingCategoryNameInput = btn.dataset.catName;
      render();
    });
  });

  const editCategoryNameInput = document.querySelector('#editCategoryNameInput');
  if (editCategoryNameInput) {
    editCategoryNameInput.addEventListener('input', (e) => {
      state.editingCategoryNameInput = e.target.value;
    });
  }

  document.querySelectorAll('[data-cat-save-edit]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const catId = btn.dataset.catSaveEdit;
      const newName = state.editingCategoryNameInput.trim();
      if (!newName) return;
      try {
        state.categories = renameCategory(state.categories, catId, newName);
        saveLocalCategories(state.categories);
        state.editingCategoryId = null;
        render();

        if (AUTH_ENABLED && state.user) {
          await saveRemoteCategories(state.user.id, state.categories);
        }
      } catch (err) {
        alert(err.message);
      }
    });
  });

  document.querySelectorAll('[data-cat-cancel-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.editingCategoryId = null;
      render();
    });
  });

  document.querySelectorAll('[data-cat-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const catId = btn.dataset.catDelete;
      if (!confirm('¿Eliminar esta categoría? (Las cuentas clasificadas no se borrarán)')) return;

      const result = deleteCategory(state.categories, state.categoryMemberships, catId);
      state.categories = result.categories;
      state.categoryMemberships = result.memberships;
      saveLocalCategories(state.categories);
      saveLocalCategoryMemberships(state.categoryMemberships);
      render();

      if (AUTH_ENABLED && state.user) {
        await deleteRemoteCategory(state.user.id, catId);
      }
    });
  });

  // Swipe to Delete en filas de cuenta
  let touchStartX = 0;
  let touchCurrentX = 0;
  let activeSwipeRow = null;

  document.querySelectorAll('[data-account-swipe-row]').forEach(row => {
    row.addEventListener('touchstart', (e) => {
      touchStartX = e.touches[0].clientX;
      touchCurrentX = touchStartX;
      activeSwipeRow = row;
      row.style.transition = 'none';
    }, { passive: true });

    row.addEventListener('touchmove', (e) => {
      if (activeSwipeRow !== row) return;
      touchCurrentX = e.touches[0].clientX;
      const diffX = touchCurrentX - touchStartX;
      if (diffX < 0 && diffX > -120) {
        row.style.transform = `translateX(${diffX}px)`;
      } else if (diffX >= 0) {
        row.style.transform = 'translateX(0px)';
      }
    }, { passive: true });

    row.addEventListener('touchend', () => {
      if (activeSwipeRow !== row) return;
      row.style.transition = 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)';
      const diffX = touchCurrentX - touchStartX;
      if (diffX < -60) {
        row.classList.add('swiped');
        row.style.transform = 'translateX(-80px)';
      } else {
        row.classList.remove('swiped');
        row.style.transform = 'translateX(0px)';
      }
      activeSwipeRow = null;
    });
  });

  // Botón "Eliminar" revelado por el swipe
  document.querySelectorAll('[data-swipe-delete-user]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const user = btn.dataset.swipeDeleteUser;
      if (user) {
        state.deleteTargetUser = user;
        state.isDeleteModalOpen = true;
        render();
      }
    });
  });

  // Modal Confirmación Eliminar Cuenta
  const btnCloseDeleteModal = document.querySelector('#btnCloseDeleteModal');
  const btnCancelDelete = document.querySelector('#btnCancelDelete');
  const btnConfirmDelete = document.querySelector('#btnConfirmDelete');
  const deleteModalBackdrop = document.querySelector('#deleteModalBackdrop');

  const closeDeleteModal = () => {
    state.isDeleteModalOpen = false;
    state.deleteTargetUser = null;
    render();
  };

  if (btnCloseDeleteModal) btnCloseDeleteModal.addEventListener('click', closeDeleteModal);
  if (btnCancelDelete) btnCancelDelete.addEventListener('click', closeDeleteModal);
  if (deleteModalBackdrop) {
    deleteModalBackdrop.addEventListener('click', (e) => {
      if (e.target === deleteModalBackdrop) closeDeleteModal();
    });
  }

  if (btnConfirmDelete) {
    btnConfirmDelete.addEventListener('click', async () => {
      const user = state.deleteTargetUser;
      if (!user) return;

      const norm = normalizeUsername(user);
      if (state.knownAccounts[norm]) {
        delete state.knownAccounts[norm];
        saveLocalKnownAccounts(state.knownAccounts);
      }
      if (state.categoryMemberships[norm]) {
        delete state.categoryMemberships[norm];
        saveLocalCategoryMemberships(state.categoryMemberships);
      }

      if (AUTH_ENABLED && state.user) {
        await deleteRemotePreferences(state.user.id, [norm]);
        await deleteRemoteCategoryMemberships(state.user.id, [norm]);
      }

      state.isDeleteModalOpen = false;
      state.deleteTargetUser = null;
      render();
    });
  }

  // Guardar Perfil en Ajustes

  const profileForm = document.querySelector('#profileForm');
  if (profileForm) {
    profileForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const igUser = document.querySelector('#settingIgUsername')?.value.replace(/^@/, '').trim() || '';
      const dispName = document.querySelector('#settingDisplayName')?.value.trim() || '';

      state.profile = {
        instagramUsername: igUser,
        displayName: dispName
      };
      saveLocalProfile(state.profile);
      render();

      if (AUTH_ENABLED && state.user) {
        await saveRemoteProfile(state.user.id, state.profile);
      }
      alert('Perfil guardado correctamente.');
    });
  }

  // Logout y Sync
  const logoutBtn = document.querySelector('#logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await logoutUser();
      state.user = null;
      render();
    });
  }

  const syncNowBtn = document.querySelector('#syncNowBtn');
  if (syncNowBtn) {
    syncNowBtn.addEventListener('click', async () => {
      await syncWithCloud(false);
    });
  }

  // Botones de Migración Local
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
      state.activeMenuPosition = null;
      render();
    });
  });

  // Modal de Actualización Guiada
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
          outcomeText = `Estado inicial: ${current.followers.length} seguidores · ${current.following.length} seguidos`;
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

        state.knownAccounts = syncKnownAccounts(state.knownAccounts, current);

        // Limpieza automática de cuentas ausentes en el nuevo snapshot
        const {
          knownAccounts: cleanedKnown,
          categoryMemberships: cleanedMemberships,
          prunedUsernames
        } = pruneAbsentAccounts({
          followers: current.followers,
          following: current.following,
          knownAccounts: state.knownAccounts,
          categoryMemberships: state.categoryMemberships
        });

        state.knownAccounts = cleanedKnown;
        state.categoryMemberships = cleanedMemberships;

        saveLocalKnownAccounts(state.knownAccounts);
        saveLocalCategoryMemberships(state.categoryMemberships);

        if (AUTH_ENABLED && state.user) {
          const rows = Object.entries(state.knownAccounts).map(([u, acc]) =>
            knownAccountToPreferenceRow(state.user.id, u, acc)
          );
          upsertRemotePreferences(state.user.id, rows);

          if (prunedUsernames.length > 0) {
            await deleteRemotePreferences(state.user.id, prunedUsernames);
            await deleteRemoteCategoryMemberships(state.user.id, prunedUsernames);
          }
        }

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

  // Botones de Actualización PWA
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

// Cerrar menú emergente al hacer click fuera o al hacer scroll
document.addEventListener('click', (e) => {
  if (state.activeMenuUser && !e.target.closest('.account-popover') && !e.target.closest('[data-menu-user]')) {
    state.activeMenuUser = null;
    state.activeMenuPosition = null;
    render();
  }
});

window.addEventListener('scroll', () => {
  if (state.activeMenuUser) {
    state.activeMenuUser = null;
    state.activeMenuPosition = null;
    render();
  }
}, { passive: true });

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
    state.profile = loadLocalProfile();
    state.categories = initDefaultCategories(loadLocalCategories());
    state.categoryMemberships = loadLocalCategoryMemberships();
    state.exportState = loadExportState();

    // Guardar categorías por defecto si no existían
    if (!loadLocalCategories()) {
      saveLocalCategories(state.categories);
    }

    // Inicializar ciclo de vida de PWA
    initPwa(({ status, updateAvailable }) => {
      if (updateAvailable) {
        state.pwaUpdateAvailable = true;
        state.pwaStatusText = 'Nueva versión disponible para instalar.';
        render();
      }
    });

    if (AUTH_ENABLED && supabaseReady()) {
      if (typeof window !== 'undefined' && (window.location.hash.includes('type=recovery') || window.location.search.includes('type=recovery'))) {
        state.authView = 'updatePassword';
      }

      const session = await getAuthSession();
      state.user = session?.user || null;
      console.log('[auth] initial session:', state.user ? 'yes' : 'no');

      let initialProcessed = false;
      subscribeToAuth(async (event, currentSession) => {
        console.log('[auth] event:', event);
        const currentUser = currentSession?.user || null;

        if (event === 'PASSWORD_RECOVERY') {
          state.authView = 'updatePassword';
          state.authError = '';
          state.authSuccess = '';
          render();
          return;
        }

        if (event === 'SIGNED_OUT') {
          state.user = null;
          state.showMigrationPrompt = false;
          render();
          return;
        }

        if (currentUser && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION')) {
          const isNewUser = !state.user || state.user.id !== currentUser.id;
          state.user = currentUser;
          if (state.authView === 'updatePassword') {
            render();
            return;
          }
          if (isNewUser || !initialProcessed) {
            initialProcessed = true;
            await onUserAuthenticated(currentUser);
          } else {
            render();
          }
        }
      });

      if (state.user && !initialProcessed && state.authView !== 'updatePassword') {
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
