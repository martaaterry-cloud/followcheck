const MIGRATION_STORAGE_KEY = 'followcheck_migration_state_v1';

export function computeSnapshotFingerprint(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.followers)) return '';
  const followersCount = snapshot.followers.length;
  const followingCount = Array.isArray(snapshot.following) ? snapshot.following.length : 0;
  const firstFollower = snapshot.followers[0] || '';
  const lastFollower = snapshot.followers[followersCount - 1] || '';
  const firstFollowing = snapshot.following?.[0] || '';
  const lastFollowing = snapshot.following?.[followingCount - 1] || '';
  const createdAt = snapshot.createdAt || snapshot.created_at || '';
  return `${createdAt}:${followersCount}:${followingCount}:${firstFollower}:${lastFollower}:${firstFollowing}:${lastFollowing}`;
}

export function getAllMigrationStates() {
  try {
    const raw = localStorage.getItem(MIGRATION_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function getMigrationState(userId) {
  if (!userId) return { migrated: false, migratedAt: null, dismissedAt: null, syncedSnapshotFingerprint: null };
  const all = getAllMigrationStates();
  return all[userId] || { migrated: false, migratedAt: null, dismissedAt: null, syncedSnapshotFingerprint: null };
}

export function saveMigrationState(userId, partialState) {
  if (!userId) return;
  try {
    const all = getAllMigrationStates();
    all[userId] = {
      ...(all[userId] || { migrated: false, migratedAt: null, dismissedAt: null, syncedSnapshotFingerprint: null }),
      ...partialState
    };
    localStorage.setItem(MIGRATION_STORAGE_KEY, JSON.stringify(all));
  } catch (err) {
    console.warn('Error al guardar estado de migración:', err);
  }
}

export function isLocalDataMigrated(userId) {
  if (!userId) return false;
  const st = getMigrationState(userId);
  return Boolean(st.migrated);
}

export function markLocalDataMigrated(userId, snapshot = null) {
  if (!userId) return;
  const fingerprint = computeSnapshotFingerprint(snapshot);
  saveMigrationState(userId, {
    migrated: true,
    migratedAt: new Date().toISOString(),
    syncedSnapshotFingerprint: fingerprint || undefined
  });
}

export function dismissMigrationPrompt(userId) {
  if (!userId) return;
  saveMigrationState(userId, {
    dismissedAt: new Date().toISOString()
  });
}

export function isMigrationDismissed(userId) {
  if (!userId) return false;
  const st = getMigrationState(userId);
  return Boolean(st.dismissedAt);
}

export function hasPendingLocalDataToMigrate({
  userId,
  localSnapshot,
  localActivity = [],
  localKnownAccounts = {},
  remoteSnapshot = null,
  remoteActivity = [],
  remotePrefs = []
}) {
  if (!userId) return false;

  const st = getMigrationState(userId);
  if (st.migrated) {
    // Si ya está marcado como migrado, solo estaría pendiente si hay un snapshot local offline nuevo
    const localFp = computeSnapshotFingerprint(localSnapshot);
    if (!localFp) return false;
    const remoteFp = computeSnapshotFingerprint(remoteSnapshot);
    if (localFp === remoteFp || localFp === st.syncedSnapshotFingerprint) {
      return false;
    }
    return false; // Una vez migrado, las nuevas importaciones se sincronizan automáticamente sin modal
  }

  // Si fue descartado previamente en este dispositivo
  if (st.dismissedAt) {
    return false;
  }

  // Si en la nube YA existen datos para este usuario, la sincronización inicial es directa y silenciosa
  if (remoteSnapshot && Array.isArray(remoteSnapshot.followers) && remoteSnapshot.followers.length > 0) {
    return false;
  }
  if (remotePrefs && remotePrefs.length > 0) {
    return false;
  }

  // Si no hay datos en la nube, verificar si existen datos locales offline previos reales
  const hasLocalSnap = Boolean(localSnapshot && Array.isArray(localSnapshot.followers) && localSnapshot.followers.length > 0);
  const hasLocalAct = Boolean(localActivity && localActivity.length > 0);
  const hasLocalKnown = Boolean(localKnownAccounts && Object.keys(localKnownAccounts).length > 0);

  return hasLocalSnap || hasLocalAct || hasLocalKnown;
}

export function knownAccountToPreferenceRow(userId, username, acc) {
  const normUser = String(username).toLowerCase().trim();
  const now = new Date().toISOString();
  const group = acc.group || (acc.deleted ? 'unavailable' : (acc.ignored ? 'secondary' : (acc.famous ? 'relevant' : 'normal')));
  const unavailableReason = group === 'unavailable'
    ? (acc.unavailableReason || (normUser.startsWith('__deleted__') ? 'deleted' : 'manual'))
    : null;

  return {
    user_id: userId,
    username: normUser,
    account_group: group,
    unavailable_reason: unavailableReason,
    famous: group === 'relevant' || Boolean(acc.famous),
    famous_source: acc.famousSource || (acc.famous || group === 'relevant' ? 'manual' : null),
    ignored: group === 'secondary' || Boolean(acc.ignored),
    deleted: group === 'unavailable' || Boolean(acc.deleted),
    auto_famous_confidence: acc.autoFamousConfidence || 0,
    auto_famous_reason: acc.autoFamousReason || '',
    auto_famous_checked_at: acc.autoFamousCheckedAt || null,
    auto_famous_dismissed: Boolean(acc.autoFamousDismissed),
    note: acc.note || '',
    first_seen: acc.firstSeen || now,
    last_seen: acc.lastSeen || now,
    updated_at: acc.updatedAt || acc.lastSeen || now
  };
}

export function preferenceRowToKnownAccount(row) {
  const now = new Date().toISOString();
  const group = row.account_group || (row.deleted ? 'unavailable' : (row.ignored ? 'secondary' : (row.famous ? 'relevant' : 'normal')));
  const unavailableReason = row.unavailable_reason || (group === 'unavailable' ? 'manual' : null);

  return {
    group,
    unavailableReason,
    status: row.status || 'normal',
    famous: group === 'relevant' || Boolean(row.famous),
    famousSource: row.famous_source || null,
    ignored: group === 'secondary' || Boolean(row.ignored),
    deleted: group === 'unavailable' || Boolean(row.deleted),
    autoFamousConfidence: Number(row.auto_famous_confidence || 0),
    autoFamousReason: row.auto_famous_reason || '',
    autoFamousCheckedAt: row.auto_famous_checked_at || null,
    autoFamousDismissed: Boolean(row.auto_famous_dismissed),
    note: row.note || '',
    firstSeen: row.first_seen || now,
    lastSeen: row.last_seen || now,
    updatedAt: row.updated_at || now
  };
}



export function reconcilePreferences(localKnownAccounts = {}, remoteRows = [], userId = null) {
  const merged = { ...localKnownAccounts };
  const pendingPushRows = [];

  const remoteMap = new Map();
  for (const row of remoteRows) {
    remoteMap.set(row.username.toLowerCase().trim(), row);
  }

  // 1. Procesar cuentas locales
  for (const [user, localAcc] of Object.entries(localKnownAccounts)) {
    const normUser = user.toLowerCase().trim();
    const remoteRow = remoteMap.get(normUser);

    if (!remoteRow) {
      if (userId) {
        pendingPushRows.push(knownAccountToPreferenceRow(userId, normUser, localAcc));
      }
    } else {
      const localTime = new Date(localAcc.updatedAt || localAcc.lastSeen || 0).getTime();
      const remoteTime = new Date(remoteRow.updated_at || 0).getTime();

      if (remoteTime > localTime) {
        merged[normUser] = preferenceRowToKnownAccount(remoteRow);
      } else if (localTime > remoteTime && userId) {
        pendingPushRows.push(knownAccountToPreferenceRow(userId, normUser, localAcc));
      }
    }
  }

  // 2. Procesar cuentas que solo existen en remoto
  for (const [normUser, remoteRow] of remoteMap.entries()) {
    if (!merged[normUser]) {
      merged[normUser] = preferenceRowToKnownAccount(remoteRow);
    }
  }

  return {
    mergedKnownAccounts: merged,
    pendingPushRows
  };
}

export function deduplicateActivity(localActivity = [], remoteActivity = []) {
  const seen = new Set();
  const combined = [];

  const all = [...(localActivity || []), ...(remoteActivity || [])];
  // Ordenar por fecha descendente
  all.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

  for (const item of all) {
    const key = `${item.username}:${item.type}:${item.createdAt}`;
    if (!seen.has(key)) {
      seen.add(key);
      combined.push({
        id: item.id || undefined,
        type: item.type,
        username: item.username,
        createdAt: item.createdAt
      });
    }
  }

  return combined.slice(0, 500);
}
