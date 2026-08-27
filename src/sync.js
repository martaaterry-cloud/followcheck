export function knownAccountToPreferenceRow(userId, username, acc) {
  const normUser = String(username).toLowerCase().trim();
  const now = new Date().toISOString();
  return {
    user_id: userId,
    username: normUser,
    famous: Boolean(acc.famous),
    famous_source: acc.famousSource || (acc.famous ? 'manual' : null),
    ignored: Boolean(acc.ignored),
    deleted: Boolean(acc.deleted),
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
  return {
    status: 'normal',
    famous: Boolean(row.famous),
    famousSource: row.famous_source || null,
    ignored: Boolean(row.ignored),
    deleted: Boolean(row.deleted),
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

export function hasLocalDataToMigrate(snapshot, activity, knownAccounts) {
  const hasSnapshot = Boolean(snapshot && snapshot.followers && snapshot.followers.length > 0);
  const hasActivity = Boolean(activity && activity.length > 0);
  const hasKnown = Boolean(knownAccounts && Object.keys(knownAccounts).length > 0);
  return hasSnapshot || hasActivity || hasKnown;
}

export function isLocalDataMigrated(userId) {
  if (!userId) return false;
  return localStorage.getItem(`fc_migrated_user_${userId}`) === 'true';
}

export function markLocalDataMigrated(userId) {
  if (!userId) return;
  localStorage.setItem(`fc_migrated_user_${userId}`, 'true');
}
