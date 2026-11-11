// Condizioni per la conferma definitiva delle rose, senza accesso al database:
// usata dalla sezione Squadre, dalla Preparazione in dashboard e dai test.
// Gli id degli inviti sono UUID: vanno confrontati come testo, mai con Number().
const sameId = (a, b) => a != null && b != null && String(a) === String(b);

export function evaluateRosterReadiness({ sport = null, teams = [], registrations = [], invites = [] } = {}) {
  const regs = Array.isArray(registrations) ? registrations : [];
  const active = (Array.isArray(invites) ? invites : []).filter((invite) => invite?.is_active !== false);
  const pending = regs.filter((row) => row?.status === 'pending');
  const rejected = regs.filter((row) => row?.status === 'rejected');
  const approved = regs.filter((row) => row?.status === 'approved');
  const withoutProposal = active.filter((invite) => !regs.some((row) => sameId(row.invite_id, invite.id)));
  const teamCount = Array.isArray(teams) ? teams.length : 0;
  const names = (rows) => rows.map((row) => row?.class_name).filter(Boolean).join(', ');

  const checks = [
    {
      key: 'deadline',
      state: sport?.registration_deadline ? 'ok' : 'error',
      label: 'Scadenza iscrizioni',
      detail: sport?.registration_deadline
        ? 'Impostata al ' + new Date(sport.registration_deadline).toLocaleString('it-IT')
        : 'Imposta la data di chiusura delle iscrizioni qui sopra.',
    },
    {
      key: 'teams',
      state: teamCount > 0 ? 'ok' : 'error',
      label: 'Squadre del torneo',
      detail: teamCount > 0 ? teamCount + (teamCount === 1 ? ' squadra presente' : ' squadre presenti') : 'Nessuna squadra: approva almeno una proposta o crea una squadra.',
    },
    {
      key: 'pending',
      state: pending.length || rejected.length ? 'error' : 'ok',
      label: 'Proposte delle classi',
      detail: pending.length
        ? pending.length + ' da approvare' + (names(pending) ? ' (' + names(pending) + ')' : '')
        : rejected.length
          ? rejected.length + ' respinte da correggere' + (names(rejected) ? ' (' + names(rejected) + ')' : '')
          : approved.length + ' approvate',
    },
    {
      key: 'invites',
      state: withoutProposal.length ? 'error' : 'ok',
      label: 'Classi invitate',
      detail: withoutProposal.length
        ? withoutProposal.length + ' senza rosa inviata (' + names(withoutProposal) + '). Se non partecipano, escludile.'
        : active.length
          ? 'Tutte le classi invitate hanno inviato la rosa'
          : 'Nessun invito attivo',
    },
  ];

  const blockers = [];
  if (!sport?.registration_deadline) blockers.push('Imposta prima la scadenza delle iscrizioni.');
  if (!teamCount) blockers.push('Il torneo non ha squadre.');
  if (pending.length) blockers.push('Ci sono ' + pending.length + ' proposte da approvare.');
  if (rejected.length) blockers.push('Ci sono ' + rejected.length + ' proposte respinte da correggere o rimuovere.');
  // Il database (migrazione 059) rifiuta la conferma se un invito attivo non ha una rosa approvata.
  if (withoutProposal.length) blockers.push(withoutProposal.length + ' classi invitate non hanno inviato la rosa: escludile o attendi la loro iscrizione.');

  return {
    ready: blockers.length === 0,
    blockers,
    checks,
    withoutProposal,
    counts: { approved: approved.length, pending: pending.length, rejected: rejected.length, withoutProposal: withoutProposal.length, invites: active.length },
  };
}
