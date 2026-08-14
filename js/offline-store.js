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
  const entry = {
    version: 1,
    match_id: Number(matchId),
    cached_at: new Date().toISOString(),
    source,
    match: liveData.match,
    config: liveData.config ?? {},
    homePlayers: liveData.homePlayers ?? [],
    awayPlayers: liveData.awayPlayers ?? [],
    stats,
  };

  const written = safeWriteJson(getLiveCacheKey(matchId), entry);
  if (written) {
    const manifest = safeReadJson(OFFLINE_MANIFEST_KEY, { matches: {} }) ?? { matches: {} };
    manifest.matches[String(matchId)] = {
      match_id: Number(matchId),
      label: `${liveData.match.home?.name ?? 'Casa'} vs ${liveData.match.away?.name ?? 'Ospite'}`,
      sport: liveData.match.sport?.name ?? null,
      scheduled_start: liveData.match.scheduled_start ?? null,
      cached_at: entry.cached_at,
      source,
    };
    safeWriteJson(OFFLINE_MANIFEST_KEY, manifest);
  }
  return written;
}

export function loadLiveMatchCache(matchId) {
  return safeReadJson(getLiveCacheKey(matchId), null);
}

export function getOfflineManifest() {
  return safeReadJson(OFFLINE_MANIFEST_KEY, { matches: {} }) ?? { matches: {} };
}

export function countCachedMatches() {
  return Object.keys(getOfflineManifest().matches ?? {}).length;
}

