import { TEAM_FOLLOW_KEY, teamFollowId, teamFollowStore } from './team-follow-store.js';
import { formatPublicTeamName, loadPublicTeam, loadPublicTournament, teamPageUrl, teamMatchScore, teamMatchStatus } from './public-team.js';
import { escapeHtml, formatDateTime, showAppConfirm, showToast } from './utils.js';
import { formatScheduleRange } from './schedule.js';

export function renderFollowUpdates(bundle, record) {
  const updates = (record?.updates || []).filter((u) => u.type !== 'notice' || bundle.notices?.some((n) => Number(n.id) === u.subjectId));
  const unread = updates.filter((u) => !u.readAt).length;
  if (!updates.length) return '<p class="follow-helper">Nessuna novità dal primo controllo. Gli aggiornamenti compaiono quando torni sul sito.</p>';
  return `<details class="follow-updates"><summary>Aggiornamenti <span class="follow-count">${unread ? `${unread} ${unread === 1 ? 'nuovo' : 'nuovi'}` : 'Tutti letti'}</span></summary>${updates.length > 12 ? `<p class="follow-helper">Ultimi 12 aggiornamenti di ${updates.length} conservati.</p>` : ''}<div class="follow-update-list">${updates.slice(0, 12).map((u) => {
    const match = bundle.overview.matches.find((m) => Number(m.id) === u.subjectId);
    const notice = bundle.notices?.find((n) => Number(n.id) === u.subjectId);
    const titles = { result: match?.is_finished ? `Risultato: ${teamMatchScore(match)}` : 'Risultato corretto: partita riaperta', calendar: 'Nuova partita in calendario', schedule: 'Orario o campo aggiornato', status: match ? `Partita ${teamMatchStatus(match).toLocaleLowerCase('it')}` : 'Stato partita aggiornato', notice: notice?.title || 'Avviso pubblico aggiornato' };
    const body = u.type === 'notice' ? notice?.body || '' : match ? `${formatPublicTeamName(match.home?.name, bundle.privacy)} vs ${formatPublicTeamName(match.away?.name, bundle.privacy)} · ${formatScheduleRange(match)} · ${match.venue?.name || 'Campo da definire'}` : 'Consulta il calendario della squadra.';
    return `<article class="follow-update ${u.readAt ? 'is-read' : 'is-unread'}"><div><strong>${escapeHtml(titles[u.type])}</strong><p>${escapeHtml(body)}</p><small>${escapeHtml(formatDateTime(u.at))} · ${u.readAt ? 'Letto' : 'Nuovo'}</small></div>${!u.readAt ? `<button type="button" class="btn btn-ghost btn-compact" data-read-update="${escapeHtml(u.id)}" aria-label="Segna letto: ${escapeHtml(titles[u.type])}">Letto</button>` : ''}</article>`;
  }).join('')}</div>${unread ? '<button type="button" class="btn btn-ghost btn-compact" data-read-all>Segna tutti come letti</button>' : ''}</details>`;
}

export function bindFollowReadActions(container, bundle, onChange) {
  container.querySelectorAll('[data-read-update], [data-read-all]').forEach((button) => button.addEventListener('click', () => {
    try { teamFollowStore.markRead(bundle.sportId, bundle.teamId, button.hasAttribute('data-read-all') ? null : [button.dataset.readUpdate]); onChange?.(); }
    catch (error) { showToast(error.message, 'error'); }
  }));
}

