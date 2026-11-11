// Percentuale di preparazione del Centro di controllo.
// Prima si basava sulle postazioni assegnate (funzione dismessa) e restava quindi a 0%.
// Ora misura le partite ancora da giocare che hanno già orario, e la riduce se il
// controllo pre-evento segnala errori bloccanti.
export function computeRegiaReadiness(snapshot = {}, checklist = []) {
  const matches = snapshot?.matches ?? {};
  const total = Number(matches.total ?? 0) || 0;
  const scheduled = Math.max(0, Number(matches.scheduled ?? 0) || 0);
  const unscheduled = Math.max(0, Number(matches.unscheduled ?? 0) || 0);
  const toPlay = scheduled + unscheduled;
  const errors = (Array.isArray(checklist) ? checklist : []).filter((row) => row?.severity === 'error').length;
  if (!total && !toPlay) {
    return { percent: null, label: '—', detail: 'Nessuna partita creata', errors };
  }
  if (!toPlay) {
    return { percent: 100, label: '100%', detail: 'Tutte le partite sono concluse', errors };
  }
  let percent = Math.round((scheduled / toPlay) * 100);
  if (errors && percent === 100) percent = 99;
  const detail = `${scheduled} di ${toPlay} partite con orario` + (errors ? ` · ${errors} ${errors === 1 ? 'errore' : 'errori'} da risolvere` : '');
  return { percent, label: `${percent}%`, detail, errors };
}
