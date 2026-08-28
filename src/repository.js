import { AUTH_ENABLED } from './config.js';
import { supabase, supabaseReady } from './supabase.js';
import { getAuthUser } from './auth.js';
import {
  loadLocalSnapshot, saveLocalSnapshot,
  loadLocalActivity, saveLocalActivity
} from './storage.js';
import { knownAccountToPreferenceRow } from './sync.js';

export async function getLatestSnapshot() {
  if (!AUTH_ENABLED || !supabaseReady()) {
    return loadLocalSnapshot();
  }

  const user = await getAuthUser();
  if (!user) return loadLocalSnapshot();

  const { data, error } = await supabase
    .from('snapshots')
    .select('id, created_at, followers, following, followers_count, following_count')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? {
    id: data.id,
    importedAt: data.created_at,
    followers: data.followers || [],
    following: data.following || []
  } : null;
}

export async function pruneOldSnapshots(userId, maxKeep = 10) {
  if (!AUTH_ENABLED || !supabaseReady() || !userId) return;

  const { data, error } = await supabase
    .from('snapshots')
    .select('id, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    console.warn('Error al consultar snapshots para retención:', error);
    return;
  }

  if (data && data.length > maxKeep) {
    const toDeleteIds = data.slice(maxKeep).map(s => s.id);
    if (toDeleteIds.length > 0) {
      const { error: deleteError } = await supabase
        .from('snapshots')
        .delete()
        .in('id', toDeleteIds);

      if (deleteError) {
        console.warn('Error al aplicar política de retención de snapshots:', deleteError);
      }
    }
  }
}

export async function saveSnapshot(snapshot) {
  if (!AUTH_ENABLED || !supabaseReady()) {
    const local = {
      id: Date.now(),
      importedAt: snapshot.importedAt || new Date().toISOString(),
      followers: snapshot.followers || [],
      following: snapshot.following || []
    };
    saveLocalSnapshot(local);
    return local;
  }

  const user = await getAuthUser();
  if (!user) {
    saveLocalSnapshot(snapshot);
    return snapshot;
  }

  const { data, error } = await supabase
    .from('snapshots')
    .insert({
      user_id: user.id,
      followers: snapshot.followers,
      following: snapshot.following,
      followers_count: snapshot.followers.length,
      following_count: snapshot.following.length
    })
    .select()
    .single();

  if (error) throw error;

  // Política de retención: mantener un máximo de 10 snapshots completos por usuario
  await pruneOldSnapshots(user.id, 10);

  const result = {
    id: data.id,
    importedAt: data.created_at,
    followers: data.followers || [],
    following: data.following || []
  };

  // Guardar también en local como caché inmediata
  saveLocalSnapshot(result);
  return result;
}

export async function getActivity() {
  if (!AUTH_ENABLED || !supabaseReady()) {
    return loadLocalActivity();
  }

  const user = await getAuthUser();
  if (!user) return loadLocalActivity();

  const { data, error } = await supabase
    .from('activity')
    .select('id, created_at, username, type')
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) throw error;
  return (data || []).map(x => ({
    id: x.id,
    type: x.type,
    username: x.username,
    createdAt: x.created_at
  }));
}

export async function appendActivity(events) {
  if (!events || !events.length) return;

  const local = [...events, ...loadLocalActivity()].slice(0, 500);
  saveLocalActivity(local);

  if (!AUTH_ENABLED || !supabaseReady()) {
    return;
  }

  const user = await getAuthUser();
  if (!user) return;

  const rows = events.map(e => ({
    user_id: user.id,
    type: e.type,
    username: e.username,
    created_at: e.createdAt || new Date().toISOString()
  }));

  const { error } = await supabase.from('activity').insert(rows);
  if (error) throw error;
}

export async function getRemotePreferences(userId) {
  if (!AUTH_ENABLED || !supabaseReady() || !userId) return [];

  const { data, error } = await supabase
    .from('account_preferences')
    .select('*')
    .eq('user_id', userId);

  if (error) throw error;
  return data || [];
}

export async function upsertRemotePreferences(userId, prefsList) {
  if (!AUTH_ENABLED || !supabaseReady() || !userId || !prefsList || !prefsList.length) return;

  const { error } = await supabase
    .from('account_preferences')
    .upsert(prefsList, { onConflict: 'user_id,username' });

  if (error) {
    console.warn('[supabase] error upserting account_preferences, trying fallback:', error);
    if (error.message?.includes('account_group') || error.message?.includes('unavailable_reason') || error.code === '42703') {
      const fallbackRows = prefsList.map(r => {
        const copy = { ...r };
        delete copy.account_group;
        delete copy.unavailable_reason;
        return copy;
      });
      const { error: fallbackErr } = await supabase
        .from('account_preferences')
        .upsert(fallbackRows, { onConflict: 'user_id,username' });
      if (fallbackErr) throw fallbackErr;
    } else {
      throw error;
    }
  }
}

