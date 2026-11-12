import { getDeviceInfo } from './device.js';

export const TEAM_FOLLOW_KEY = 'tornei_team_follows_v1';
const MAX_TEAMS = 20;
const MAX_UPDATES = 60;
const positiveId = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
export const teamFollowId = (sportId, teamId) => `${positiveId(sportId)}.${positiveId(teamId)}`;
const emptyState = () => ({ version: 1, deviceId: null, consentAt: null, favorites: [], records: {} });

// Snapshots deliberately contain no student names, roster, notice text or class access codes.
export async function buildTeamSnapshot(matches = [], notices = null) {
  const matchRows = Object.fromEntries(matches.slice(0, 500).filter((m) => positiveId(m.id)).map((m) => [String(m.id), {
    schedule: JSON.stringify([m.scheduled_start || null, m.scheduled_end || null, m.venue_id || m.venue?.id || null]),
    disruption: ['cancelled', 'postponed', 'paused'].includes(m.operational_status) ? m.operational_status : ['cancelled', 'postponed'].includes(m.status) ? m.status : '',
    result: m.is_finished ? JSON.stringify([Number(m.home_score || 0), Number(m.away_score || 0)]) : null,
  }]));
  let noticeRows = null;
  if (Array.isArray(notices)) {
    noticeRows = Object.fromEntries(await Promise.all(notices.slice(0, 30).filter((n) => positiveId(n.id)).map(async (n) => {
      const bytes = new TextEncoder().encode(JSON.stringify([n.title || '', n.body || '', n.created_at || '']));
      const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
      return [String(n.id), Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')];
    })));
  }
  return { matches: matchRows, notices: noticeRows };
}

export function detectTeamUpdates(previous, snapshot, now) {
  if (!previous) return [];
  const updates = [];
  const add = (type, subjectId, fingerprint) => updates.push({
    id: `${type}:${subjectId}:${fingerprint}`, type, subjectId: Number(subjectId), at: now, readAt: null,
  });
  for (const [id, current] of Object.entries(snapshot.matches)) {
    const old = previous.matches?.[id];
    if (!old) {
      add(current.result ? 'result' : 'calendar', id, current.result || current.schedule);
      continue;
    }
    if (current.result !== old.result) add('result', id, current.result || 'withdrawn');
    if (current.disruption !== old.disruption) add('status', id, current.disruption || 'resumed');
    // A postponement and its simultaneous date change are one update.
    if (current.schedule !== old.schedule && current.disruption === old.disruption) add('schedule', id, current.schedule);
  }
  if (snapshot.notices && previous.notices) {
    for (const [id, digest] of Object.entries(snapshot.notices)) {
      if (previous.notices[id] !== digest) add('notice', id, digest);
    }
  }
  return updates;
}

export function createTeamFollowStore({ storage = () => window.localStorage, device = getDeviceInfo, now = () => new Date().toISOString(), changed = () => window.dispatchEvent(new Event('team-follows-changed')) } = {}) {
  function read() {
    let raw = null;
    try {
      raw = storage().getItem(TEAM_FOLLOW_KEY);
      if (!raw) return { ...emptyState(), available: true };
      if (raw.length > 500_000) throw new Error('Preferenze locali troppo grandi.');
      const data = JSON.parse(raw);
      if (data.version !== 1 || !data.consentAt || data.deviceId !== device().id || !Array.isArray(data.favorites)) return { ...emptyState(), available: true };
      const favorites = data.favorites.slice(0, MAX_TEAMS).filter((f) => positiveId(f.sportId) && positiveId(f.teamId)).map((f) => ({ sportId: Number(f.sportId), teamId: Number(f.teamId), followedAt: String(f.followedAt || '') }));
      const records = {};
      for (const f of favorites) {
        const key = teamFollowId(f.sportId, f.teamId);
        const record = data.records?.[key];
        if (record && typeof record === 'object') records[key] = { snapshot: record.snapshot || null, checkedAt: record.checkedAt || null, updates: Array.isArray(record.updates) ? record.updates.filter((u) => ['result', 'calendar', 'schedule', 'status', 'notice'].includes(u.type) && positiveId(u.subjectId) && typeof u.id === 'string').slice(0, MAX_UPDATES) : [] };
      }
      return { version: 1, deviceId: data.deviceId, consentAt: data.consentAt, favorites, records, available: true };
    } catch (_error) {
      return { ...emptyState(), available: false, corrupt: Boolean(raw) };
    }
  }
  function save(data, notify = true) {
    try {
      const { available, ...payload } = data;
      storage().setItem(TEAM_FOLLOW_KEY, JSON.stringify(payload));
      if (notify) changed();
    } catch (_error) {
      throw new Error('Il browser non permette di salvare le preferenze. Abilita l’archiviazione locale per seguire una squadra.');
    }
  }
  function follow(sportId, teamId, { consent = false } = {}) {
    const sid = positiveId(sportId), tid = positiveId(teamId);
    if (!sid || !tid) throw new Error('Squadra non valida.');
    const data = read();
    if (!data.available) throw new Error('Preferenze locali non disponibili. Controlla le impostazioni del browser.');
    if (!data.consentAt && !consent) throw new Error('Conferma il salvataggio locale dei preferiti.');
    if (data.favorites.some((f) => f.sportId === sid && f.teamId === tid)) return;
    if (data.favorites.length >= MAX_TEAMS) throw new Error('Puoi seguire fino a 20 squadre. Rimuovine una prima di aggiungerne altre.');
    try { data.deviceId = device().id; } catch (_error) { throw new Error('Il browser non permette di salvare il dispositivo. Le preferenze non sono state salvate.'); }
    data.consentAt ||= now();
    data.favorites.push({ sportId: sid, teamId: tid, followedAt: now() });
    save(data);
  }
  function unfollow(sportId, teamId) {
    const data = read(), key = teamFollowId(sportId, teamId);
    if (!data.available) throw new Error('Preferenze locali non disponibili.');
    data.favorites = data.favorites.filter((f) => teamFollowId(f.sportId, f.teamId) !== key);
    delete data.records[key];
    save(data);
  }
  async function observe(sportId, teamId, matches, notices) {
    const initial = read(), followKey = teamFollowId(sportId, teamId);
    if (!initial.available || !initial.favorites.some((f) => teamFollowId(f.sportId, f.teamId) === followKey)) return null;
    const snapshot = await buildTeamSnapshot(matches, notices);
    // Read again after hashing so other tab changes are respected.
    const data = read(), key = teamFollowId(sportId, teamId);
    if (!data.available || !data.favorites.some((f) => teamFollowId(f.sportId, f.teamId) === key)) return null;
    const old = data.records[key];
    const updates = detectTeamUpdates(old?.snapshot, snapshot, now());
    const byId = new Map((old?.updates || []).map((u) => [u.id, u]));
    // Coalesce changes that have not been read: one notification per subject and kind.
    for (const update of updates) {
      for (const [id, value] of byId) if (!value.readAt && value.subjectId === update.subjectId && value.type === update.type) byId.delete(id);
      byId.set(update.id, update);
    }
    if (snapshot.notices) for (const [id, update] of byId) if (update.type === 'notice' && !snapshot.notices[String(update.subjectId)]) byId.delete(id);
    data.records[key] = { checkedAt: now(), snapshot: { ...snapshot, notices: snapshot.notices ?? old?.snapshot?.notices ?? null }, updates: [...byId.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_UPDATES) };
    // Unchanged polls must not write: another open tab would receive a storage
    // event and start a write/refresh loop. Keep the check time in memory instead.
    if (old && JSON.stringify(old.snapshot) === JSON.stringify(data.records[key].snapshot) && JSON.stringify(old.updates) === JSON.stringify(data.records[key].updates)) return data.records[key];
    save(data, false);
    return data.records[key];
  }
  function markRead(sportId, teamId, ids = null) {
    const data = read(), record = data.records[teamFollowId(sportId, teamId)];
    if (!record) return;
    for (const u of record.updates) if (!ids || ids.includes(u.id)) u.readAt ||= now();
    save(data);
  }
  function clear() {
    try { storage().removeItem(TEAM_FOLLOW_KEY); changed(); }
    catch (_error) { throw new Error('Impossibile cancellare le preferenze locali.'); }
  }
  return { read, follow, unfollow, observe, markRead, clear };
}

export const teamFollowStore = createTeamFollowStore();
