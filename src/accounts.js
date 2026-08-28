import { detectRelevantAccount, CONFIDENCE_THRESHOLDS } from './detector.js';

export function normalizeUsername(username) {
  if (!username) return '';
  return String(username).trim().toLowerCase();
}

export function instagramProfileUrl(username) {
  if (!username) return null;
  const clean = String(username).trim();
  if (clean === '' || clean.startsWith('__deleted__')) {
    return null;
  }
  return `https://www.instagram.com/${encodeURIComponent(clean)}/`;
}

export function isAutoDeleted(username) {
  const u = normalizeUsername(username);
  return u.startsWith('__deleted__');
}

/**
 * Determina el grupo semántico a partir de los datos existentes.
 * 1. unavailable: deleted=true o __deleted__ o unavailableReason presente
 * 2. secondary: ignored=true o group='secondary'
 * 3. relevant: famous=true o group='relevant'
 * 4. normal
 */
export function resolveAccountGroup(acc, autoDel = false) {
  if (autoDel || acc?.deleted || acc?.group === 'unavailable' || acc?.unavailableReason) {
    return 'unavailable';
  }
  if (acc?.group === 'secondary' || acc?.ignored) {
    return 'secondary';
  }
  if (acc?.group === 'relevant' || acc?.famous) {
    return 'relevant';
  }
  return 'normal';
}

export function createAccountRecord(username, overrides = {}) {
  const now = new Date().toISOString();
  const normalized = normalizeUsername(username);
  const autoDel = isAutoDeleted(normalized);
  const group = resolveAccountGroup(overrides, autoDel);

  return {
    group,
    unavailableReason: group === 'unavailable' ? (autoDel ? 'deleted' : (overrides.unavailableReason || 'manual')) : null,

    // Compatibilidad retroactiva
    status: group === 'normal' ? 'normal' : group,
    famous: group === 'relevant',
    ignored: group === 'secondary',
    deleted: group === 'unavailable',

    // Metadatos de detección automática
    famousSource: group === 'relevant' ? (overrides.famousSource || 'manual') : null,
    autoFamousConfidence: 0.0,  // 0.0 - 1.0
    autoFamousReason: '',       // Explicación
    autoFamousCheckedAt: null,  // Timestamp
    autoFamousDismissed: false, // true si el usuario descartó clasificación

    note: '',
    firstSeen: now,
    lastSeen: now,
    ...overrides
  };
}

/**
 * Evalúa si una cuenta debe clasificarse o sugerirse automáticamente como relevante.
 * Respeta la prioridad de decisiones manuales previas y descartes del usuario.
 */
export function evaluateAccountAutoFamous(account, username, forceRecheck = false) {
  const now = new Date().toISOString();
  const u = normalizeUsername(username);

  if (account.autoFamousCheckedAt && !forceRecheck) {
    return account;
  }

  const group = resolveAccountGroup(account);

  // 1. Unavailable o Secondary siempre prevalecen sobre relevante automático
  if (group === 'unavailable' || group === 'secondary') {
    return {
      ...account,
      group,
      autoFamousCheckedAt: account.autoFamousCheckedAt || now
    };
  }

  // 2. Relevante manual siempre prevalece
  if (group === 'relevant' && account.famousSource !== 'auto') {
    return {
      ...account,
      group: 'relevant',
      famous: true,
      famousSource: account.famousSource || 'manual',
      autoFamousCheckedAt: account.autoFamousCheckedAt || now
    };
  }

  // 3. Si el usuario descartó previamente, mantener
  if (account.autoFamousDismissed) {
    return {
      ...account,
      autoFamousCheckedAt: account.autoFamousCheckedAt || now
    };
  }

  // Ejecutar detector local
  const detection = detectRelevantAccount(u);
  const isAutoClassify = detection.confidence >= CONFIDENCE_THRESHOLDS.AUTO_CLASSIFY;

  const isRelevant = isAutoClassify ? true : (account.famous && account.famousSource === 'manual');
  const resolvedGroup = isRelevant ? 'relevant' : 'normal';

  return {
    ...account,
    group: resolvedGroup,
    famous: isRelevant,
    famousSource: isAutoClassify ? 'auto' : account.famousSource,
    autoFamousConfidence: detection.confidence,
    autoFamousReason: detection.reason,
    autoFamousCheckedAt: now
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
      const group = resolveAccountGroup(existing, autoDel);
      const withUpdatedMeta = {
        ...existing,
        group,
        deleted: group === 'unavailable',
        unavailableReason: group === 'unavailable' ? (existing.unavailableReason || (autoDel ? 'deleted' : 'manual')) : null,
        lastSeen: now
      };

      if (!withUpdatedMeta.autoFamousCheckedAt) {
        updated[u] = evaluateAccountAutoFamous(withUpdatedMeta, u);
      } else {
        updated[u] = withUpdatedMeta;
      }
    } else {
      const newRecord = createAccountRecord(u, {
        firstSeen: now,
        lastSeen: now
      });
      updated[u] = evaluateAccountAutoFamous(newRecord, u);
    }
  }

  return updated;
}

