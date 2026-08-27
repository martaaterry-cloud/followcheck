export function normalizeUsername(username) {
  if (!username) return '';
  return String(username).trim().toLowerCase();
}

export function isAutoDeleted(username) {
  const u = normalizeUsername(username);
  return u.startsWith('__deleted__');
}

export function createAccountRecord(username, overrides = {}) {
  const now = new Date().toISOString();
  const normalized = normalizeUsername(username);
  const autoDel = isAutoDeleted(normalized);

  return {
    status: 'normal',
    famous: false,
    ignored: false,
    deleted: autoDel,
    note: '',
    firstSeen: now,
    lastSeen: now,
    ...overrides
  };
}

export function syncKnownAccounts(knownAccounts = {}, snapshot = null) {
  const updated = { ...(knownAccounts || {}) };
  const now = new Date().toISOString();

  if (!snapshot) return updated;

  const allUsernames = new Set([
    ...(snapshot.followers || []),
    ...(snapshot.following || [])
  ]);

  for (const rawUsername of allUsernames) {
    const u = normalizeUsername(rawUsername);
    if (!u) continue;

    if (updated[u]) {
      const existing = updated[u];
      const autoDel = isAutoDeleted(u);
      updated[u] = {
        ...existing,
        lastSeen: now,
        deleted: existing.deleted || autoDel
      };
    } else {
      updated[u] = createAccountRecord(u, {
        firstSeen: now,
        lastSeen: now
      });
    }
  }

  return updated;
}

export function classifyAccount(knownAccounts = {}, username, updates = {}) {
  const u = normalizeUsername(username);
  if (!u) return knownAccounts;

  const current = knownAccounts[u] || createAccountRecord(u);
  let nextState = { ...current };

  if (updates.famous !== undefined) {
    nextState.famous = Boolean(updates.famous);
    if (nextState.famous) {
      nextState.ignored = false;
      nextState.deleted = false;
    }
  }

  if (updates.ignored !== undefined) {
    nextState.ignored = Boolean(updates.ignored);
    if (nextState.ignored) {
      nextState.famous = false;
      nextState.deleted = false;
    }
  }

  if (updates.deleted !== undefined) {
    nextState.deleted = Boolean(updates.deleted);
    if (nextState.deleted) {
      nextState.famous = false;
      nextState.ignored = false;
    }
  }

  if (updates.restore === true || updates.status === 'normal') {
    nextState.famous = false;
    nextState.ignored = false;
    nextState.deleted = false;
    nextState.status = 'normal';
  }

  if (updates.note !== undefined) {
    nextState.note = String(updates.note);
  }

  return {
    ...knownAccounts,
    [u]: nextState
  };
}

export function categorizeNotFollowingBack(notFollowingBackList = [], knownAccounts = {}) {
  const accounts = knownAccounts || {};

  const notFollowingBack = [];
  const famous = [];
  const ignored = [];
  const deleted = [];

  for (const rawUsername of notFollowingBackList) {
    const u = normalizeUsername(rawUsername);
    if (!u) continue;

    const acc = accounts[u];
    const isDel = acc?.deleted === true || isAutoDeleted(u);
    const isFam = !isDel && acc?.famous === true;
    const isIgn = !isDel && !isFam && acc?.ignored === true;

    if (isDel) {
      deleted.push(rawUsername);
    } else if (isFam) {
      famous.push(rawUsername);
    } else if (isIgn) {
      ignored.push(rawUsername);
    } else {
      notFollowingBack.push(rawUsername);
    }
  }

  return {
    notFollowingBack,
    famous,
    ignored,
    deleted
  };
}