export async function upsertSingleRemotePreference(userId, username, acc) {
  if (!AUTH_ENABLED || !supabaseReady() || !userId || !username || !acc) return;
  const row = knownAccountToPreferenceRow(userId, username, acc);
  await upsertRemotePreferences(userId, [row]);
}

// Perfil de Usuario
export async function getRemoteProfile(userId) {
  if (!AUTH_ENABLED || !supabaseReady() || !userId) return null;
  const { data, error } = await supabase
    .from('user_profile')
    .select('instagram_username, display_name')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return data ? {
    instagramUsername: data.instagram_username || '',
    displayName: data.display_name || ''
  } : null;
}

export async function saveRemoteProfile(userId, profile) {
  if (!AUTH_ENABLED || !supabaseReady() || !userId) return;
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('user_profile')
    .upsert({
      user_id: userId,
      instagram_username: profile.instagramUsername || '',
      display_name: profile.displayName || '',
      updated_at: now
    }, { onConflict: 'user_id' });

  if (error) throw error;
}

// Categorías
export async function getRemoteCategories(userId) {
  if (!AUTH_ENABLED || !supabaseReady() || !userId) return [];
  const { data, error } = await supabase
    .from('categories')
    .select('id, name, sort_order, created_at, updated_at')
    .eq('user_id', userId)
    .order('sort_order', { ascending: true });

  if (error) throw error;
  return (data || []).map(c => ({
    id: c.id,
    name: c.name,
    sortOrder: c.sort_order,
    createdAt: c.created_at,
    updatedAt: c.updated_at
  }));
}

export async function saveRemoteCategories(userId, categoriesList = []) {
  if (!AUTH_ENABLED || !supabaseReady() || !userId || !categoriesList.length) return;
  const rows = categoriesList.map(c => ({
    id: c.id,
    user_id: userId,
    name: c.name,
    sort_order: c.sortOrder ?? 0,
    updated_at: c.updatedAt || new Date().toISOString()
  }));

  const { error } = await supabase
    .from('categories')
    .upsert(rows, { onConflict: 'id' });

  if (error) {
    // Retry on user_id,name if onConflict id fails
    const { error: err2 } = await supabase
      .from('categories')
      .upsert(rows, { onConflict: 'user_id,name' });
    if (err2) throw err2;
  }
}

export async function deleteRemoteCategory(userId, categoryId) {
  if (!AUTH_ENABLED || !supabaseReady() || !userId || !categoryId) return;
  const { error } = await supabase
    .from('categories')
    .delete()
    .eq('id', categoryId)
    .eq('user_id', userId);

  if (error) throw error;
}

// Memberships
export async function getRemoteCategoryMemberships(userId) {
  if (!AUTH_ENABLED || !supabaseReady() || !userId) return {};
  const { data, error } = await supabase
    .from('account_category_memberships')
    .select('username, category_id')
    .eq('user_id', userId);

  if (error) throw error;
  const result = {};
  for (const row of data || []) {
    const u = String(row.username).toLowerCase().trim();
    if (!result[u]) result[u] = [];
    result[u].push(row.category_id);
  }
  return result;
}

export async function saveRemoteAccountCategories(userId, username, categoryIds = []) {
  if (!AUTH_ENABLED || !supabaseReady() || !userId || !username) return;
  const normUser = String(username).toLowerCase().trim();

  // 1. Eliminar anteriores para ese username
  const { error: delErr } = await supabase
    .from('account_category_memberships')
    .delete()
    .eq('user_id', userId)
    .eq('username', normUser);
  if (delErr) throw delErr;

  // 2. Insertar nuevas
  if (categoryIds && categoryIds.length > 0) {
    const rows = categoryIds.map(catId => ({
      user_id: userId,
      username: normUser,
      category_id: catId
    }));
    const { error: insErr } = await supabase
      .from('account_category_memberships')
      .insert(rows);

    if (insErr) throw insErr;
  }
}

export async function deleteRemotePreferences(userId, usernames = []) {
  if (!AUTH_ENABLED || !supabaseReady() || !userId || !usernames.length) return;
  const normList = usernames.map(u => String(u).toLowerCase().trim()).filter(Boolean);
  const { error } = await supabase
    .from('account_preferences')
    .delete()
    .eq('user_id', userId)
    .in('username', normList);

  if (error) throw error;
}

export async function deleteRemoteCategoryMemberships(userId, usernames = []) {
  if (!AUTH_ENABLED || !supabaseReady() || !userId || !usernames.length) return;
  const normList = usernames.map(u => String(u).toLowerCase().trim()).filter(Boolean);
  const { error } = await supabase
    .from('account_category_memberships')
    .delete()
    .eq('user_id', userId)
    .in('username', normList);

  if (error) throw error;
}

export async function deleteRemoteCategoriesByIds(userId, categoryIds = []) {
  if (!AUTH_ENABLED || !supabaseReady() || !userId || !categoryIds.length) return;
  const { error } = await supabase
    .from('categories')
    .delete()
    .eq('user_id', userId)
    .in('id', categoryIds);

  if (error) throw error;
}




