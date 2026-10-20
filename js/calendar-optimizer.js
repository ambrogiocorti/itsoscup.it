import {db,run} from './db.js';
import {calendarLocalDay,inspectExistingCalendar} from './calendar-quality-analysis.js';
const ms=60000;
const time=v=>Date.parse(String(v||'')),teams=m=>[Number(m.home_team_id),Number(m.away_team_id)].filter(x=>x>0);
const locked=m=>m.is_finished||Boolean(m.started_at)||['live','paused','finished','completed','cancelled'].includes(String(m.status||'').toLowerCase())||['live','paused','finished','completed'].includes(String(m.operational_status||'').toLowerCase())||time(m.scheduled_start)<=Date.now();
export function proposeCalendarOptimization(matches,minimumRest=15,maxDelay=240){
 const rest=Math.max(0,Number(minimumRest)||0)*ms,limit=Math.max(0,Number(maxDelay)||0)*ms;
 const all=matches.filter(m=>m.scheduled_start&&m.scheduled_end&&m.venue_id&&Number.isFinite(time(m.scheduled_start))&&time(m.scheduled_end)>time(m.scheduled_start));
 const ordered=[...all].sort((a,b)=>time(a.scheduled_start)-time(b.scheduled_start)||Number(a.id)-Number(b.id));
 const placed=ordered.filter(locked).map(match=>({match,start:time(match.scheduled_start),end:time(match.scheduled_end)})),changes=[],unresolved=[];
 for(const match of ordered.filter(m=>!locked(m))){
  const start=time(match.scheduled_start),duration=time(match.scheduled_end)-start;
  const conflicts=(candidate)=>placed.some(other=>{
   const sameVenue=Number(other.match.venue_id)===Number(match.venue_id);
   const sameTeam=teams(match).some(id=>teams(other.match).includes(id));
   const distance=sameTeam?rest:0;
   return (sameVenue||sameTeam)&&candidate<other.end+distance&&candidate+duration>other.start-distance;
  });
  let next=start;
  if(conflicts(next)){
   for(next=start+5*ms;next<=start+limit;next+=5*ms){
    if(calendarLocalDay(new Date(next).toISOString())!==calendarLocalDay(new Date(start).toISOString())||calendarLocalDay(new Date(next+duration-1).toISOString())!==calendarLocalDay(new Date(start).toISOString()))break;
    if(!conflicts(next))break;
   }
  }
  if(conflicts(next)||calendarLocalDay(new Date(next).toISOString())!==calendarLocalDay(new Date(start).toISOString())||calendarLocalDay(new Date(next+duration-1).toISOString())!==calendarLocalDay(new Date(start).toISOString())||next>start+limit){
   next=start;unresolved.push(Number(match.id));
  }else if(next!==start){
   changes.push({id:Number(match.id),originalStart:match.scheduled_start,originalEnd:match.scheduled_end,start:new Date(next).toISOString(),end:new Date(next+duration).toISOString(),venueId:Number(match.venue_id)});
  }
  placed.push({match,start:next,end:next+duration});
 }
 return {changes,unresolved,locked:ordered.filter(locked).length,report:inspectExistingCalendar(all.map(m=>{const c=changes.find(x=>x.id===Number(m.id));return c?{...m,scheduled_start:c.start,scheduled_end:c.end}:m}),minimumRest)};
}
export async function saveCalendarOptimization(sportId,changes,originalMatches){
 if(!changes.length)return 0;
 const ids=changes.map(c=>c.id);
 const {data:latest}=await run(db.from('matches').select('id,sport_id,venue_id,scheduled_start,scheduled_end,is_finished,status,operational_status,started_at').eq('sport_id',Number(sportId)),'Controllo calendario');
 const original=new Map(originalMatches.map(m=>[Number(m.id),m])),current=new Map((latest||[]).map(m=>[Number(m.id),m]));
 for(const change of changes){
  const before=original.get(change.id),now=current.get(change.id);
  if(!before||!now||locked(now)||Number(now.venue_id)!==change.venueId||now.scheduled_start!==before.scheduled_start||now.scheduled_end!==before.scheduled_end)throw Error('Il calendario è cambiato oppure una partita è iniziata. Aggiorna l’anteprima.');
 }
 const proposals=changes.map(c=>({match_id:c.id,venue_id:c.venueId,scheduled_start:c.start,scheduled_end:c.end,original_start:c.originalStart,original_end:c.originalEnd,original_venue_id:c.venueId}));
 await run(db.rpc('apply_smart_schedule',{p_sport_id:Number(sportId),p_changes:proposals}),'Pubblicazione atomica riprogrammazione');
 return proposals.length;
}
