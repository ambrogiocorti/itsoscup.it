import { APP_CONFIG } from './app-config.js';
import { db } from './db.js';

async function invokeTelegramFunction(functionName, payload) {
  const {
    data: { session },
    error: sessionError,
  } = await db.auth.getSession();

  if (sessionError) {
    throw new Error(`Sessione admin non valida: ${sessionError.message}`);
  }
  if (!session?.access_token) {
    throw new Error('Sessione admin scaduta. Effettua di nuovo il login.');
  }

  let response;
  try {
    response = await fetch(`${APP_CONFIG.supabaseUrl}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: APP_CONFIG.supabaseAnonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new Error(
      `Invio Telegram: richiesta Edge Function non raggiunta. Verifica deploy, CORS e connessione. ${error?.message ?? ''}`.trim()
    );
  }

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_error) {
    data = null;
  }

  if (!response.ok) {
    throw new Error(data?.error || text || `Invio Telegram fallito: HTTP ${response.status}`);
  }

  if (!data?.sent) {
    throw new Error(data?.error || 'Invio Telegram non confermato.');
  }

  return data;
}

export async function sendTelegramMatchReminder(matchId) {
  const numericMatchId = Number(matchId || 0);
  if (!numericMatchId) {
    throw new Error('Match non valido.');
  }

  return invokeTelegramFunction('send-telegram-match', { matchId: numericMatchId });
}

export async function sendTelegramTeamReminder(teamId) {
  const numericTeamId = Number(teamId || 0);
  if (!numericTeamId) {
    throw new Error('Squadra non valida.');
  }

  return invokeTelegramFunction('send-telegram-team', { teamId: numericTeamId });
}
