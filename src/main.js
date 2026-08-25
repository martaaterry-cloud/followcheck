import './styles.css';
import { APP_VERSION } from './config.js';
import { parseInstagramZip } from './instagramImport.js';
import { compareSnapshots, calculateNotFollowingBack } from './compare.js';
import { getLatestSnapshot, saveSnapshot, getActivity, appendActivity } from './repository.js';
import { supabaseReady } from './supabase.js';

const state = { snapshot: null, activity: [] };

document.querySelector('#app').innerHTML = `
  <main class="app">
    <header>
      <h1>FollowCheck</h1>
      <div class="badge">v${APP_VERSION}</div>
    </header>

    <section id="homeView">
      <div class="grid">
        <div class="stat"><strong id="followersCount">—</strong><span>Seguidores</span></div>
        <div class="stat"><strong id="followingCount">—</strong><span>Seguidos</span></div>
        <div class="stat"><strong id="notBackCount">—</strong><span>No te siguen</span></div>
      </div>

      <div class="section">
        <div class="section-title">
          <h2>Actualizar Instagram</h2>
          <small>${supabaseReady() ? 'Supabase' : 'modo local'}</small>
        </div>
        <div class="card import-box">
          <div class="name">Importa tu ZIP oficial</div>
          <div class="sub">No se pide contraseña de Instagram.</div>
          <input id="zipInput" type="file" accept=".zip,application/zip">
          <button id="importBtn" class="primary">Analizar y guardar</button>
          <div class="status" id="importStatus"></div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">
          <h2>Actividad reciente</h2>
          <small id="activityCount">0 cambios</small>
        </div>
        <div class="card" id="activityPreview"></div>
      </div>
    </section>

    <section id="notBackView" class="hidden">
      <div class="section">
        <div class="section-title">
          <h2>No me siguen</h2>
          <small id="notBackLabel">0 cuentas</small>
        </div>
        <div class="card" id="notBackList"></div>
      </div>
    </section>

    <section id="activityView" class="hidden">
      <div class="section">
        <div class="section-title">
          <h2>Actividad</h2>
          <small>historial</small>
        </div>
        <div class="card" id="activityList"></div>
      </div>
    </section>
  </main>

  <nav>
    <button class="active" data-view="homeView">Inicio</button>
    <button data-view="notBackView">No me siguen</button>
    <button data-view="activityView">Actividad</button>
  </nav>
`;

const esc = s => String(s).replace(/[&<>"']/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));
const initials = u => u.slice(0,2).toUpperCase();

function render(){
  const snapshot = state.snapshot;
  const notBack = calculateNotFollowingBack(snapshot);

  document.querySelector('#followersCount').textContent = snapshot?.followers?.length ?? '—';
  document.querySelector('#followingCount').textContent = snapshot?.following?.length ?? '—';
  document.querySelector('#notBackCount').textContent = snapshot ? notBack.length : '—';
  document.querySelector('#notBackLabel').textContent = `${notBack.length} cuentas`;
  document.querySelector('#activityCount').textContent = `${state.activity.length} cambios`;

  document.querySelector('#notBackList').innerHTML = snapshot
    ? (notBack.length ? notBack.map(u => `
      <a class="row" href="https://www.instagram.com/${encodeURIComponent(u)}/" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:none">
        <div class="avatar">${esc(initials(u))}</div>
        <div class="grow">
          <div class="name">@${esc(u)}</div>
          <div class="sub">Abrir en Instagram</div>
        </div>
        <div class="pill bad">no te sigue</div>
      </a>
    `).join('') : '<div class="empty">Todas las cuentas que sigues también te siguen.</div>')
    : '<div class="empty">Importa un ZIP para empezar.</div>';

  const renderActivity = (selector, limit) => {
    const rows = limit ? state.activity.slice(0, limit) : state.activity;
    document.querySelector(selector).innerHTML = rows.length ? rows.map(e => `
      <div class="row">
        <div class="avatar">${e.type === 'unfollowed' ? '↓' : '↑'}</div>
        <div class="grow">
          <div class="name">@${esc(e.username)}</div>
          <div class="sub">${e.type === 'unfollowed' ? 'Te dejó de seguir' : 'Empezó a seguirte'}</div>
        </div>
        <div class="pill ${e.type === 'unfollowed' ? 'bad' : 'good'}">${new Date(e.createdAt).toLocaleDateString('es-ES')}</div>
      </div>
    `).join('') : '<div class="empty">Todavía no hay cambios.</div>';
  };

  renderActivity('#activityPreview', 3);
  renderActivity('#activityList');
}

async function boot(){
  try{
    state.snapshot = await getLatestSnapshot();
    state.activity = await getActivity();
  }catch(err){
    console.error(err);
  }
  render();
}
boot();

document.querySelector('#importBtn').addEventListener('click', async () => {
  const input = document.querySelector('#zipInput');
  const status = document.querySelector('#importStatus');

  if (!input.files?.[0]){
    status.textContent = 'Selecciona primero el ZIP.';
    return;
  }

  try{
    status.textContent = 'Analizando…';
    const current = await parseInstagramZip(input.files[0]);
    const previous = state.snapshot;
    const changes = compareSnapshots(previous, current);

    const now = new Date().toISOString();
    const events = [
      ...changes.unfollowed.map(username => ({ type:'unfollowed', username, createdAt:now })),
      ...changes.newFollowers.map(username => ({ type:'followed', username, createdAt:now }))
    ];

    await saveSnapshot(current);
    await appendActivity(events);

    state.snapshot = current;
    state.activity = [...events, ...state.activity].slice(0, 500);

    status.textContent =
      `Guardado: ${current.followers.length} seguidores · ${current.following.length} seguidos · ` +
      `${changes.unfollowed.length} bajas · ${changes.newFollowers.length} altas.`;

    render();
  }catch(err){
    console.error(err);
    status.textContent = `Error: ${err.message}`;
  }
});

document.querySelectorAll('nav button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    ['homeView','notBackView','activityView'].forEach(id => {
      document.querySelector('#'+id).classList.toggle('hidden', id !== btn.dataset.view);
    });
  });
});