export function classifyAccount(knownAccounts = {}, username, updates = {}) {
  const u = normalizeUsername(username);
  if (!u) return knownAccounts;

  const current = knownAccounts[u] || createAccountRecord(u);
  let nextState = { ...current };

  // 1. Mover a Relevantes
  if (updates.group === 'relevant' || updates.famous !== undefined) {
    const isRel = updates.group === 'relevant' || Boolean(updates.famous);
    if (isRel) {
      nextState.group = 'relevant';
      nextState.famous = true;
      nextState.ignored = false;
      nextState.deleted = false;
      nextState.unavailableReason = null;
      nextState.famousSource = updates.famousSource || 'manual';
      nextState.autoFamousDismissed = false;
    } else {
      nextState.group = 'normal';
      nextState.famous = false;
      nextState.famousSource = null;
    }
  }

  // 2. Mover a Cuentas Secundarias
  if (updates.group === 'secondary' || updates.ignored !== undefined) {
    const isSec = updates.group === 'secondary' || Boolean(updates.ignored);
    if (isSec) {
      nextState.group = 'secondary';
      nextState.ignored = true;
      nextState.famous = false;
      nextState.deleted = false;
      nextState.unavailableReason = null;
      nextState.famousSource = null;
    } else {
      nextState.group = 'normal';
      nextState.ignored = false;
    }
  }

  // 3. Mover a No disponibles / Eliminadas
  if (updates.group === 'unavailable' || updates.deleted !== undefined || updates.possibleBlock) {
    const isUnav = updates.group === 'unavailable' || Boolean(updates.deleted) || Boolean(updates.possibleBlock);
    if (isUnav) {
      nextState.group = 'unavailable';
      nextState.deleted = true;
      nextState.famous = false;
      nextState.ignored = false;
      nextState.famousSource = null;
      nextState.unavailableReason = updates.possibleBlock
        ? 'possible_block'
        : (updates.unavailableReason || (isAutoDeleted(u) ? 'deleted' : 'manual'));
    } else {
      nextState.group = 'normal';
      nextState.deleted = false;
      nextState.unavailableReason = null;
    }
  }

  // 4. Restaurar a normal (No me siguen)
  if (updates.restore === true || updates.status === 'normal' || updates.group === 'normal') {
    if (nextState.famousSource === 'auto') {
      nextState.autoFamousDismissed = true;
    }
    nextState.group = 'normal';
    nextState.famous = false;
    nextState.ignored = false;
    nextState.deleted = false;
    nextState.unavailableReason = null;
    nextState.famousSource = null;
    nextState.status = 'normal';
  }

  if (updates.dismissSuggestion === true) {
    nextState.autoFamousDismissed = true;
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
  const relevant = [];
  const secondary = [];
  const unavailable = [];
  const suggestions = [];
  const seenUnavailable = new Set();

  for (const rawUsername of notFollowingBackList) {
    const u = normalizeUsername(rawUsername);
    if (!u) continue;

    const acc = accounts[u];
    const autoDel = isAutoDeleted(u);
    const group = resolveAccountGroup(acc, autoDel);

    if (group === 'unavailable') {
      unavailable.push(rawUsername);
      seenUnavailable.add(u);
    } else if (group === 'secondary') {
      secondary.push(rawUsername);
    } else if (group === 'relevant') {
      relevant.push(rawUsername);
    } else {
      notFollowingBack.push(rawUsername);

      // Sugerencias automáticas
      if (
        !acc?.autoFamousDismissed &&
        acc?.autoFamousConfidence >= CONFIDENCE_THRESHOLDS.SUGGEST &&
        acc?.autoFamousConfidence < CONFIDENCE_THRESHOLDS.AUTO_CLASSIFY
      ) {
        suggestions.push(rawUsername);
      }
    }
  }

  // Incluir también cuentas en knownAccounts marcadas como 'unavailable' o con unavailableReason
  // que ya no estén presentes en notFollowingBackList (ej. cuentas borradas o bloqueos preservados)
  for (const [rawU, acc] of Object.entries(accounts)) {
    const u = normalizeUsername(rawU);
    if (!u || seenUnavailable.has(u)) continue;

    const autoDel = isAutoDeleted(u);
    const group = resolveAccountGroup(acc, autoDel);
    if (group === 'unavailable') {
      unavailable.push(rawU);
      seenUnavailable.add(u);
    }
  }

  return {
    notFollowingBack,
    relevant,
    secondary,
    unavailable,
    suggestions,
    // Alias para compatibilidad con código existente
    famous: relevant,
    ignored: secondary,
    deleted: unavailable
  };
}

/**
 * Limpia automáticamente cuentas ausentes en el último snapshot (followers ∪ following).
 * Conserva únicamente cuentas en 'unavailable' o con unavailableReason / __deleted__*.
 * Devuelve knownAccounts y categoryMemberships limpios junto con los usernames podados.
 */
export function pruneAbsentAccounts({
  followers = [],
  following = [],
  knownAccounts = {},
  categoryMemberships = {}
} = {}) {
  const presentNow = new Set([
    ...(followers || []).map(normalizeUsername),
    ...(following || []).map(normalizeUsername)
  ]);

  const cleanedKnown = {};
  const cleanedMemberships = { ...(categoryMemberships || {}) };
  const prunedUsernames = [];

  const KEEP_REASONS = new Set(['possible_block', 'deleted', 'unavailable', 'manual']);

  for (const [rawUser, acc] of Object.entries(knownAccounts || {})) {
    const u = normalizeUsername(rawUser);
    if (!u) continue;

    const isPresent = presentNow.has(u);

    if (isPresent) {
      cleanedKnown[u] = acc;
    } else {
      // Cuenta ausente en snapshot actual
      const autoDel = isAutoDeleted(u);
      const group = resolveAccountGroup(acc, autoDel);
      const hasPreserveReason = acc?.unavailableReason && KEEP_REASONS.has(acc.unavailableReason);

      if (group === 'unavailable' || hasPreserveReason || autoDel) {
        // Se conserva en 'unavailable'
        cleanedKnown[u] = {
          ...acc,
          group: 'unavailable',
          deleted: true,
          unavailableReason: acc.unavailableReason || (autoDel ? 'deleted' : 'manual')
        };
      } else {
        // Se poda de knownAccounts y de memberships
        prunedUsernames.push(u);
        delete cleanedMemberships[u];
      }
    }
  }

  return {
    knownAccounts: cleanedKnown,
    categoryMemberships: cleanedMemberships,
    prunedUsernames
  };
}