export async function toggleTeamFollow(bundle) {
  const data = teamFollowStore.read();
  const followed = data.favorites.some((f) => f.sportId === bundle.sportId && f.teamId === bundle.teamId);
  if (followed) {
    teamFollowStore.unfollow(bundle.sportId, bundle.teamId);
    showToast('Squadra rimossa da Le mie squadre.', 'success');
    return false;
  }
  if (!data.available) throw new Error('Preferenze locali non disponibili. Abilita l’archiviazione nel browser.');
  if (!data.consentAt) {
    const consent = await showAppConfirm('Salviamo le squadre seguite e gli aggiornamenti letti solo in questo browser, usando l’identificativo del dispositivo già presente. Non inviamo i preferiti al server. Puoi cancellarli da Le mie squadre. In navigazione privata potrebbero sparire alla chiusura.', { title: 'Segui le tue squadre', confirmLabel: 'Salva su questo dispositivo', cancelLabel: 'Annulla' });
    if (!consent) return false;
  }
  teamFollowStore.follow(bundle.sportId, bundle.teamId, { consent: true });
  await teamFollowStore.observe(bundle.sportId, bundle.teamId, bundle.overview.matches, bundle.notices);
  showToast('Squadra aggiunta a Le mie squadre.', 'success');
  return true;
}

function favoriteMatch(match, label, bundle) {
  if (!match) return `<div class="favorite-match"><span>${label}</span><strong>${label === 'Ultimo risultato' ? 'Nessun risultato' : 'In attesa del calendario'}</strong></div>`;
  const opponent = Number(match.home_team_id) === bundle.teamId ? match.away?.name : match.home?.name;
  return `<div class="favorite-match"><span>${label}${match.status === 'live' ? ' · In corso' : ''}</span><strong>${escapeHtml(formatPublicTeamName(opponent, bundle.privacy))}${match.is_finished || match.status === 'live' ? ` · ${escapeHtml(teamMatchScore(match))}` : ''}</strong><small>${escapeHtml(formatScheduleRange(match))} · ${escapeHtml(match.venue?.name || 'Campo da definire')}</small></div>`;
}

