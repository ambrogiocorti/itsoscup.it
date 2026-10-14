import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTeamSnapshot, createTeamFollowStore, detectTeamUpdates, TEAM_FOLLOW_KEY } from '../js/team-follow-store.js';
import { parseTeamRoute, teamPageUrl, teamOverview, formatPublicTeamName, renderTeamRoster, renderTeamNotices } from '../js/public-team.js';

function fixture() {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  let deviceId = 'existing-device', time = 0;
  const create = () => createTeamFollowStore({ storage: () => storage, device: () => ({ id: deviceId }), now: () => new Date(1_000 + time++).toISOString(), changed() {} });
  return { values, storage, create, device: (id) => { deviceId = id; } };
}
const match = { id: 15, home_team_id: 124, away_team_id: 125, home_score: 0, away_score: 0, status: 'scheduled', scheduled_start: '2026-11-14T10:00:00Z', scheduled_end: '2026-11-14T11:00:00Z', venue_id: 2 };
const notice = { id: 8, title: 'Avviso pubblico', body: 'Informazione di prova', created_at: '2026-10-14T08:00:00Z' };

test('canonical routes validate IDs and preserve deployment subdirectories', () => {
  assert.deepEqual(parseTeamRoute('?sport=37&team=124'), { sportId: 37, teamId: 124 });
  for (const search of ['', '?sport=37&team=-1', '?sport=0&team=4', '?sport=1.5&team=4', '?sport=NaN&team=4', '?sport=9007199254740992&team=4']) assert.equal(parseTeamRoute(search), null);
  assert.equal(teamPageUrl(37, 124, 'https://example.com/school/?venue=a&audience=captain'), 'https://example.com/school/team.html?sport=37&team=124');
});
test('next match ignores old scheduled slots, postponed and cancelled matches; includes live and unscheduled', () => {
  const cancelled = { ...match, id: 2, status: 'cancelled' }, postponed = { ...match, id: 3, operational_status: 'postponed' };
  const old = { ...match, id: 4, scheduled_start: '2025-01-01T10:00:00Z' };
  assert.equal(teamOverview(124, [old, cancelled, postponed, match], Date.parse('2026-10-14')).next.id, 15);
  assert.equal(teamOverview(124, [old], Date.parse('2026-10-14')).next, null);
  assert.equal(teamOverview(124, [{ ...match, status: 'live' }], Date.parse('2027-01-01')).next.id, 15);
});
test('privacy and escaping are applied to roster and public notices', () => {
  const players = [{ full_name: '<img> Prova Rossi', is_captain: true }];
  assert.equal(renderTeamRoster(players, { player_name: 'hidden' }), '<span>Rosa non pubblica.</span>');
  assert.match(renderTeamRoster(players, { player_name: 'abbreviated' }), /&lt;img&gt; P\. R\./);
  assert.equal(formatPublicTeamName('4A', { player_name: 'full', show_class: false }), 'Classe');
  const html = renderTeamNotices([{ ...notice, title: '<script>test</script>', body: '<img src=x>' }]);
  assert(!html.includes('<script>')); assert(!html.includes('<img'));
});
test('explicit consent, persistence, existing device scope, unfollow and revoke', () => {
  const f = fixture(), store = f.create();
  assert.throws(() => store.follow(37, 124), /Conferma/);
  store.follow(37, 124, { consent: true });
  assert.equal(f.create().read().favorites[0].teamId, 124);
  assert.equal(f.create().read().deviceId, 'existing-device');
  store.follow(37, 124); assert.equal(store.read().favorites.length, 1);
  f.device('different-device'); assert.equal(store.read().favorites.length, 0);
  f.device('existing-device'); store.unfollow(37, 124); assert.equal(store.read().favorites.length, 0);
  store.clear(); assert(!f.values.has(TEAM_FOLLOW_KEY));
});
test('changes after baseline produce deduplicated results, schedules, postponements and notices; read state persists', async () => {
  const f = fixture(), store = f.create(); store.follow(37, 124, { consent: true });
  let record = await store.observe(37, 124, [match], [notice]); assert.equal(record.updates.length, 0);
  const finished = { ...match, is_finished: true, status: 'finished', home_score: 2, away_score: 1 };
  record = await store.observe(37, 124, [finished], [notice]); assert.equal(record.updates[0].type, 'result');
  record = await store.observe(37, 124, [finished], [notice]); assert.equal(record.updates.length, 1);
  store.markRead(37, 124); assert(f.create().read().records['37.124'].updates.every((u) => u.readAt));
  record = await store.observe(37, 124, [{ ...finished, home_score: 3 }], [{ ...notice, body: 'Avviso modificato' }]);
  assert.equal(record.updates.filter((u) => !u.readAt).length, 2);
  assert(record.updates.some((u) => u.type === 'notice'));
  record = await store.observe(37, 124, [{ ...finished, home_score: 3, scheduled_start: null, operational_status: 'postponed' }], [{ ...notice, body: 'Avviso modificato' }]);
  assert.equal(record.updates.filter((u) => u.type === 'status').length, 1);
  assert.equal(record.updates.filter((u) => u.type === 'schedule').length, 0);
  assert(!f.values.get(TEAM_FOLLOW_KEY).includes('Avviso modificato'));
});
test('notice outages preserve baseline; withdrawn public notices are not retained; live goals do not spam', async () => {
  const f = fixture(), store = f.create(); store.follow(37, 124, { consent: true });
  await store.observe(37, 124, [match], [notice]);
  await store.observe(37, 124, [{ ...match, status: 'live', home_score: 1 }], null);
  let record = await store.observe(37, 124, [{ ...match, status: 'live', home_score: 2 }], [notice]);
  assert.equal(record.updates.length, 0);
  record = await store.observe(37, 124, [match], [{ ...notice, title: 'Nuovo avviso' }]); assert.equal(record.updates.length, 1);
  record = await store.observe(37, 124, [match], []); assert.equal(record.updates.length, 0);
});
test('schedule changes and newly assigned matches are recognized without repeat polling duplicates', async () => {
  const previous = await buildTeamSnapshot([match], []);
  const snapshot = await buildTeamSnapshot([{ ...match, scheduled_end: '2026-11-14T12:00:00Z', venue_id: 3 }, { ...match, id: 16 }], []);
  assert.deepEqual(detectTeamUpdates(previous, snapshot, 'now').map((u) => u.type), ['schedule', 'calendar']);
  assert.deepEqual(detectTeamUpdates(snapshot, snapshot, 'later'), []);
});
test('corrupt, denied and quota-limited storage never claims a saved follow', () => {
  const f = fixture(); f.values.set(TEAM_FOLLOW_KEY, '{broken'); assert.equal(f.create().read().available, false);
  const denied = createTeamFollowStore({ storage() { throw new Error('SecurityError'); } }); assert.equal(denied.read().available, false);
  assert.throws(() => denied.follow(37, 124, { consent: true }), /non disponibili/);
  const quota = createTeamFollowStore({ storage: () => ({ getItem: () => null, setItem() { throw new Error('QuotaExceededError'); } }), device: () => ({ id: 'existing-device' }), changed() {} });
  assert.throws(() => quota.follow(37, 124, { consent: true }), /non permette di salvare/);
});
test('unchanged polls never rewrite storage and cannot trigger a cross-tab refresh loop', async () => {
  const f = fixture(); let writes = 0;
  const set = f.storage.setItem;
  f.storage.setItem = (key, value) => { writes++; set(key, value); };
  const store = f.create(); store.follow(37, 124, { consent: true });
  await store.observe(37, 124, [match], [notice]);
  const afterBaseline = writes;
  await store.observe(37, 124, [match], [notice]);
  await f.create().observe(37, 124, [match], [notice]);
  assert.equal(writes, afterBaseline);
});
