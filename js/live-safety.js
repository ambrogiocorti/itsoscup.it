// Pure helpers: testable without a browser or Supabase.
export function validateMatchClosure({sportType='',homeScore,awayScore,homePlayers=[],awayPlayers=[],entries=[],config={},homeCaptain,awayCaptain,signatures}={}) {
  const blockers=[],warnings=[],checks=[];
  const count=team=>team.filter(p=>entries.some(e=>Number(e.player_id)===Number(p.id)&&e.played)).length;
  const scoreOkay=Number.isInteger(homeScore)&&homeScore>=0&&Number.isInteger(awayScore)&&awayScore>=0;
  checks.push({label:'Punteggio valido',ok:scoreOkay});
  if(!scoreOkay)blockers.push('Inserisci un punteggio valido per entrambe le squadre.');
  const min=Math.max(1,Number(config.min_players||1));
  const presences=count(homePlayers)>=min&&count(awayPlayers)>=min;
  checks.push({label:'Presenze: entrambe le squadre',ok:presences});
  if(!presences)blockers.push(`Sono necessarie almeno ${min} presenze per squadra.`);
  const captains=Boolean(homeCaptain&&awayCaptain);
  checks.push({label:'Capitani identificati',ok:captains});
  if(!captains)blockers.push('Configura i capitani delle due squadre.');
  const invalidSanctions=entries.some(e=>[e.fouls,e.yellow_cards,e.red_cards].some(v=>Number(v||0)<0)||Number(e.red_cards||0)>10||Number(e.yellow_cards||0)>10);
  checks.push({label:'Falli e sanzioni coerenti',ok:!invalidSanctions});
  if(invalidSanctions)blockers.push('Controlla falli e cartellini anomali.');
  const wantsMvp=config.allow_mvp===true && ['calcio','basket','pallavolo'].includes(sportType);
  const mvpSelected=entries.some(e=>e.is_mvp_vote);
  checks.push({label:wantsMvp?'MVP selezionato':'MVP non richiesto',ok:!wantsMvp||mvpSelected});
  if(wantsMvp&&!mvpSelected)warnings.push('MVP non selezionato: scegli un atleta prima di chiudere.');
  const signed=Boolean(signatures?.home&&signatures?.away);
  checks.push({label:'Firme dei due capitani',ok:signed});
  if(!signed)blockers.push('Servono entrambe le firme dei capitani.');
  return {blockers,warnings,checks,ready:blockers.length===0};
}
export function createUndoSnapshot(state) {
  return {
    homeScore:state.homeScore,awayScore:state.awayScore,
    quarter:state.quarter,duration:state.duration,
    timeouts:{...state.timeouts},
    playerState:[...state.playerState.entries()].map(([key,value])=>[key,{...value}]),
    eventLog:state.eventLog.map(event=>({...event})),
  };
}
export function applyUndoSnapshot(state,snapshot) {
  state.homeScore=snapshot.homeScore;state.awayScore=snapshot.awayScore;
  state.quarter=snapshot.quarter;state.duration=snapshot.duration;
  state.timeouts={...snapshot.timeouts};
  state.playerState=new Map(snapshot.playerState.map(([key,value])=>[key,{...value}]));
  state.eventLog=snapshot.eventLog.map(event=>({...event}));
}