export function initMyTeams() {
  const target = document.getElementById('my-teams-content');
  if (!target) return { refresh: async () => {} };
  let busy = false, pending = false;
  async function refresh() {
    if (busy) { pending = true; return; }
    busy = true;
    try {
      const data = teamFollowStore.read();
      const count = document.getElementById('my-teams-unread');
      if (!data.favorites.length) {
        if (count) count.hidden = true;
        target.innerHTML = `<div class="my-teams-empty"><span class="my-teams-empty-star" aria-hidden="true">☆</span><div><strong>Nessuna squadra seguita</strong>${!data.available ? '<p>Preferenze locali non disponibili. Puoi comunque consultare tutte le squadre.</p>' : ''}<a href="#sport-select">Scegli un torneo</a></div></div>`;
        document.getElementById('my-teams-clear').hidden = !data.consentAt && !data.corrupt;
        return;
      }
      document.getElementById('my-teams-clear').hidden = false;
      const tournaments = new Map();
      const results = await Promise.allSettled(data.favorites.map(async (f) => {
        if (!tournaments.has(f.sportId)) tournaments.set(f.sportId, loadPublicTournament(f.sportId));
        const bundle = await loadPublicTeam(f.sportId, f.teamId, { tournament: await tournaments.get(f.sportId) });
        let record;
        try { record = await teamFollowStore.observe(f.sportId, f.teamId, bundle.overview.matches, bundle.notices); }
        catch (_error) { record = teamFollowStore.read().records[teamFollowId(f.sportId, f.teamId)]; bundle.storageFailed = true; }
        return { bundle, record };
      }));
      let totalUnread = 0;
      target.innerHTML = `<div class="my-teams-grid">${results.map((result, i) => {
        const f = data.favorites[i];
        if (result.status !== 'fulfilled') return `<article class="favorite-team-card" data-favorite-key="${teamFollowId(f.sportId, f.teamId)}"><h3>Squadra non disponibile</h3><p class="follow-helper">Non è stato possibile caricare questa squadra. Riprova con Aggiorna.</p><a class="btn btn-ghost btn-compact" href="${escapeHtml(teamPageUrl(f.sportId, f.teamId))}">Apri squadra</a><button type="button" class="btn btn-ghost btn-compact" data-unfollow>Non seguire più</button></article>`;
        const { bundle, record } = result.value;
        const unread = (record?.updates || []).filter((u) => !u.readAt && (u.type !== 'notice' || bundle.notices?.some((n) => Number(n.id) === u.subjectId))).length;
        totalUnread += unread;
        return `<article class="favorite-team-card" data-favorite-key="${teamFollowId(f.sportId, f.teamId)}"><div class="favorite-team-heading"><div><span class="team-profile-kicker">${escapeHtml(bundle.sport.name)}</span><h3><a href="${escapeHtml(teamPageUrl(f.sportId, f.teamId))}">${escapeHtml(formatPublicTeamName(bundle.team.name, bundle.privacy))}</a></h3></div><button type="button" class="team-follow-btn is-following" data-unfollow aria-label="Smetti di seguire ${escapeHtml(formatPublicTeamName(bundle.team.name, bundle.privacy))}">★ <span>Seguita</span></button></div>${favoriteMatch(bundle.overview.next, 'Prossima partita', bundle)}${favoriteMatch(bundle.overview.latest, 'Ultimo risultato', bundle)}<p class="favorite-notice-summary">${bundle.notices === null ? 'Avvisi non disponibili' : `${bundle.notices.length} avvisi pubblici`}${bundle.notices?.[0] ? ` · ${escapeHtml(bundle.notices[0].title)}` : ''}</p>${bundle.storageFailed ? '<p class="follow-helper" role="status">Aggiornamenti non salvati: controlla l’archiviazione del browser.</p>' : ''}${renderFollowUpdates(bundle, record)}</article>`;
      }).join('')}</div>`;
      if (count) { count.textContent = `${totalUnread} ${totalUnread === 1 ? 'nuovo' : 'nuovi'}`; count.hidden = totalUnread === 0; }
      results.forEach((result, i) => {
        const f = data.favorites[i], card = target.querySelector(`[data-favorite-key="${teamFollowId(f.sportId, f.teamId)}"]`);
        if (!card) return;
        card.querySelector('[data-unfollow]')?.addEventListener('click', () => { try { teamFollowStore.unfollow(f.sportId, f.teamId); } catch (error) { showToast(error.message, 'error'); } });
        if (result.status === 'fulfilled') bindFollowReadActions(card, result.value.bundle, refresh);
      });
      const checked = document.getElementById('my-teams-checked');
      if (checked) checked.textContent = `Ultimo controllo: ${formatDateTime(new Date())}`;
    } finally { busy = false; if (pending) { pending = false; void refresh(); } }
  }
  document.getElementById('my-teams-refresh')?.addEventListener('click', () => void refresh().catch((error) => showToast(error.message, 'error')));
  document.getElementById('my-teams-clear')?.addEventListener('click', async () => {
    if (await showAppConfirm('Rimuovere tutte le squadre seguite e gli aggiornamenti salvati in questo browser?', { title: 'Cancella preferiti', confirmLabel: 'Cancella' })) {
      try { teamFollowStore.clear(); } catch (error) { showToast(error.message, 'error'); }
    }
  });
  const refreshVisible = () => { if (!document.hidden) void refresh().catch(() => {}); };
  window.addEventListener('team-follows-changed', refreshVisible);
  window.addEventListener('storage', (event) => { if ([TEAM_FOLLOW_KEY, 'tornei_device_id', null].includes(event.key)) refreshVisible(); });
  window.addEventListener('online', refreshVisible);
  document.addEventListener('visibilitychange', refreshVisible);
  let timer = window.setInterval(refreshVisible, 60_000);
  window.addEventListener('pagehide', () => window.clearInterval(timer));
  window.addEventListener('pageshow', (event) => { if (event.persisted) { timer = window.setInterval(refreshVisible, 60_000); refreshVisible(); } });
  void refresh().catch((error) => { target.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`; });
  return { refresh };
}
