// Un torneo presente nell'Albo è archiviato: resta consultabile ma non si modifica più.
// Questo controllo serve all'interfaccia; il blocco vero è nel database (sql/064).
import { db, run } from './db.js';

let cache = null;
let cacheAt = 0;
const TTL_MS = 30_000;

export async function loadArchivedSportIds({ force = false } = {}) {
  if (!force && cache && Date.now() - cacheAt < TTL_MS) return cache;
  const { data } = await run(db.from('honor_roll_entries').select('sport_id'), 'Stato archivio tornei');
  cache = new Set((data ?? []).map((row) => Number(row.sport_id)).filter(Boolean));
  cacheAt = Date.now();
  return cache;
}

export function invalidateArchivedSports() {
  cache = null;
}

export async function isSportArchived(sportId, options) {
  const id = Number(sportId);
  if (!id) return false;
  return (await loadArchivedSportIds(options)).has(id);
}

export const ARCHIVED_MESSAGE = 'Torneo archiviato: è consultabile ma non si può modificare. Per correggerlo, disarchivialo dalla sezione Albo.';

export async function assertSportNotArchived(sportId) {
  if (await isSportArchived(sportId, { force: true })) throw new Error(ARCHIVED_MESSAGE);
}
