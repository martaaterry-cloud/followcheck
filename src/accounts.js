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


export function createAccountRecord(username, overrides = {}) {
  const now = new Date().toISOString();
  const normalized = normalizeUsername(username);
  const autoDel = isAutoDeleted(normalized);

  return {
    status: 'normal',
    famous: false,
    ignored: false,
    deleted: autoDel,

    // Metadatos de detección automática
    famousSource: null,         // 'manual' | 'auto' | null
    autoFamousConfidence: 0.0,  // Puntuación de confianza 0.0 - 1.0
    autoFamousReason: '',       // Explicación de la detección
    autoFamousCheckedAt: null,  // Timestamp de evaluación
    autoFamousDismissed: false, // true si el usuario descartó la sugerencia/clasificación automática

    note: '',
    firstSeen: now,
    lastSeen: now,
    ...overrides
  };
}

/**
 * Evalúa si una cuenta debe clasificarse o sugerirse automáticamente como famosa.
 * Respeta la prioridad de decisiones manuales previas y descartes del usuario.
 */
export function evaluateAccountAutoFamous(account, username, forceRecheck = false) {
  const now = new Date().toISOString();
  const u = normalizeUsername(username);

  // Si ya fue evaluada y no se fuerza reanálisis, mantener estado
  if (account.autoFamousCheckedAt && !forceRecheck) {
    return account;
  }

  // 1. Deleted o Ignored siempre prevalecen sobre famoso automático
  if (account.deleted || account.ignored) {
    return {
      ...account,
      autoFamousCheckedAt: account.autoFamousCheckedAt || now
    };
  }

  // 2. Famous manual o legacy de Fase A siempre prevalece y se preserva como manual
  if (account.famous && account.famousSource !== 'auto') {
    return {
      ...account,
      famous: true,
      famousSource: account.famousSource || 'manual',
      autoFamousCheckedAt: account.autoFamousCheckedAt || now
    };
  }

  // 3. Si el usuario descartó previamente la clasificación automática, no volver a mover
  if (account.autoFamousDismissed) {
    return {
      ...account,
      autoFamousCheckedAt: account.autoFamousCheckedAt || now
    };
  }

  // Ejecutar detector local
  const detection = detectRelevantAccount(u);
  const isAutoClassify = detection.confidence >= CONFIDENCE_THRESHOLDS.AUTO_CLASSIFY;

  return {
    ...account,
    autoFamousConfidence: detection.confidence,
    autoFamousReason: detection.reason,
    autoFamousCheckedAt: now,
    famous: isAutoClassify ? true : (account.famous && account.famousSource === 'manual'),
    famousSource: isAutoClassify ? 'auto' : account.famousSource
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
      const withUpdatedMeta = {
        ...existing,
        lastSeen: now,
        deleted: existing.deleted || autoDel
      };

      // Si aún no ha sido evaluada con el detector automático, evaluarla ahora
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

  if (updates.famous !== undefined) {
    nextState.famous = Boolean(updates.famous);
    if (nextState.famous) {
      nextState.ignored = false;
      nextState.deleted = false;
      nextState.famousSource = updates.famousSource || 'manual';
      nextState.autoFamousDismissed = false;
    } else {
      nextState.famousSource = null;
    }
  }

  if (updates.ignored !== undefined) {
    nextState.ignored = Boolean(updates.ignored);
    if (nextState.ignored) {
      nextState.famous = false;
      nextState.deleted = false;
      nextState.famousSource = null;
    }
  }

  if (updates.deleted !== undefined) {
    nextState.deleted = Boolean(updates.deleted);
    if (nextState.deleted) {
      nextState.famous = false;
      nextState.ignored = false;
      nextState.famousSource = null;
    }
  }

  if (updates.restore === true || updates.status === 'normal') {
    // Si era automática, registrar descarte para evitar que vuelva a auto-clasificarse sola
    if (nextState.famousSource === 'auto') {
      nextState.autoFamousDismissed = true;
    }
    nextState.famous = false;
    nextState.ignored = false;
    nextState.deleted = false;
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
  const famous = [];
  const ignored = [];
  const deleted = [];
  const suggestions = [];

  for (const rawUsername of notFollowingBackList) {
    const u = normalizeUsername(rawUsername);
    if (!u) continue;

    const acc = accounts[u];
    const isDel = acc?.deleted === true || isAutoDeleted(u);
    const isIgn = !isDel && acc?.ignored === true;
    const isFam = !isDel && !isIgn && acc?.famous === true;

    if (isDel) {
      deleted.push(rawUsername);
    } else if (isIgn) {
      ignored.push(rawUsername);
    } else if (isFam) {
      famous.push(rawUsername);
    } else {
      notFollowingBack.push(rawUsername);

      // Evaluar si es candidata a sugerencia
      if (
        !acc?.autoFamousDismissed &&
        acc?.autoFamousConfidence >= CONFIDENCE_THRESHOLDS.SUGGEST &&
        acc?.autoFamousConfidence < CONFIDENCE_THRESHOLDS.AUTO_CLASSIFY
      ) {
        suggestions.push(rawUsername);
      }
    }
  }

  return {
    notFollowingBack,
    famous,
    ignored,
    deleted,
    suggestions
  };
}
