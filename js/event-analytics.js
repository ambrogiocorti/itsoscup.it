// Pure analytics functions: missing timestamps are excluded from averages.
export function summarizeEvent(matches = [], changes = []) {
  const completed = matches.filter(m => m.is_finished === true);
  const started = matches.filter(m => m.started_at && m.scheduled_start);
  const delays = started.map(m => Math.round((Date.parse(m.started_at)-Date.parse(m.scheduled_start))/60000)).filter(Number.isFinite);
  const durations = completed.filter(m => m.finished_at && m.started_at)
    .map(m => Math.round((Date.parse(m.finished_at)-Date.parse(m.started_at))/60000))
    .filter(n => Number.isFinite(n) && n >= 0);
  const mean = values => values.length ? Math.round(values.reduce((s,n)=>s+n,0)/values.length) : null;
  return {
    total: matches.length,
    completed: completed.length,
    pending: matches.filter(m => !m.is_finished && m.status !== 'cancelled').length,
    lateStarts: delays.filter(n=>n>0).length,
    averageDelay: mean(delays),
    averageDuration: mean(durations),
    reschedules: changes.length,
    corrections: matches.filter(m=>Boolean(m.reopened_at)).length,
    measuredStarts: delays.length,
    measuredDurations: durations.length,
  };
}
export function analyticsCsv(data) {
  const rows=[
    ['Indicatore','Valore'],['Partite',data.total],['Concluse',data.completed],
    ['Da completare',data.pending],['Avvii in ritardo',data.lateStarts],
    ['Avvii monitorati',data.measuredStarts],['Ritardo medio (min)',data.averageDelay??'ND'],
    ['Durata media (min)',data.averageDuration??'ND'],['Riprogrammazioni',data.reschedules],
    ['Partite riaperte per correzione',data.corrections],
  ];
  const csvValue=v=>'"'+String(v??'').replaceAll('"','""')+'"';
  return '\uFEFF'+rows.map(row=>row.map(csvValue).join(';')).join('\r\n');
}
