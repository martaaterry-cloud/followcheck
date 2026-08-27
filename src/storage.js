const SNAPSHOT_KEY = 'followcheck_snapshot_v3';
const ACTIVITY_KEY = 'followcheck_activity_v3';
const KNOWN_ACCOUNTS_KEY = 'followcheck_known_accounts_v1';
const PROFILE_KEY = 'followcheck_profile_v1';
const CATEGORIES_KEY = 'followcheck_categories_v1';
const CATEGORY_MEMBERSHIPS_KEY = 'followcheck_category_memberships_v1';

export function loadLocalSnapshot() {
  try {
    return JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || 'null');
  } catch {
    return null;
  }
}

export function saveLocalSnapshot(snapshot) {
  localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
}

export function loadLocalActivity() {
  try {
    return JSON.parse(localStorage.getItem(ACTIVITY_KEY) || '[]');
  } catch {
    return [];
  }
}

export function saveLocalActivity(activity) {
  localStorage.setItem(ACTIVITY_KEY, JSON.stringify(activity));
}

export function loadLocalKnownAccounts() {
  try {
    return JSON.parse(localStorage.getItem(KNOWN_ACCOUNTS_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

export function saveLocalKnownAccounts(accounts) {
  localStorage.setItem(KNOWN_ACCOUNTS_KEY, JSON.stringify(accounts || {}));
}

export function loadLocalProfile() {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null') || { instagramUsername: '', displayName: '' };
  } catch {
    return { instagramUsername: '', displayName: '' };
  }
}

export function saveLocalProfile(profile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile || { instagramUsername: '', displayName: '' }));
}

export function loadLocalCategories() {
  try {
    return JSON.parse(localStorage.getItem(CATEGORIES_KEY) || 'null');
  } catch {
    return null;
  }
}

export function saveLocalCategories(categories) {
  localStorage.setItem(CATEGORIES_KEY, JSON.stringify(categories || []));
}

export function loadLocalCategoryMemberships() {
  try {
    return JSON.parse(localStorage.getItem(CATEGORY_MEMBERSHIPS_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

export function saveLocalCategoryMemberships(memberships) {
  localStorage.setItem(CATEGORY_MEMBERSHIPS_KEY, JSON.stringify(memberships || {}));
}
