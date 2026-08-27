import { KNOWN_RELEVANT_ACCOUNTS } from './data/knownRelevantAccounts.js';

export const CONFIDENCE_THRESHOLDS = {
  AUTO_CLASSIFY: 0.90, // Mover automáticamente a Famosas / relevantes
  SUGGEST: 0.60        // Sugerir al usuario mediante acción rápida
};

export function normalizeUsername(username) {
  if (!username) return '';
  return String(username).trim().toLowerCase();
}

/**
 * Detecta si una cuenta es pública/relevante utilizando fuentes locales y catálogo curado.
 * Desacoplado para facilitar futuras integraciones externas sin alterar la lógica de negocio.
 *
 * @param {string} username
 * @returns {{ isMatch: boolean, confidence: number, reason: string, category: string|null, name: string|null }}
 */
export function detectRelevantAccount(username) {
  const u = normalizeUsername(username);
  if (!u) {
    return {
      isMatch: false,
      confidence: 0.0,
      reason: '',
      category: null,
      name: null
    };
  }

  // 1. Verificación en catálogo curado local (confianza alta)
  if (KNOWN_RELEVANT_ACCOUNTS[u]) {
    const entry = KNOWN_RELEVANT_ACCOUNTS[u];
    return {
      isMatch: true,
      confidence: entry.confidence || 0.98,
      reason: `Cuenta oficial reconocida en catálogo (${entry.name} · ${entry.category})`,
      category: entry.category || 'relevante',
      name: entry.name || u
    };
  }

  // Cuenta desconocida sin señales de alta confianza
  return {
    isMatch: false,
    confidence: 0.0,
    reason: '',
    category: null,
    name: null
  };
}
