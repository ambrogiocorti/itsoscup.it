type MatchPayload = {
  matchId?: number | string;
};

type AdminRow = {
  id: string;
  ruolo: string;
};

type MatchRow = {
  id: number;
  round_name: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  schedule_notes: string | null;
  is_finished: boolean | null;
  home_score: number | null;
  away_score: number | null;
  sport: { name: string | null } | null;
  home: { name: string | null } | null;
  away: { name: string | null } | null;
  venue: { name: string | null } | null;
};

type TemplateRow = {
  template_key: string;
  title: string | null;
  body: string | null;
  is_active: boolean | null;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Secret mancante: ${name}`);
  return value;
}

async function supabaseFetch(path: string, init: RequestInit = {}) {
  const projectUrl = requiredEnv('SUPABASE_URL');
  const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  const headers = new Headers(init.headers);
  headers.set('apikey', serviceRoleKey);
  headers.set('Authorization', `Bearer ${serviceRoleKey}`);
  headers.set('Content-Type', headers.get('Content-Type') ?? 'application/json');

  const response = await fetch(`${projectUrl}/rest/v1/${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase REST ${response.status}: ${detail}`);
  }

  return response.json();
}

async function loadCallerAdmin(request: Request): Promise<AdminRow | null> {
  const authHeader = request.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  const projectUrl = requiredEnv('SUPABASE_URL');
  const anonKey = requiredEnv('SUPABASE_ANON_KEY');
  const userResponse = await fetch(`${projectUrl}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!userResponse.ok) return null;
  const user = await userResponse.json();
  const userId = String(user?.id ?? '');
  if (!userId) return null;

  const rows = await supabaseFetch(
    `admins?select=id,ruolo&id=eq.${encodeURIComponent(userId)}&limit=1`
  ) as AdminRow[];

  return rows[0] ?? null;
}

