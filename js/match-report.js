/** Shared, offline-safe match sheet for the central platform and ITSOSCup Key. */
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const sameId = (left, right) => left != null && right != null && String(left) === String(right);
const dateTime = (value) => {
  if (!value || Number.isNaN(new Date(value).getTime())) return 'Da definire';
  return new Intl.DateTimeFormat('it-IT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Rome' }).format(new Date(value));
};
const duration = (value) => `${Math.floor(number(value) / 60)}:${String(Math.floor(number(value) % 60)).padStart(2, '0')}`;
const eventLabels = { score: 'Punto / rete', presence: 'Presenza', foul: 'Fallo', yellow_card: 'Giallo', red_card: 'Rosso', timeout: 'Timeout', substitution: 'Sostituzione', period: 'Periodo / set', note: 'Nota', timer_start: 'Avvio cronometro', timer_stop: 'Pausa cronometro', timer_set: 'Correzione tempo' };
const staffLabels = [['referee', 'Arbitro'], ['scorekeeper', 'Segnapunti'], ['field_manager', 'Responsabile campo'], ['supervisor', 'Docente supervisore']];

export const MATCH_REPORT_CSS = `
@page { size: A4 portrait; margin: 10mm; }
.match-report, .match-report * { box-sizing: border-box; }
.match-report { color: #1e293b; font: 10px/1.35 Inter, "Segoe UI", Arial, sans-serif; max-width: 190mm; margin: 0 auto 24px; background: #fff; }
.match-report-sheet { display: flex; flex-direction: column; gap: 3.5mm; padding: 7mm; border: 1px solid #cbd5e1; margin-bottom: 16px; min-height: 275mm; }
.match-report h1, .match-report h2, .match-report h3, .match-report p { margin: 0; line-height: 1.3; }
.match-report h1 { font-size: 22px; font-weight: 750; letter-spacing: -.025em; }
.match-report h2 { font-size: 13px; font-weight: 750; }
.match-report h3 { font-size: 12px; font-weight: 750; }
.match-report-brand { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; border-bottom: 2px solid #0f172a; padding-bottom: 3mm; }
.match-report-brand strong { font-size: 21px; letter-spacing: -.04em; color: #0f172a; }
.match-report-brand strong span { color: #2563eb; }
.match-report-kicker { text-transform: uppercase; letter-spacing: .08em; font-size: 8px; font-weight: 700; color: #64748b; }
.match-report-heading { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 5mm; }
.match-report-heading p { margin-top: 1.5mm; color: #475569; }
.match-report-score { min-width: 29mm; border: 1px solid #0f172a; border-radius: 8px; padding: 2mm 4mm; font-size: 28px; font-weight: 750; text-align: center; white-space: nowrap; }
.match-report-score small { display: block; font-size: 8px; font-weight: 500; text-transform: uppercase; letter-spacing: .04em; }
.match-report-meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2mm 4mm; padding: 3mm; border: 1px solid #cbd5e1; border-radius: 6px; }
.match-report-meta div { min-width: 0; overflow-wrap: anywhere; }
.match-report-meta span, .match-report-staff span { display: block; font-size: 8px; color: #64748b; text-transform: uppercase; letter-spacing: .03em; margin-bottom: 1mm; }
.match-report-meta strong { font-size: 10px; font-weight: 650; }
.match-report-staff { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; padding-bottom: 2mm; border-bottom: 1px solid #cbd5e1; }
.match-report-staff div { min-width: 0; overflow-wrap: anywhere; }
.match-report-staff strong { font-size: 9px; font-weight: 600; }
.match-report-rosters { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; align-items: start; }
.match-report-team { min-width: 0; }
.match-report-team h2 { padding: 2.5mm 2mm; background: #0f172a; color: #fff; border-radius: 5px 5px 0 0; }
.match-report table { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 0; }
.match-report th, .match-report td { padding: 1.5mm 1mm; border: 1px solid #cbd5e1; vertical-align: top; text-align: left; overflow-wrap: anywhere; line-height: 1.3; height: auto; }
.match-report th { background: #f1f5f9; color: #334155; font-size: 8px; font-weight: 700; }
.match-report td { font-size: 9px; font-weight: 400; }
.match-report tbody tr:nth-child(even) { background: #f8fafc; }
.match-report .report-stat { width: 9mm; text-align: center; font-variant-numeric: tabular-nums; }
.match-report .report-presence { width: 8mm; }
.match-report .report-name { width: auto; }
.match-report .report-captain { font-weight: 750; }
.match-report-mvp { color: #000 !important; font: 12px/1 "Segoe UI Symbol", Arial, sans-serif; white-space: nowrap; }
.match-report-legend { font-size: 8px; color: #475569; }
.match-report-note { border-left: 3px solid #2563eb; padding: 2mm 3mm; background: #eff6ff; overflow-wrap: anywhere; white-space: pre-line; }
.match-report-note strong { display: inline; }
.match-report-continuation { display: flex; align-items: center; justify-content: space-between; gap: 3mm; border-bottom: 1px solid #0f172a; padding-bottom: 2mm; font-size: 10px; }
.match-report-chronology { min-width: 0; }
.match-report-chronology h2 { margin-bottom: 2mm; }
.match-report-chronology + .match-report-signatures { margin-top:0; }
.match-report-chronology th, .match-report-chronology td { font-size: 8px; padding: 1mm 1.5mm; }
.match-report-chronology .report-minute { width: 13mm; }
.match-report-chronology .report-result { width: 15mm; text-align: center; font-variant-numeric: tabular-nums; }
.match-report-chronology .report-event { width: 31mm; }
.match-report-chronology .report-actor { width: 49mm; }
.match-report-empty { padding: 4mm 3mm; border: 1px solid #cbd5e1; color: #475569; }
.match-report-summary-note { font-size: 8px; margin-bottom: 2mm !important; color: #475569; }
.match-report-signatures { break-inside: avoid; }
.match-report-signatures h2 { margin-bottom: 2mm; }
.match-report-signature-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; }
.match-report-signature { padding: 3mm; border: 1px solid #cbd5e1; border-radius: 5px; min-height: 29mm; min-width: 0; }
.match-report-signature strong, .match-report-signature span, .match-report-signature small { display: block; overflow-wrap: anywhere; }
.match-report-signature strong { font-size: 10px; }
.match-report-signature span { margin-top: .5mm; font-size: 9px; }
.match-report-signature small { color: #64748b; font-size: 7px; }
.match-report-signature img { display: block; width: 100%; height: 15mm; max-height: 15mm; object-fit: contain; object-position: left center; margin: 1mm 0; }
.match-report-signature-line { display: block; height: 16mm; border-bottom: 1px solid #94a3b8; margin-bottom: 1mm; }
.match-report-confirmation { font-size: 8px; color: #475569; margin-top: 2mm !important; }
.match-report-notes h2 { margin-bottom: 1mm; }
.match-report-notes p { font-size: 9px; white-space: pre-line; overflow-wrap: anywhere; }
.match-report-identity { border-top: 1px solid #cbd5e1; padding-top: 2mm; font-size: 8px; color: #475569; overflow-wrap: anywhere; }
.match-report-identity code { font: 7px/1.3 ui-monospace, Consolas, monospace; }
.match-report-footer { display: flex; justify-content: space-between; align-items: end; gap: 5mm; margin-top: auto; border-top: 1px solid #cbd5e1; padding-top: 2mm; color: #64748b; font-size: 8px; }
.match-report-full-log { padding: 4mm; border: 1px solid #cbd5e1; font-size: 11px; }
.match-report-full-log summary { cursor: pointer; font-weight: 650; margin-bottom: 2mm; }
.match-report-dense td { font-size: 8px; }
.match-report-dense .match-report-team td { padding: 1mm; }
@media (max-width: 640px) { .match-report-sheet { padding: 4mm; min-height: 0; } .match-report-rosters { grid-template-columns: 1fr; } .match-report-staff { grid-template-columns: 1fr 1fr; } .match-report-meta { grid-template-columns: 1fr 1fr; } .match-report-heading { grid-template-columns: 1fr; } .match-report-score { width: fit-content; } .match-report-chronology { overflow-x: auto; } .match-report-chronology table { min-width: 150mm; } }
@media print {
  .match-report { width: 190mm; max-width: none; margin: 0; background: #fff; color: #111827; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  .match-report-sheet { padding: 0; border: 0; margin: 0; min-height: 275mm; break-after: page; page-break-after: always; }
  .match-report:last-child .match-report-sheet:last-of-type { break-after: auto; page-break-after: auto; }
  .match-report-rosters { grid-template-columns: 1fr 1fr; }
  .match-report-heading { grid-template-columns: 1fr auto; }
  .match-report-meta { grid-template-columns: repeat(3, 1fr); }
  .match-report-staff { grid-template-columns: repeat(4, 1fr); }
  .match-report th { background: #f1f5f9 !important; }
  .match-report-team h2 { background: #0f172a !important; color: #fff !important; }
  .match-report tr { break-inside: avoid; }
  .match-report thead { display: table-header-group; }
  .match-report-full-log { display: none !important; }
  .match-report-chronology { overflow: visible; }
  .match-report-chronology table { min-width: 0; }
}
`;

