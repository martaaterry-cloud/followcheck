import { supabase, supabaseReady } from './supabase.js';
import {
  loadLocalSnapshot, saveLocalSnapshot,
  loadLocalActivity, saveLocalActivity
} from './storage.js';

export async function getLatestSnapshot(){
  if (!supabaseReady()) return loadLocalSnapshot();

  const { data, error } = await supabase
    .from('snapshots')
    .select('id, created_at, followers, following')
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

export async function saveSnapshot(snapshot){
  saveLocalSnapshot(snapshot);
  if (!supabaseReady()) return snapshot;

  const { data, error } = await supabase
    .from('snapshots')
    .insert({
      followers: snapshot.followers,
      following: snapshot.following,
      followers_count: snapshot.followers.length,
      following_count: snapshot.following.length
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getActivity(){
  if (!supabaseReady()) return loadLocalActivity();

  const { data, error } = await supabase
    .from('activity')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) throw error;
  return (data || []).map(x => ({
    type: x.type,
    username: x.username,
    createdAt: x.created_at
  }));
}

export async function appendActivity(events){
  const local = [...events, ...loadLocalActivity()].slice(0, 500);
  saveLocalActivity(local);

  if (!supabaseReady() || !events.length) return;

  const rows = events.map(e => ({
    type: e.type,
    username: e.username
  }));

  const { error } = await supabase.from('activity').insert(rows);
  if (error) throw error;
}