function formatDateTime(value: string | null) {
  if (!value) return 'Da programmare';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Da programmare';

  return new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome',
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatTime(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function buildMatchMessage(match: MatchRow) {
  const sport = match.sport?.name ?? 'Torneo';
  const home = match.home?.name ?? 'TBD';
  const away = match.away?.name ?? 'TBD';
  const start = formatDateTime(match.scheduled_start);
  const end = formatTime(match.scheduled_end);
  const slot = end ? `${start} - ${end}` : start;
  const venue = match.venue?.name ?? 'Campo da definire';
  const phase = match.round_name ?? 'Match';
  const notes = String(match.schedule_notes ?? '').trim();

  return [
    `Promemoria match`,
    `${sport} - ${phase}`,
    `${home} vs ${away}`,
    `Orario: ${slot}`,
    `Campo: ${venue}`,
    notes ? `Note: ${notes}` : '',
  ].filter(Boolean).join('\n');
}

function pickMatchTemplateKey(match: MatchRow) {
  if (match.is_finished) return 'final_score';
  const notes = String(match.schedule_notes ?? '').toLowerCase();
  if (notes.includes('rinvi')) return 'match_postponed';
  if (notes.includes('variazione') || notes.includes('cambio')) return 'field_change';
  return 'match_30_min';
}

async function loadCommunicationTemplate(templateKey: string): Promise<TemplateRow | null> {
  const rows = await supabaseFetch(
    [
      'communication_templates',
      '?select=template_key,title,body,is_active',
      `&template_key=eq.${encodeURIComponent(templateKey)}`,
      '&limit=1',
    ].join('')
  ) as TemplateRow[];
  const row = rows[0] ?? null;
  if (!row || row.is_active === false || !String(row.body ?? '').trim()) return null;
  return row;
}

function applyTemplate(body: string, values: Record<string, string>) {
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => values[String(key)] ?? '');
}

async function buildTemplatedMatchMessage(match: MatchRow) {
  const fallback = buildMatchMessage(match);
  const template = await loadCommunicationTemplate(pickMatchTemplateKey(match)).catch(() => null);
  if (!template?.body) return fallback;

  const sport = match.sport?.name ?? 'Torneo';
  const home = match.home?.name ?? 'TBD';
  const away = match.away?.name ?? 'TBD';
  const start = formatDateTime(match.scheduled_start);
  const end = formatTime(match.scheduled_end);
  const slot = end ? `${start} - ${end}` : start;
  const venue = match.venue?.name ?? 'Campo da definire';
  const reason = String(match.schedule_notes ?? '').trim() || 'Aggiornamento organizzativo';
  const body = applyTemplate(template.body, {
    sport,
    home,
    away,
    time: slot,
    venue,
    reason,
    home_score: String(match.home_score ?? 0),
    away_score: String(match.away_score ?? 0),
  }).trim();

  return [
    template.title?.trim() || 'Comunicazione match',
    body,
  ].filter(Boolean).join('\n');
}


async function queuePublicTelegramPush(result: any, title: string, body: string) {
  const msg=result?.result;
  if(!msg?.message_id||!msg?.chat?.id)return;
  const base=requiredEnv('SUPABASE_URL'),secret=requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  const key=['telegram',msg.chat.id,msg.message_id,msg.date||0].join('-');
  try{
    const response=await fetch(base+'/rest/v1/itsos_push_events?on_conflict=event_key',{
      method:'POST',headers:{
        apikey:secret,Authorization:'Bearer '+secret,'Content-Type':'application/json',
        Prefer:'resolution=ignore-duplicates,return=minimal'
      },
      body:JSON.stringify({source:'telegram',event_key:key,title:title.slice(0,100),
        body:body.slice(0,210),href:'/',team_ids:[]})
    });
    if(!response.ok)console.error('Push event queue HTTP',response.status);
  }catch(error){console.error('Push event queue unavailable',String(error))}
}
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ sent: false, error: 'Metodo non consentito.' }, 405);
  }

  try {
    const admin = await loadCallerAdmin(request);
    if (!admin || !['super_admin', 'match_manager'].includes(admin.ruolo)) {
      return jsonResponse({ sent: false, error: 'Non autorizzato.' }, 403);
    }

    const payload = await request.json().catch(() => ({})) as MatchPayload;
    const matchId = Number(payload.matchId || 0);
    if (!Number.isFinite(matchId) || matchId <= 0) {
      return jsonResponse({ sent: false, error: 'matchId non valido.' }, 400);
    }

    if(admin.ruolo==='match_manager'){
      const assigned=await supabaseFetch('match_staff_assignments?select=id&match_id=eq.'+matchId+
       '&admin_id=eq.'+encodeURIComponent(admin.id)+'&role=in.(scorekeeper,supervisor)&limit=1') as Array<{id:number}>;
      if(!assigned.length)return jsonResponse({sent:false,error:'Partita non assegnata'},403);
    }

    const matches = await supabaseFetch(
      [
        'matches',
        '?select=id,round_name,scheduled_start,scheduled_end,schedule_notes,is_finished,home_score,away_score,',
        'sport:sports(name),home:teams!home_team_id(name),away:teams!away_team_id(name),venue:venues(name)',
        `&id=eq.${encodeURIComponent(String(matchId))}`,
        '&limit=1',
      ].join('')
    ) as MatchRow[];

    const match = matches[0];
    if (!match) {
      return jsonResponse({ sent: false, error: 'Match non trovato.' }, 404);
    }

    const botToken = requiredEnv('TELEGRAM_BOT_TOKEN');
    const chatId = requiredEnv('TELEGRAM_CHAT_ID');
    const text = await buildTemplatedMatchMessage(match);

    const telegramResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    });

    const telegramData = await telegramResponse.json().catch(() => ({}));
    if (!telegramResponse.ok || telegramData?.ok !== true) {
      const description = telegramData?.description || `HTTP ${telegramResponse.status}`;
      return jsonResponse({ sent: false, error: `Telegram: ${description}` }, 502);
    }

    await queuePublicTelegramPush(telegramData,'Promemoria partita', `${match.sport?.name ?? 'Torneo'} · ${match.home?.name ?? 'Casa'} vs ${match.away?.name ?? 'Ospiti'} · ${formatDateTime(match.scheduled_start)}`);
    return jsonResponse({
      sent: true,
      messageId: telegramData?.result?.message_id ?? null,
    });
  } catch (error) {
    return jsonResponse(
      { sent: false, error: error instanceof Error ? error.message : 'Errore invio Telegram.' },
      500
    );
  }
});