export function getMatchReportColumns(sport, config = {}, stats = []) {
  const type = String(sport?.sport_type || sport?.name || sport || '').toLocaleLowerCase('it-IT');
  const columns = [{ key: 'played', label: 'Pres.', className: 'report-presence' }, { key: 'points_scored', label: (type.includes('calcio')||type.includes('pallamano')) ? 'Reti' : 'Punti' }];
  if (type.includes('basket')) columns.push({ key: 'fouls', label: 'Falli' });
  else if (type.includes('calcio') || type.includes('calcetto') || type.includes('futsal') || type.includes('pallavolo') || type.includes('volley')) {
    for (const [key, label, flag] of [['yellow_cards', 'Gialli', 'allow_yellow_cards'], ['red_cards', 'Rossi', 'allow_red_cards']]) {
      if (config[flag] !== false || stats.some((row) => number(row[key]) > 0)) columns.push({ key, label });
    }
  } else {
    for (const [key, label, flag] of [['fouls', 'Falli', 'allow_fouls'], ['yellow_cards', 'Gialli', 'allow_yellow_cards'], ['red_cards', 'Rossi', 'allow_red_cards']]) {
      if (config[flag] === true || stats.some((row) => number(row[key]) > 0)) columns.push({ key, label });
    }
  }
  return columns;
}

