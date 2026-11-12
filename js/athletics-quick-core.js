// Logica pura dell'inserimento rapido di atletica (senza DOM né database), coperta dai test.

/**
 * Converte quanto scritto dall'operatore in un numero.
 * Accetta la virgola decimale e, per i tempi, anche minuti e secondi: "1:02,35" → 62.35.
 * @returns {number|null} null se il valore non è valido
 */
export function parseAthleticsValue(raw) {
  const text = String(raw ?? '').trim().replace(/\s+/g, '').replace(/,/g, '.');
  if (!text) return null;
  let value;
  const clock = text.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/);
  if (clock) {
    const seconds = Number(clock[2]);
    if (seconds >= 60) return null;
    value = Number(clock[1]) * 60 + seconds;
  } else if (/^\d+(\.\d+)?$/.test(text)) {
    value = Number(text);
  } else {
    return null;
  }
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 1000) / 1000;
}

export function bestAttempt(values = [], order = 'desc') {
  const valid = values.map(Number).filter((v) => Number.isFinite(v) && v > 0);
  if (!valid.length) return null;
  return order === 'asc' ? Math.min(...valid) : Math.max(...valid);
}

export function attemptsOf(row) {
  if (!row) return [];
  const list = Array.isArray(row.attempt_values) ? row.attempt_values.map(Number).filter((v) => Number.isFinite(v)) : [];
  if (list.length) return list;
  const value = Number(row.value);
  return Number.isFinite(value) && value > 0 ? [value] : [];
}

export const UNIT_LABELS = { time: 'Tempo', distance: 'Distanza', points: 'Punteggio' };
export const UNIT_SUFFIX = { time: 's', distance: 'm', points: 'pt' };

export function formatAthleticsValue(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (unit === 'time' && n >= 60) {
    const minutes = Math.floor(n / 60);
    const seconds = (n - minutes * 60).toFixed(2).padStart(5, '0');
    return `${minutes}:${seconds.replace('.', ',')}`;
  }
  const digits = Number.isInteger(n) ? 0 : 2;
  return `${n.toFixed(digits).replace('.', ',')}${UNIT_SUFFIX[unit] ? ' ' + UNIT_SUFFIX[unit] : ''}`;
}

/**
 * Prepara il nuovo stato del risultato con un tentativo in più, rispettando i limiti del torneo.
 * @throws Error con un messaggio per l'operatore se un limite è superato
 */
export function buildNextResult({ existing = null, value, order = 'desc', attemptsLimit = 1, eventsWithResults = 0, maxEvents = 99 }) {
  const previous = attemptsOf(existing);
  if (!existing && eventsWithResults >= maxEvents) {
    throw new Error(`Limite di ${maxEvents} eventi per atleta raggiunto.`);
  }
  if (previous.length >= attemptsLimit) {
    throw new Error(`Tentativi esauriti (${attemptsLimit} per evento).`);
  }
  const attempts = [...previous, value];
  return { attempt_values: attempts, attempt_count: attempts.length, value: bestAttempt(attempts, order) };
}

export function initials(name) {
  return String(name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0] ?? '').join('').toUpperCase() || '?';
}
