import { AUTH_ENABLED } from './config.js';
import { supabase, supabaseReady } from './supabase.js';
import { getAuthUser } from './auth.js';
import {
  loadLocalSnapshot, saveLocalSnapshot,
  loadLocalActivity, saveLocalActivity
} from './storage.js';

export async function getLatestSnapshot() {
  if (!AUTH_ENABLED) {
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
  if (!AUTH_ENABLED) {
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

  return {
    id: data.id,
    importedAt: data.created_at,
    followers: data.followers || [],
    following: data.following || []
  };
}

export async function getActivity() {
  if (!AUTH_ENABLED) {
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

  if (!AUTH_ENABLED) {
    const local = [...events, ...loadLocalActivity()].slice(0, 500);
    saveLocalActivity(local);
    return;
  }

  const user = await getAuthUser();
  if (!user) {
    const local = [...events, ...loadLocalActivity()].slice(0, 500);
    saveLocalActivity(local);
    return;
  }

  const rows = events.map(e => ({
    user_id: user.id,
    type: e.type,
    username: e.username,
    created_at: e.createdAt || new Date().toISOString()
  }));

  const { error } = await supabase.from('activity').insert(rows);
  if (error) throw error;
}
