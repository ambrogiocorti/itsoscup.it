import { runRpc } from './db.js';

/**
 * This RPC returns only messages explicitly marked as public on the
 * existing team page. It never returns class access codes or read receipts.
 */
export async function loadPublicTeamNotices(sportId,teamId){
  const sid=Number(sportId),tid=Number(teamId);
  if(!Number.isSafeInteger(sid)||sid<=0||!Number.isSafeInteger(tid)||tid<=0)return [];
  const data=await runRpc('public_team_notices',
    {p_sport_id:sid,p_team_id:tid},'Caricamento avvisi della squadra');
  return Array.isArray(data)?data:[];
}