function normalizedModel(model) {
  const match = model.match || {};
  const payload = model.payload || match.live_payload || {};
  const players = model.players || [...(model.homePlayers || []), ...(model.awayPlayers || [])];
  const stats = model.stats || payload.stats_snapshot || [];
  // Keep historical players present in a signed snapshot even if the current roster changed.
  const historical = stats.filter((stat) => !players.some((player) => sameId(player.id, stat.player_id))).map((stat) => ({ id: stat.player_id, team_id: stat.team_id, full_name: stat.player_name || `Giocatore #${stat.player_id}`, is_captain: stat.is_captain }));
  const allPlayers = [...players, ...historical];
  const staff = Array.isArray(model.staff) ? Object.fromEntries(model.staff.map((row) => [row.role, row.name])) : model.staff || payload.staff || {};
  const events = Array.isArray(model.eventLog) ? model.eventLog : Array.isArray(payload.event_log) ? payload.event_log : [];
  const signatures = model.signatures || [];
  const columns = getMatchReportColumns(match.sport, model.config, stats);
  return { ...model, match, payload, players: allPlayers, stats, staff, events, signatures, columns, mode: model.mode || (match.is_finished ? 'final' : 'draft') };
}

function teamRows(model, side) {
  const teamId = model.match[`${side}_team_id`] ?? model.match[side]?.id;
  const explicit = model[`${side}Players`];
  const source = explicit || model.players.filter((player) => sameId(player.team_id, teamId));
  const historical = model.players.filter((player) => sameId(player.team_id, teamId) && !source.some((row) => sameId(row.id, player.id)));
  return [...source, ...historical].map((player) => {
    const stat = model.stats.find((row) => sameId(row.player_id, player.id)) || {};
    const signedCaptain = model.signatures.find((signature) => signature.team_side === side && signature.player_id != null);
    return { ...stat, player_id: player.id, full_name: stat.player_name || player.full_name || `Giocatore #${player.id}`, is_captain: signedCaptain ? sameId(signedCaptain.player_id, player.id) : Boolean(player.is_captain) };
  });
}

