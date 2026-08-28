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
  // Regla: si account_group existe en remoto, tiene prioridad absoluta sobre cualquier flag legacy
  let group = 'normal';
  if (row.account_group) {
    group = row.account_group;
  } else if (row.deleted) {
    group = 'unavailable';
  } else if (row.ignored) {
    group = 'secondary';
  } else if (row.famous) {
    group = 'relevant';
  }

  const unavailableReason = row.unavailable_reason || (group === 'unavailable' ? 'manual' : null);

  return {
    group,
    unavailableReason,
    status: row.status || 'normal',
    famous: group === 'relevant' || Boolean(row.famous),
    famousSource: group === 'relevant' ? (row.famous_source || 'manual') : null,
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
      if (userId && (localAcc.updatedAt || localAcc.group !== 'normal' || localAcc.famous || localAcc.ignored || localAcc.deleted)) {
        pendingPushRows.push(knownAccountToPreferenceRow(userId, normUser, localAcc));
      }
    } else {
      // Regla: Solo si localAcc tiene updatedAt explícito y es estrictamente mayor que remote gana local
      const localTime = localAcc.updatedAt ? new Date(localAcc.updatedAt).getTime() : 0;
      const remoteTime = remoteRow.updated_at ? new Date(remoteRow.updated_at).getTime() : 0;

      if (remoteTime >= localTime || localTime === 0) {
        merged[normUser] = preferenceRowToKnownAccount(remoteRow);
      } else if (localTime > remoteTime && userId) {
        pendingPushRows.push(knownAccountToPreferenceRow(userId, normUser, localAcc));
      }
    }
  }

  // 2. Procesar cuentas que solo existen en remoto
  for (const [normUser, remoteRow] of remoteMap.entries()) {
    if (!merged[normUser] || !localKnownAccounts[normUser]) {
      merged[normUser] = preferenceRowToKnownAccount(remoteRow);
    }
  }

  return {
    mergedKnownAccounts: merged,
    pendingPushRows
  };
}

export function reconcileCategoriesAndMemberships({
  localCategories = [],
  remoteCategories = [],
  localMemberships = {},
  remoteMemberships = {},
  userId = null
}) {
  // 1. Reconciliar Categorías: Las remotas son la fuente canónica de verdad
  const canonicalCats = [];
  const oldIdToCanonicalId = new Map();
  const seenNames = new Map();

  // Primero poblar con remotas
  for (const rc of remoteCategories || []) {
    const normName = rc.name.toLowerCase().trim();
    if (!seenNames.has(normName)) {
      canonicalCats.push(rc);
      seenNames.set(normName, rc.id);
      oldIdToCanonicalId.set(rc.id, rc.id);
    }
  }

  // Luego procesar locales: si existe una por nombre, mapear el ID local al ID canónico remoto
  const pendingPushCategories = [];
  for (const lc of localCategories || []) {
    const normName = lc.name.toLowerCase().trim();
    if (seenNames.has(normName)) {
      const canonicalId = seenNames.get(normName);
      oldIdToCanonicalId.set(lc.id, canonicalId);
    } else {
      canonicalCats.push(lc);
      seenNames.set(normName, lc.id);
      oldIdToCanonicalId.set(lc.id, lc.id);
      if (userId) {
        pendingPushCategories.push(lc);
      }
    }
  }

  // 2. Conjunto de IDs válidos
  const validCategoryIds = new Set(canonicalCats.map(c => c.id));

  // 3. Reconciliar Memberships
  const mergedMemberships = {};
  const pendingPushMemberships = [];

  // Mapear remotas
  for (const [rawUser, catIds] of Object.entries(remoteMemberships || {})) {
    const u = rawUser.toLowerCase().trim();
    const validIds = (catIds || []).filter(id => validCategoryIds.has(id));
    mergedMemberships[u] = Array.from(new Set(validIds));
  }

  // Integrar locales remapeando IDs viejos a IDs canónicos
  for (const [rawUser, catIds] of Object.entries(localMemberships || {})) {
    const u = rawUser.toLowerCase().trim();
    const remappedLocalIds = (catIds || [])
      .map(id => oldIdToCanonicalId.get(id) || id)
      .filter(id => validCategoryIds.has(id));

    if (!mergedMemberships[u]) {
      if (remappedLocalIds.length > 0) {
        mergedMemberships[u] = Array.from(new Set(remappedLocalIds));
        if (userId) {
          pendingPushMemberships.push({ user: u, catIds: mergedMemberships[u] });
        }
      }
    } else {
      const combined = Array.from(new Set([...mergedMemberships[u], ...remappedLocalIds]));
      if (combined.length > mergedMemberships[u].length && userId) {
        pendingPushMemberships.push({ user: u, catIds: combined });
      }
      mergedMemberships[u] = combined;
    }
  }

  const isValid = Object.values(mergedMemberships).every(ids => ids.every(id => validCategoryIds.has(id)));

  return {
    categories: canonicalCats,
    categoryMemberships: mergedMemberships,
    pendingPushCategories,
    pendingPushMemberships,
    isValid
  };
}

export function deduplicateActivity(localActivity = [], remoteActivity = []) {
  const seen = new Set();
  const combined = [];

  const all = [...(localActivity || []), ...(remoteActivity || [])];
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

