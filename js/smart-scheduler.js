/* ITSOSCup: deterministic, fairness-aware schedule proposal (no database writes). */
const MINUTE=60_000;
export const isReturnMatch=m=>/ritorno/i.test(String(m?.round_name||''));
export const isFirstLeg=m=>!isReturnMatch(m);
const validTime=x=>{const t=Date.parse(String(x||''));return Number.isFinite(t)?t:null};
const teamIds=m=>[Number(m.home_team_id),Number(m.away_team_id)].filter(Boolean);
const sharedTeam=(a,b)=>teamIds(a).some(id=>teamIds(b).includes(id));
const liveOrFinal=m=>m.is_finished||m.started_at||['finished','cancelled','in_progress','live'].includes(m.status);
export function intervalsConflict(a,b,restMinutes=0){
 if(Number(a.id)===Number(b.id)||b.status==='cancelled')return false;
 const [as,ae,bs,be]=[validTime(a.scheduled_start),validTime(a.scheduled_end),validTime(b.scheduled_start),validTime(b.scheduled_end)];
 if([as,ae,bs,be].some(v=>v===null))return false;
 return ((as<be&&bs<ae)&&Number(a.venue_id)===Number(b.venue_id))||
   (sharedTeam(a,b)&&as<be+restMinutes*MINUTE&&bs<ae+restMinutes*MINUTE);
}
function waveIndex(m,base,stride){
 const s=validTime(m.scheduled_start);
 if(s===null)return null;
 const raw=(s-base)/stride;
 // Conservative: nearby non-aligned fixtures still count as an active wave.
 return Math.round(raw);
}
function consecutiveCountWouldExceed(candidate,existing,base,stride){
 const index=waveIndex(candidate,base,stride);
 if(index===null)return false;
 for(const team of teamIds(candidate)){
  const occupied=new Set(existing.filter(m=>sharedTeam({home_team_id:team},m)).map(m=>waveIndex(m,base,stride)).filter(x=>x!==null));
  occupied.add(index);
  if((occupied.has(index-2)&&occupied.has(index-1))||
    (occupied.has(index-1)&&occupied.has(index+1))||
    (occupied.has(index+1)&&occupied.has(index+2)))return true;
 }
 return false;
}
export function verifyTournamentSchedule(matches,restMinutes=0){
 const ordered=[...matches].filter(m=>m.status!=='cancelled'&&validTime(m.scheduled_start)!==null)
   .sort((a,b)=>validTime(a.scheduled_start)-validTime(b.scheduled_start));
 const errors=[];
 for(let i=0;i<ordered.length;i++){
  const a=ordered[i];
  for(let j=i+1;j<ordered.length;j++){
   const b=ordered[j];
   if(intervalsConflict(a,b,restMinutes))errors.push('Sovrapposizione o riposo insufficiente: '+a.id+' / '+b.id);
  }
 }
 const first=ordered.filter(isFirstLeg),returns=ordered.filter(isReturnMatch);
 if(returns.length&&first.length){
  const lastFirst=Math.max(...first.map(m=>validTime(m.scheduled_end)||0));
  const firstReturn=Math.min(...returns.map(m=>validTime(m.scheduled_start)));
  if(firstReturn<lastFirst)errors.push('Il ritorno inizia prima che tutte le partite di andata siano terminate');
 }
 return errors;
}
export function buildSmartSchedule({matches=[],venues=[],start,end,durationMinutes=30,restMinutes=20,mode='new'}){
 const beginning=validTime(start),finish=validTime(end),duration=Number(durationMinutes),rest=Number(restMinutes);
 if(beginning===null||finish===null||finish<=beginning||!Number.isInteger(duration)||duration<10||duration>240||!Number.isInteger(rest)||rest<0||rest>240)
  throw new Error('Intervallo, durata o riposo non validi');
 const fields=[...new Set(venues.map(x=>Number(x.id??x)).filter(Number.isInteger))].sort((a,b)=>a-b);
 if(!fields.length)throw new Error('Seleziona almeno un campo');
 const eligible=m=>!liveOrFinal(m)&&m.home_team_id&&m.away_team_id&&Number(m.home_team_id)!==Number(m.away_team_id)&&
  (mode==='delay'?Boolean(m.scheduled_start)&&validTime(m.scheduled_start)>=Date.now():!m.scheduled_start);
 const pending=matches.filter(eligible);
 const scheduled=matches.filter(m=>!pending.includes(m)&&m.status!=='cancelled'&&m.scheduled_start&&m.scheduled_end);
 const fixedReturns=scheduled.filter(isReturnMatch);
 const returnLimit=fixedReturns.length?Math.min(...fixedReturns.map(m=>validTime(m.scheduled_start))):Infinity;
 const stride=duration*MINUTE;
 const waves=[];
 for(let time=beginning;time+stride<=finish;time+=stride)waves.push(time);
 const assigned=[],remaining=[...pending],failures=[];
 const proposals=[];
 const phases=[remaining.filter(isFirstLeg),remaining.filter(isReturnMatch)];
 let lastFirstLeg=Math.max(beginning,...scheduled.filter(isFirstLeg).map(m=>validTime(m.scheduled_end)||beginning));
 let nextWave=0;
 for(let phase=0;phase<phases.length;phase++){
  const queue=phases[phase];
  // Return fixtures must never begin until every first-leg fixture has a slot.
  if(phase===1&&phases[0].length){for(const m of queue)failures.push({match:m,reason:'Andata non completata: ritorno bloccato'});continue}
  for(;nextWave<waves.length&&queue.length;nextWave++){
   const startAt=waves[nextWave],endAt=startAt+stride;
   if(phase===0&&endAt>returnLimit)continue;
   if(phase===1&&startAt<lastFirstLeg)continue;
   for(const venueId of fields){
    const candidates=[];
    for(const m of queue){
     if(mode==='delay'&&startAt<Math.max(beginning,validTime(m.scheduled_start)||beginning))continue;
     const candidate={...m,venue_id:venueId,scheduled_start:new Date(startAt).toISOString(),scheduled_end:new Date(endAt).toISOString()};
     const all=[...scheduled,...assigned];
     if(all.some(other=>intervalsConflict(candidate,other,rest)))continue;
     if(consecutiveCountWouldExceed(candidate,all,beginning,stride))continue;
     // Keep consecutive games exceptional, even if the minimum rest is technically met.
     let penalty=0;
     for(const id of teamIds(m)){
      const appearances=all.filter(other=>teamIds(other).includes(id));
      const last=appearances.reduce((best,other)=>Math.max(best,validTime(other.scheduled_end)||0),0);
      if(last&&last<=startAt&&startAt-last<stride+rest*MINUTE)penalty+=300;
      penalty+=appearances.filter(other=>{
       const d=validTime(other.scheduled_start);return d!==null&&d>=beginning&&d<finish;
      }).length*12;
     }
     candidates.push({m,candidate,penalty});
    }
    if(!candidates.length)continue;
    candidates.sort((a,b)=>a.penalty-b.penalty||Number(a.m.id)-Number(b.m.id));
    // If there is enough room, skip a wave rather than force a second consecutive game.
    const zero=candidates.find(x=>x.penalty<300);
    const chosen=zero||candidates[0];
    if(chosen.penalty>=300&&waves.length-nextWave-1>=Math.ceil(queue.length/fields.length)+1)continue;
    assigned.push(chosen.candidate);
    proposals.push({match_id:Number(chosen.m.id),venue_id:venueId,
      scheduled_start:chosen.candidate.scheduled_start,scheduled_end:chosen.candidate.scheduled_end,
      original_start:chosen.m.scheduled_start||null,original_end:chosen.m.scheduled_end||null,original_venue_id:chosen.m.venue_id||null});
    queue.splice(queue.indexOf(chosen.m),1);
    if(phase===0)lastFirstLeg=Math.max(lastFirstLeg,endAt);
   }
  }
  if(phase===0&&queue.length){
   for(const m of queue)failures.push({match:m,reason:'Spazi insufficienti con riposi e massimo due partite consecutive'});
  }
  if(phase===1&&queue.length){
   for(const m of queue)failures.push({match:m,reason:'Spazi insufficienti dopo la conclusione dell’andata'});
  }
 }
 // Never publish a partial first leg together with a return leg.
 const missedIds=new Set(failures.map(x=>Number(x.match.id)));
 for(const m of pending)if(!assigned.some(x=>Number(x.id)===Number(m.id))&&!missedIds.has(Number(m.id)))failures.push({match:m,reason:'Nessuno spazio disponibile'});
 const errors=verifyTournamentSchedule([...scheduled,...assigned],rest);
 if(errors.length)throw new Error('Verifica di sicurezza fallita: '+errors[0]);
 return {scheduled:assigned,proposal:proposals,missed:failures,
   total:pending.length,fields:fields.length,checks:{firstLeg:assigned.filter(isFirstLeg).length,returnLeg:assigned.filter(isReturnMatch).length}};
}
