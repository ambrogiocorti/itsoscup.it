import {
  enqueueOfflineOperation,
  getLiveCacheEntry,
  getOfflineStorageSummary,
  listLiveCacheEntries,
  listOfflineOperations,
  putLiveCacheEntry,
  putMeta,
  updateOfflineOperation,
} from './offline-db.js';

const LIVE_CACHE_PREFIX = 'tornei_live_cache_';
const OFFLINE_MANIFEST_KEY = 'tornei_offline_manifest';

function safeReadJson(key, fallback = null) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_error) {
    return fallback;
  }
}

function safeWriteJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (_error) {
    return false;
  }
}

export function getLiveCacheKey(matchId) {
  return `${LIVE_CACHE_PREFIX}${Number(matchId)}`;
}

export function saveLiveMatchCache(matchId, liveData, { stats = [], source = 'online' } = {}) {
  if (!Number(matchId) || !liveData?.match) return false;
  const entry = buildLiveCacheEntry(matchId, liveData, { stats, source });

  const written = safeWriteJson(getLiveCacheKey(matchId), entry);
  if (written) {
    writeManifestEntry(matchId, liveData, entry);
  }
  putLiveCacheEntry(entry).catch(() => undefined);
  return written;
}

function buildLiveCacheEntry(matchId, liveData, { stats = [], source = 'online' } = {}) {
  return {
    id: Number(matchId),
    version: 2,
    match_id: Number(matchId),
    cached_at: new Date().toISOString(),
    source,
    match: liveData.match,
    config: liveData.config ?? {},
    homePlayers: liveData.homePlayers ?? [],
    awayPlayers: liveData.awayPlayers ?? [],
    stats,
  };
}

function buildManifestEntry(matchId, liveData, entry) {
  return {
    match_id: Number(matchId),
    label: `${liveData.match.home?.name ?? 'Casa'} vs ${liveData.match.away?.name ?? 'Ospite'}`,
    sport: liveData.match.sport?.name ?? null,
    scheduled_start: liveData.match.scheduled_start ?? null,
    cached_at: entry.cached_at,
    source: entry.source,
  };
}

function writeManifestEntry(matchId, liveData, entry) {
  const manifest = safeReadJson(OFFLINE_MANIFEST_KEY, { matches: {} }) ?? { matches: {} };
  manifest.matches[String(matchId)] = buildManifestEntry(matchId, liveData, entry);
  safeWriteJson(OFFLINE_MANIFEST_KEY, manifest);
  putMeta(OFFLINE_MANIFEST_KEY, manifest).catch(() => undefined);
  return manifest;
}

export async function saveLiveMatchCacheAsync(matchId, liveData, { stats = [], source = 'online' } = {}) {
  if (!Number(matchId) || !liveData?.match) return false;
  const entry = buildLiveCacheEntry(matchId, liveData, { stats, source });
  safeWriteJson(getLiveCacheKey(matchId), entry);
  writeManifestEntry(matchId, liveData, entry);
  await putLiveCacheEntry(entry);
  return true;
}

export function loadLiveMatchCache(matchId) {
  return safeReadJson(getLiveCacheKey(matchId), null);
}

export async function loadLiveMatchCacheAsync(matchId) {
  const id = Number(matchId);
  if (!id) return null;
  try {
    const entry = await getLiveCacheEntry(id);
    if (entry?.match) return entry;
  } catch (_error) {
    // Fall back to the legacy cache below.
  }
  return loadLiveMatchCache(id);
}

export function getOfflineManifest() {
  return safeReadJson(OFFLINE_MANIFEST_KEY, { matches: {} }) ?? { matches: {} };
}

export async function getOfflineManifestAsync() {
  try {
    const entries = await listLiveCacheEntries();
    if (entries.length) {
      return {
        matches: Object.fromEntries(
          entries.map((entry) => [
            String(entry.match_id),
            {
              match_id: Number(entry.match_id),
              label: `${entry.match?.home?.name ?? 'Casa'} vs ${entry.match?.away?.name ?? 'Ospite'}`,
              sport: entry.match?.sport?.name ?? null,
              scheduled_start: entry.match?.scheduled_start ?? null,
              cached_at: entry.cached_at,
              source: entry.source,
            },
          ])
        ),
      };
    }
  } catch (_error) {
    // Fall back to the legacy cache below.
  }
  return getOfflineManifest();
}

export function countCachedMatches() {
  return Object.keys(getOfflineManifest().matches ?? {}).length;
}

export async function countCachedMatchesAsync() {
  try {
    const summary = await getOfflineStorageSummary();
    if (Number.isFinite(summary.liveCacheCount)) return summary.liveCacheCount;
  } catch (_error) {
    // Fall back to the legacy cache below.
  }
  return countCachedMatches();
}

export async function queueLiveSnapshotOperation(matchId, payload, { reason = 'Salvataggio live offline' } = {}) {
  if (!Number(matchId)) return null;
  return enqueueOfflineOperation({
    type: 'live_snapshot',
    matchId: Number(matchId),
    payload,
    summary: reason,
  });
}

export async function markQueuedLiveOperationsForMatch(matchId, status, lastError = null) {
  const rows = await listOfflineOperations({ status: 'queued' });
  const targetRows = rows.filter(
    (operation) =>
      operation.type === 'live_snapshot' &&
      Number(operation.match_id) === Number(matchId)
  );
  await Promise.all(
    targetRows.map((operation) =>
      updateOfflineOperation(operation.id, {
        status,
        last_error: lastError,
        attempts: Number(operation.attempts ?? 0) + 1,
      })
    )
  );
  return targetRows.length;
}

export { getOfflineStorageSummary };
