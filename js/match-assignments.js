import { db, run } from './db.js';

export async function myAssignedMatches() {
  const { data } = await run(db.rpc('itsos_my_assigned_matches'), 'Partite assegnate');
  return new Set((data || []).map(row => Number(row.match_id)));
}

export async function canOperateMatch(matchId, role) {
  if (role === 'super_admin') return true;
  if (role !== 'match_manager') return false;
  const assigned = await myAssignedMatches();
  return assigned.has(Number(matchId));
}

export async function loadEligibleOperators() {
  const { data } = await run(
    db.from('admins').select('id,nome,email,ruolo').in('ruolo',['match_manager','super_admin']).order('nome'),
    'Caricamento segnapunti e supervisori'
  );
  return data || [];
}

export async function getMatchOperators(matchId) {
  const { data } = await run(
    db.from('match_staff_assignments').select('role,admin_id,name').eq('match_id',matchId).in('role',['scorekeeper','supervisor']),
    'Caricamento assegnazioni'
  );
  return data || [];
}

export async function assignMatchOperators(matchId, scorekeeperId, supervisorId) {
  const { data,error } = await db.rpc('itsos_assign_match_staff',{
    p_match_id:Number(matchId),
    p_scorekeeper:scorekeeperId || null,
    p_supervisor:supervisorId || null,
  });
  if(error) throw new Error('Assegnazione non riuscita: '+error.message);
  return data;
}