function renderRoster(model, side) {
  const rows = teamRows(model, side);
  const paper = model.mode === 'paper';
  return `<section class="match-report-team"><h2>${escape(model.match[side]?.name || (side === 'home' ? 'Casa' : 'Ospite'))}</h2><table aria-label="Rosa ${escape(side === 'home' ? 'casa' : 'ospite')}"><thead><tr><th class="report-name" scope="col">Nome e cognome</th>${model.columns.map((column) => `<th scope="col" class="report-stat ${column.className || ''}">${column.label}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map((row) => `<tr><td>${row.is_captain ? `<strong class="report-captain">${escape(row.full_name)}</strong>` : escape(row.full_name)}${row.is_mvp_vote ? ' <span class="match-report-mvp" aria-label="MVP" title="Miglior giocatore">&#9733;</span>' : ''}</td>${model.columns.map((column) => `<td class="report-stat ${column.className || ''}">${paper ? '&nbsp;' : column.key === 'played' ? row.played ? 'X' : '' : number(row[column.key])}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${model.columns.length + 1}">Nessun giocatore registrato.</td></tr>`}</tbody></table></section>`;
}

function eventTeam(model, event) {
  if (event.team_side === 'home' || sameId(event.team_id, model.match.home_team_id)) return model.match.home?.name || 'Casa';
  if (event.team_side === 'away' || sameId(event.team_id, model.match.away_team_id)) return model.match.away?.name || 'Ospite';
  return event.team_name || '';
}

function eventRows(model) {
  return model.events.map((event) => {
    const player = model.players.find((row) => sameId(row.id, event.player_id));
    const incoming = model.players.find((row) => sameId(row.id, event.incoming_player_id ?? event.incoming_id));
    const actor = [eventTeam(model, event), event.player_name || player?.full_name].filter(Boolean).join(' · ');
    return { event, minute: event.minute == null ? '-' : `${number(event.minute)}'`, label: eventLabels[event.event_type] || event.event_type || 'Evento', actor, score: event.home_score == null || event.away_score == null ? '-' : `${number(event.home_score)} - ${number(event.away_score)}`, notes: [event.notes, incoming && `Entra ${incoming.full_name}`].filter(Boolean).join(' · ') };
  });
}

/** A bounded print synopsis; the unmodified full log is also rendered for digital review. */
function condensedChronology(rows) {
  const maxGroups = 18;
  const groupSize = Math.ceil(rows.length / maxGroups);
  const grouped = [];
  for (let index = 0; index < rows.length; index += groupSize) {
    const group = rows.slice(index, index + groupSize);
    const counts = new Map();
    group.forEach((row) => counts.set(row.label, (counts.get(row.label) || 0) + 1));
    const first = group[0], last = group.at(-1);
    const noteCount = group.filter((row) => row.notes).length;
    grouped.push({ minute: first.minute === last.minute ? first.minute : `${first.minute} / ${last.minute}`, label: `${group.length} eventi`, actor: [...counts].map(([label, count]) => `${label}: ${count}`).join(' · '), score: last.score, notes: `Registrazioni ${index + 1}-${index + group.length}${noteCount ? `; ${noteCount} con note nel registro integrale` : ''}` });
  }
  return grouped;
}

const renderEventTable = (rows) => `<table><thead><tr><th scope="col" class="report-minute">Minuto</th><th scope="col" class="report-event">Evento</th><th scope="col" class="report-actor">Squadra / giocatore</th><th scope="col" class="report-result">Parziale</th><th scope="col">Note</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escape(row.minute)}</td><td>${escape(row.label)}</td><td>${escape(row.actor)}</td><td class="report-result">${escape(row.score)}</td><td>${escape(row.notes)}</td></tr>`).join('')}</tbody></table>`;

function renderChronology(model, rows, summarize) {
  if (model.mode === 'paper') return `<section class="match-report-chronology"><h2>Cronologia partita</h2>${renderEventTable(Array.from({ length: 16 }, () => ({ minute: '', label: '', actor: '', score: '', notes: '' })))}</section>`;
  return `<section class="match-report-chronology"><h2>Cronologia partita</h2>${summarize ? `<p class="match-report-summary-note">Sintesi di tutte le ${rows.length} registrazioni, in ordine di inserimento. Ogni intervallo riporta il parziale finale e il numero di eventi per tipo. Nomi, dettagli e note completi sono conservati nel registro digitale integrale della partita.</p>` : ''}${rows.length ? renderEventTable(summarize ? condensedChronology(rows) : rows) : `<p class="match-report-empty">${model.eventLogUnavailable ? 'Cronologia non disponibile: recuperare il registro digitale prima della verifica finale.' : 'Nessun evento registrato. Il risultato e le statistiche sono riportati nel primo foglio.'}</p>`}</section>`;
}

function safeSignatureImage(value) {
  return typeof value === 'string' && /^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(value) ? value : '';
}

function renderSignatures(model) {
  const paper = model.mode === 'paper';
  return `<section class="match-report-signatures"><h2>Firme dei capitani</h2><div class="match-report-signature-grid">${['home', 'away'].map((side) => {
    const signature = model.signatures.find((row) => row.team_side === side);
    const captain = teamRows(model, side).find((row) => row.is_captain);
    const image = safeSignatureImage(signature?.signature_data_url);
    return `<div class="match-report-signature"><strong>${escape(model.match[side]?.name || (side === 'home' ? 'Casa' : 'Ospite'))}</strong><span>${escape(signature?.captain_name || captain?.full_name || 'Capitano da indicare')}</span>${!paper && image ? `<img src="${image}" alt="Firma del capitano ${escape(signature.captain_name)}">` : '<div class="match-report-signature-line"></div>'}<small>${!paper && signature ? `Firma raccolta il ${escape(dateTime(signature.signed_at))}${image ? '' : ' · Immagine non disponibile'}` : paper ? 'Firma del capitano' : 'Firma da raccogliere'}</small></div>`;
  }).join('')}</div><p class="match-report-confirmation">I capitani confermano il risultato, le presenze, le statistiche e la cronologia riportati nel referto${model.reportHash ? ' e collegati alla sua impronta digitale' : ''}.</p></section>`;
}

function outOfSchemeSanctions(model) {
  const keys = [['fouls', 'falli'], ['yellow_cards', 'gialli'], ['red_cards', 'rossi']].filter(([key]) => !model.columns.some((column) => column.key === key));
  const items = model.stats.flatMap((stat) => keys.filter(([key]) => number(stat[key]) > 0).map(([key, label]) => `${stat.player_name || model.players.find((player) => sameId(player.id, stat.player_id))?.full_name || `#${stat.player_id}`}: ${number(stat[key])} ${label}`));
  return items.length ? `<p class="match-report-legend">Altre sanzioni presenti nel registro storico: ${escape(items.join('; '))}.</p>` : '';
}

export function renderMatchReport(input) {
  const model = normalizedModel(input);
  const { match, payload } = model;
  const paper = model.mode === 'paper';
  const rows = eventRows(model);
  const notes = [match.schedule_notes, model.notes ?? payload.offline_notes].filter(Boolean).join('\n');
  const longNotes = notes.length > 1100;
  // Bound printed detail by both rows and text. Never alter the original stored event log.
  const summarize = rows.length > (longNotes ? 18 : 32) || rows.reduce((count, row) => count + row.actor.length + row.notes.length, 0) > 3900 || rows.some((row) => row.notes.length > 280);
  const title = `${match.home?.name || 'Casa'} - ${match.away?.name || 'Ospite'}`;
  const modeLabel = paper ? 'Referto cartaceo di emergenza' : model.mode === 'final' ? 'Referto partita conclusa' : 'Referto in verifica';
  const score = paper ? '___ - ___' : `${number(payload.home_score ?? match.home_score)} - ${number(payload.away_score ?? match.away_score)}`;
  const phase = String(match.sport?.sport_type || '').toLowerCase().includes('pallavolo') ? 'Set' : String(match.sport?.sport_type || '').toLowerCase().includes('basket') ? 'Periodo' : 'Tempo';
  const dense = Math.max(teamRows(model, 'home').length, teamRows(model, 'away').length) > 24;
  const footer = (page) => `<footer class="match-report-footer"><span>ITSOSCup · Partita #${escape(match.id || model.matchId || '-')} · ${escape(match.sport?.name || 'Torneo')}</span><span>${page} / 2</span></footer>`;
  const fullNotes = longNotes ? '<p class="match-report-summary-note">Le note estese sono conservate integralmente nel registro digitale della partita e consultabili insieme al referto. Verificarle prima della firma.</p>' : `<p>${escape(notes)}</p>`;
  return `<article class="match-report${dense ? ' match-report-dense' : ''}" aria-label="${escape(modeLabel)} ${escape(title)}">
    <section class="match-report-sheet" data-report-page="1">
      <div class="match-report-brand"><strong>ITSOS<span>Cup</span></strong><span class="match-report-kicker">${escape(modeLabel)} · #${escape(match.id || model.matchId || '-')}</span></div>
      <header class="match-report-heading"><div><h1>${escape(title)}</h1><p>${escape(match.sport?.name || 'Torneo')} · ${escape(match.round_name || 'Fase da definire')}</p></div><div class="match-report-score">${score}<small>${paper ? 'Risultato finale' : model.mode === 'final' ? 'Risultato finale' : 'Risultato corrente'}</small></div></header>
      <section class="match-report-meta" aria-label="Dati della partita">${[['Campo', match.venue?.name || 'Da definire'], ['Inizio previsto', dateTime(match.scheduled_start)], ['Fine prevista', dateTime(match.scheduled_end)], ['Chiusura', paper ? '________________' : match.finished_at ? dateTime(match.finished_at) : 'Da confermare'], ['Durata / periodo', paper ? '________ / ________' : `${duration(payload.duration ?? match.duration)} · ${phase} ${number(payload.quarter || 1)}`], ['Timeout casa / ospite', paper ? '________ / ________' : `${number(payload.timeouts?.home)} / ${number(payload.timeouts?.away)}`]].map(([label, value]) => `<div><span>${label}</span><strong>${escape(value)}</strong></div>`).join('')}</section>
      <section class="match-report-staff" aria-label="Personale di gara">${staffLabels.map(([key, label]) => `<div><span>${label}</span><strong>${escape(model.staff[key] || (paper ? '________________' : 'Da indicare'))}</strong></div>`).join('')}</section>
      <div class="match-report-rosters">${renderRoster(model, 'home')}${renderRoster(model, 'away')}</div>
      <p class="match-report-legend"><strong>Legenda:</strong> nome in grassetto = capitano · X = presente · <span class="match-report-mvp" aria-hidden="true">&#9733;</span> = MVP${paper ? ' (selezionare accanto al nome)' : ''} · cella presenza vuota = ${paper ? 'assente o da compilare' : 'assente'}.</p>
      ${paper ? '' : outOfSchemeSanctions(model)}
      ${footer(1)}
    </section>
    <section class="match-report-sheet" data-report-page="2">
      <div class="match-report-continuation"><strong>ITSOSCup · ${escape(title)}</strong><span>Partita #${escape(match.id || model.matchId || '-')} · ${escape(score)}</span></div>
      ${renderChronology(model, rows, summarize)}
      ${renderSignatures(model)}
      ${notes ? `<section class="match-report-notes"><h2>Note del referto</h2>${fullNotes}</section>` : paper ? '<section class="match-report-notes"><h2>Note del referto</h2><div class="match-report-signature-line"></div></section>' : ''}
      ${model.reportHash || model.deviceLabel || model.reportRevision ? `<section class="match-report-identity">${model.deviceLabel ? `Postazione: ${escape(model.deviceLabel)} · ` : ''}${model.reportRevision ? `Revisione: ${escape(model.reportRevision)}<br>` : ''}${model.reportHash ? `Impronta del referto: <code>${escape(model.reportHash)}</code>` : ''}</section>` : ''}
      ${footer(2)}
    </section>
    ${summarize || longNotes ? `<details class="match-report-full-log"><summary>Registro digitale integrale · ${rows.length} eventi${longNotes ? ' e note complete' : ''}</summary>${rows.length ? renderEventTable(rows) : ''}${notes ? `<section class="match-report-notes"><h2>Note complete</h2><p>${escape(notes)}</p></section>` : ''}</details>` : ''}
  </article>`;
}

