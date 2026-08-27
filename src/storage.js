const SNAPSHOT_KEY = 'followcheck_snapshot_v3';
const ACTIVITY_KEY = 'followcheck_activity_v3';
const KNOWN_ACCOUNTS_KEY = 'followcheck_known_accounts_v1';

export function loadLocalSnapshot(){
  return JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || 'null');
}
export function saveLocalSnapshot(snapshot){
  localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
}
export function loadLocalActivity(){
  return JSON.parse(localStorage.getItem(ACTIVITY_KEY) || '[]');
}
export function saveLocalActivity(activity){
  localStorage.setItem(ACTIVITY_KEY, JSON.stringify(activity));
}
export function loadLocalKnownAccounts(){
  try {
    return JSON.parse(localStorage.getItem(KNOWN_ACCOUNTS_KEY) || '{}') || {};
  } catch {
    return {};
  }
}
export function saveLocalKnownAccounts(accounts){
  localStorage.setItem(KNOWN_ACCOUNTS_KEY, JSON.stringify(accounts || {}));
}

