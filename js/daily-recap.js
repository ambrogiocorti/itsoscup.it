// Daily summaries contain public team-level facts only (no student names or signed referti).
export const localDay = value => {
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));
  const part=type=>parts.find(p=>p.type===type)?.value;
  return [part('year'),part('month'),part('day')].join('-');
};
const name=team=>String(team?.name||'Squadra da definire');
export function buildDailyRecap(matches=[],date=localDay(Date.now())) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Data non valida');
  const completed=matches.filter(m=>m.is_finished&&localDay(m.finished_at||m.scheduled_start||m.created_at)===date);
  const upcoming=matches.filter(m=>!m.is_finished&&m.scheduled_start&&localDay(m.scheduled_start)>date).sort((a,b)=>new Date(a.scheduled_start)-new Date(b.scheduled_start)).slice(0,10);
  const near=completed.filter(m=>Number.isFinite(Number(m.home_score))&&Number.isFinite(Number(m.away_score))).sort((a,b)=>Math.abs(Number(a.home_score)-Number(a.away_score))-Math.abs(Number(b.home_score)-Number(b.away_score))).slice(0,3);
  const bySport=new Map();
  for(const m of matches.filter(m=>m.is_finished && m.finished_at && localDay(m.finished_at)<=date)) {
    const sport=String(m.sport?.name||'Torneo');
    if(!bySport.has(sport))bySport.set(sport,new Map());
    const table=bySport.get(sport);
    const hs=Number(m.home_score||0),as=Number(m.away_score||0);
    for(const [team,scored,conceded] of [[m.home,hs,as],[m.away,as,hs]]) {
      if(!team?.name)continue;
      const key=String(team.id||team.name);
      const row=table.get(key)||{name:name(team),played:0,wins:0,draws:0,losses:0,scored:0,conceded:0};
      row.played++;row.scored+=scored;row.conceded+=conceded;
      if(scored>conceded)row.wins++;else if(scored===conceded)row.draws++;else row.losses++;
      table.set(key,row);
    }
  }
  const standings=[...bySport].map(([sport,teams])=>({sport,rows:[...teams.values()].sort((a,b)=>b.wins-a.wins||b.scored-b.conceded-(a.scored-a.conceded)).slice(0,5)}));
  return {date,completed,upcoming,closest:near,standings,matchCount:completed.length};
}
const esc=x=>String(x??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const row=m=>`<li><strong>${esc(name(m.home))} ${m.is_finished?esc(m.home_score):'–'} – ${m.is_finished?esc(m.away_score):'–'} ${esc(name(m.away))}</strong><small> ${esc(m.sport?.name||'')} · ${esc(m.venue?.name||'')}</small></li>`;
export function renderDailyRecap(data) {
 const section=(title,items)=>`<section><h2>${esc(title)}</h2>${items.length?'<ul>'+items.join('')+'</ul>':'<p>Nessun dato disponibile.</p>'}</section>`;
 const table=data.standings.map(group=>`<section><h3>${esc(group.sport)}</h3><ol>${group.rows.map(r=>`<li>${esc(r.name)} — ${r.wins} vittorie, ${r.draws} pareggi, ${r.losses} sconfitte</li>`).join('')}</ol></section>`).join('');
 return `<article class="daily-recap"><h1>ITSOSCup · Riepilogo del ${esc(data.date)}</h1><p>${data.matchCount} partite concluse.</p>
 ${section('Risultati della giornata',data.completed.map(row))}
 ${section('Partite più combattute',data.closest.map(row))}
 <h2>Andamento delle squadre</h2><p class="muted">Vittorie e sconfitte riepilogative; la classifica ufficiale resta nella pagina torneo.</p>${table||'<p>Nessun risultato ancora registrato.</p>'}
 ${section('Prossimi incontri',data.upcoming.map(row))}</article>`;
}