export function renderMatchReportDocument(models, options = {}) {
  const inputs = Array.isArray(models) ? models : [models];
  return `<!doctype html><html lang="it"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(options.title || 'ITSOSCup - Referto partita')}</title><style>html,body{margin:0;padding:0;background:#fff}body{font-family:Inter,"Segoe UI",Arial,sans-serif}${MATCH_REPORT_CSS}</style></head><body>${inputs.map(renderMatchReport).join('')}</body></html>`;
}

/** Measure the actual A4 layout; never print a partial or silently shortened roster. */
export function assertMatchReportPrintCapacity(target) {
  const document = target.ownerDocument || target;
  const source = target.querySelectorAll('.match-report');
  if (!source.length) throw new Error('Referto non disponibile per la stampa.');
  const measure = document.createElement('div');
  measure.setAttribute('data-report-measure', '');
  measure.style.cssText = 'position:absolute;left:-10000px;top:0;width:190mm;display:block;visibility:hidden;pointer-events:none';
  const style = document.createElement('style');
  style.textContent = `${MATCH_REPORT_CSS}
    [data-report-measure] .match-report {width:190mm!important;max-width:none!important;margin:0!important}
    [data-report-measure] .match-report-sheet {padding:0!important;border:0!important;margin:0!important;min-height:275mm!important}
    [data-report-measure] .match-report-rosters {grid-template-columns:1fr 1fr!important}
    [data-report-measure] .match-report-heading {grid-template-columns:1fr auto!important}
    [data-report-measure] .match-report-meta {grid-template-columns:repeat(3,1fr)!important}
    [data-report-measure] .match-report-staff {grid-template-columns:repeat(4,1fr)!important}
    [data-report-measure] .match-report-chronology {overflow:visible!important}
    [data-report-measure] .match-report-chronology table {min-width:0!important}
    [data-report-measure] .match-report-full-log {display:none!important}
  `;
  measure.append(style, ...Array.from(source, (report) => report.cloneNode(true)));
  document.body.append(measure);
  try {
    // Chrome's CSS millimetre is 96 / 25.4 pixels; allow rounding, never an extra row.
    const maximum = 275 * 96 / 25.4 + 2;
    const oversized = [...measure.querySelectorAll('.match-report-sheet')].some((sheet) => sheet.getBoundingClientRect().height > maximum);
    if (oversized) throw new Error('Il referto completo supera le due pagine A4. Nessun dato è stato tagliato: la rosa e il registro integrali restano disponibili nella partita. Verifica i nominativi e i dati prima di stampare.');
    return true;
  } finally { measure.remove(); }
}
