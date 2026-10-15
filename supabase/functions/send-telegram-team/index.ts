type TeamPayload = {
  teamId?: number | string;
};

type AdminRow = {
  id: string;
  ruolo: string;
};

type TeamRow = {
  id: number;
  name: string | null;
  sport_id: number | null;
  sport: { name: string | null } | null;
  players?: Array<{ full_name: string | null; is_captain: boolean | null }>;
};

type MatchRow = {
  id: number;
  round_name: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  home_team_id: number | null;
  away_team_id: number | null;
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

function optionalEnv(name: string, fallback = '') {
  return Deno.env.get(name) || fallback;
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

function buildTeamPageUrl(team: TeamRow) {
  const baseUrl = optionalEnv('PUBLIC_SITE_URL', 'https://itsoscup.it');
  const url = new URL(baseUrl);
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  if (team.sport_id) url.searchParams.set('sport', String(team.sport_id));
  url.searchParams.set('team', String(team.id));
  return url.toString();
}

function buildTeamMessage(team: TeamRow, nextMatch: MatchRow | null) {
  const captain = (team.players ?? []).find((player) => player.is_captain)?.full_name ?? 'Da impostare';
  const lines = [
    `Comunicazione squadra`,
    `Squadra: ${team.name ?? '-'}`,
    `Torneo: ${team.sport?.name ?? '-'}`,
    `Capitano: ${captain}`,
    `Pagina squadra: ${buildTeamPageUrl(team)}`,
  ];

  if (nextMatch) {
    const opponent = Number(nextMatch.home_team_id) === Number(team.id)
      ? nextMatch.away?.name
      : nextMatch.home?.name;
    const end = formatTime(nextMatch.scheduled_end);
    const slot = `${formatDateTime(nextMatch.scheduled_start)}${end ? ` - ${end}` : ''}`;
    lines.push('');
    lines.push(`Prossimo match`);
    lines.push(`Avversario: ${opponent ?? 'TBD'}`);
    lines.push(`Fase: ${nextMatch.round_name ?? '-'}`);
    lines.push(`Orario: ${slot}`);
    lines.push(`Campo: ${nextMatch.venue?.name ?? 'Campo da definire'}`);
  } else {
    lines.push('');
    lines.push('Nessun match programmato al momento.');
  }

  return lines.join('\n');
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

async function buildTemplatedTeamMessage(team: TeamRow, nextMatch: MatchRow | null) {
  const fallback = buildTeamMessage(team, nextMatch);
  const template = await loadCommunicationTemplate('general_notice').catch(() => null);
  if (!template?.body) return fallback;

  const body = applyTemplate(template.body, {
    team: team.name ?? '-',
    sport: team.sport?.name ?? '-',
    message: fallback,
  }).trim();

  return [
    template.title?.trim() || 'Comunicazione squadra',
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
    if (!admin || admin.ruolo !== 'super_admin') {
      return jsonResponse({ sent: false, error: 'Non autorizzato.' }, 403);
    }

    const payload = await request.json().catch(() => ({})) as TeamPayload;
    const teamId = Number(payload.teamId || 0);
    if (!Number.isFinite(teamId) || teamId <= 0) {
      return jsonResponse({ sent: false, error: 'teamId non valido.' }, 400);
    }

    const teams = await supabaseFetch(
      [
        'teams',
        '?select=id,name,sport_id,sport:sports(name),players(full_name,is_captain)',
        `&id=eq.${encodeURIComponent(String(teamId))}`,
        '&limit=1',
      ].join('')
    ) as TeamRow[];

    const team = teams[0];
    if (!team) {
      return jsonResponse({ sent: false, error: 'Squadra non trovata.' }, 404);
    }

    const matches = await supabaseFetch(
      [
        'matches',
        '?select=id,round_name,scheduled_start,scheduled_end,home_team_id,away_team_id,',
        'home:teams!home_team_id(name),away:teams!away_team_id(name),venue:venues(name)',
        `&sport_id=eq.${encodeURIComponent(String(team.sport_id ?? 0))}`,
        '&is_finished=eq.false',
        '&status=neq.cancelled',
        '&order=scheduled_start.asc.nullslast,id.asc',
        '&limit=50',
      ].join('')
    ) as MatchRow[];
    const nextMatch = matches.find(
      (match) => Number(match.home_team_id) === teamId || Number(match.away_team_id) === teamId
    ) ?? null;

    const botToken = requiredEnv('TELEGRAM_BOT_TOKEN');
    const chatId = requiredEnv('TELEGRAM_CHAT_ID');
    const text = await buildTemplatedTeamMessage(team, nextMatch);

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

    await queuePublicTelegramPush(telegramData,'Comunicazione squadra',`${team.sport?.name ?? 'Torneo'} · ${team.name ?? 'Squadra'}: comunicazione pubblicata sul canale ufficiale`);
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
