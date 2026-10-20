/* Read-only diagnostics for already scheduled fixtures. All venues are considered. */
const minute=60000;
const stamp=value=>{const n=Date.parse(String(value||''));return Number.isFinite(n)?n:null};
export function calendarLocalDay(value){
 const ms=stamp(value);if(ms===null)return null;
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(ms));
 const take=key=>parts.find(p=>p.type===key)?.value;
 return [take('year'),take('month'),take('day')].join('-');
}
const sideIds=m=>[m.home_team_id,m.away_team_id].map(Number).filter(Number.isFinite).filter(x=>x>0);
const name=(m,side)=>String(m[side]?.name||('Squadra #'+m[side+'_team_id']));
const phase=m=>String(m.round_name||'');
export function inspectExistingCalendar(matches=[],minimumRest=0){
 const rest=Number.isFinite(Number(minimumRest))?Math.max(0,Number(minimumRest)):0;
 const active=matches.filter(m=>m.status!=='cancelled');
 const unscheduled=active.filter(m=>!stamp(m.scheduled_start)||!stamp(m.scheduled_end)||!m.venue_id);
 const scheduled=active.filter(m=>stamp(m.scheduled_start)!==null&&stamp(m.scheduled_end)!==null&&m.venue_id);
 const days=new Map(),issues=[],gaps=[];
 const push=(type,description,teamId=null)=>issues.push({type,description,teamId});
 for(const m of scheduled){
  const day=calendarLocalDay(m.scheduled_start);
  if(!days.has(day))days.set(day,[]);
  days.get(day).push(m);
  if(stamp(m.scheduled_end)<=stamp(m.scheduled_start))push('conflict','Partita #'+m.id+': orario di fine non successivo all’inizio');
 }
 for(const [day,fixtures] of days){
  fixtures.sort((a,b)=>stamp(a.scheduled_start)-stamp(b.scheduled_start));
  const waveStarts=[...new Set(fixtures.map(m=>stamp(m.scheduled_start)))].sort((a,b)=>a-b);
  const wave=new Map(waveStarts.map((value,index)=>[value,index]));
  const teamGames=new Map(),venueGames=new Map();
  for(const m of fixtures){
   for(const id of sideIds(m)){
    if(!teamGames.has(id))teamGames.set(id,[]);
    teamGames.get(id).push(m);
   }
   const vid=Number(m.venue_id);
   if(!venueGames.has(vid))venueGames.set(vid,[]);
   venueGames.get(vid).push(m);
  }
  for(const [id,games] of teamGames){
   games.sort((a,b)=>stamp(a.scheduled_start)-stamp(b.scheduled_start));
   const teamTitle=m=>Number(m.home_team_id)===id?name(m,'home'):name(m,'away');
   for(let i=1;i<games.length;i++){
    const previous=games[i-1],current=games[i];
    const gap=(stamp(current.scheduled_start)-stamp(previous.scheduled_end))/minute;
    if(gap<0)push('conflict',day+' · '+teamTitle(current)+': gare sovrapposte su campi diversi o nello stesso campo',id);
    else{
     gaps.push({teamId:id,teamName:teamTitle(current),day,minutes:gap,previousId:previous.id,nextId:current.id});
     if(rest>0&&gap<rest)push('rest',day+' · '+teamTitle(current)+': riposo '+Math.round(gap)+' min (minimo '+rest+' min)',id);
    }
   }
   for(let i=2;i<games.length;i++){
    const [a,b,c]=games.slice(i-2,i+1);
    const ai=wave.get(stamp(a.scheduled_start)),bi=wave.get(stamp(b.scheduled_start)),ci=wave.get(stamp(c.scheduled_start));
    const duration=Math.max((stamp(a.scheduled_end)-stamp(a.scheduled_start))/minute,(stamp(b.scheduled_end)-stamp(b.scheduled_start))/minute,(stamp(c.scheduled_end)-stamp(c.scheduled_start))/minute);
    if(bi===ai+1&&ci===bi+1&&stamp(b.scheduled_start)-stamp(a.scheduled_start)<= (duration*2+15)*minute&&stamp(c.scheduled_start)-stamp(b.scheduled_start)<=(duration*2+15)*minute)
      push('consecutive',day+' · '+teamTitle(c)+': tre turni consecutivi, anche considerando campi differenti',id);
   }
  }
  for(const [vid,games] of venueGames){
   games.sort((a,b)=>stamp(a.scheduled_start)-stamp(b.scheduled_start));
   for(let i=1;i<games.length;i++)if(stamp(games[i].scheduled_start)<stamp(games[i-1].scheduled_end))
    push('conflict',day+' · campo #'+vid+': incontri #'+games[i-1].id+' e #'+games[i].id+' sovrapposti');
  }
 }
 const first=scheduled.filter(m=>!(/ritorno|semifinale|finale|quarti|ottavi|play.?off|eliminazione/i.test(phase(m))));
 const returns=scheduled.filter(m=>/ritorno/i.test(phase(m)));
 if(first.length&&returns.length){
  const lastFirst=Math.max(...first.map(m=>stamp(m.scheduled_end)));
  const firstReturn=Math.min(...returns.map(m=>stamp(m.scheduled_start)));
  if(firstReturn<lastFirst)push('phase','Una partita di ritorno inizia prima della fine di tutte le gare di andata');
 }
 const closeGaps=gaps.filter(x=>x.minutes<=45);
 const longGaps=gaps.filter(x=>x.minutes>=150);
 return {
  total:active.length,scheduled:scheduled.length,unscheduled:unscheduled.length,
  days:[...days.keys()].sort(),daysMatches:days,issues,gaps,closeGaps,longGaps,
  minimumRestMinutes:gaps.length?Math.round(Math.min(...gaps.map(x=>x.minutes))):null,
  expectedRestMinutes:rest
 };
}
