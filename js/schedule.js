import { db, run } from './db.js';

export function slugifyVenueName(value) {
  const slug = String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || `campo-${Date.now()}`;
}

export async function loadVenues({ includeInactive = false } = {}) {
  let query = db.from('venues').select('*').order('name', { ascending: true });

  if (!includeInactive) {
    query = query.eq('is_active', true);
  }

  const { data } = await run(query, 'Caricamento campi');
  return data ?? [];
}

export async function loadVenueBySlug(slug) {
  const { data } = await run(
    db.from('venues').select('*').eq('slug', String(slug ?? '')).maybeSingle(),
    'Caricamento campo'
  );
  return data;
}

export async function saveVenue(payload) {
  const name = String(payload?.name ?? '').trim();
  const slug = String(payload?.slug || slugifyVenueName(name)).trim();

  if (!name) {
    throw new Error('Nome campo obbligatorio');
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error('Slug campo non valido. Usa lettere, numeri e trattini.');
  }

  const dataPayload = {
    name,
    slug,
    description: String(payload?.description ?? '').trim() || null,
    is_active: payload?.is_active !== false,
  };

  if (payload?.id) {
    const { data } = await run(
      db.from('venues').update(dataPayload).eq('id', Number(payload.id)).select().single(),
      'Aggiornamento campo'
    );
    return data;
  }

  const { data } = await run(
    db.from('venues').insert(dataPayload).select().single(),
    'Creazione campo'
  );
  return data;
}

export async function deleteVenue(venueId) {
  await run(db.from('venues').delete().eq('id', Number(venueId)), 'Eliminazione campo');
}

export function combineLocalDateTime(dateValue, timeValue) {
  const date = String(dateValue ?? '').trim();
  const time = String(timeValue ?? '').trim();
  if (!date && !time) return null;
  if (!date || !time) {
    throw new Error('Compila sia data sia ora dello slot.');
  }
  return new Date(`${date}T${time}`).toISOString();
}

export function splitIsoForInputs(value) {
  if (!value) return { date: '', time: '' };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: '', time: '' };

  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${min}` };
}

export function formatScheduleRange(match) {
  const start = match?.scheduled_start ? new Date(match.scheduled_start) : null;
  const end = match?.scheduled_end ? new Date(match.scheduled_end) : null;

  if (!start || Number.isNaN(start.getTime())) {
    return 'Da programmare';
  }

  const dateLabel = new Intl.DateTimeFormat('it-IT', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  }).format(start);
  const startLabel = new Intl.DateTimeFormat('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(start);
  const endLabel =
    end && !Number.isNaN(end.getTime())
      ? new Intl.DateTimeFormat('it-IT', {
          hour: '2-digit',
          minute: '2-digit',
        }).format(end)
      : '';

  return endLabel ? `${dateLabel} ${startLabel}-${endLabel}` : `${dateLabel} ${startLabel}`;
}

export function getVenueQrUrl(venue, baseHref = window.location.href) {
  const url = new URL('index.html', baseHref);
  url.searchParams.set('venue', venue.slug);
  return url.toString();
}

export async function loadVenueScheduleBySlug(slug) {
  const venue = await loadVenueBySlug(slug);
  if (!venue) {
    return { venue: null, matches: [] };
  }

  const { data } = await run(
    db
      .from('matches')
      .select('*, venue:venues(id, name, slug), sport:sports(id, name, sport_type, format, year), home:teams!home_team_id(name), away:teams!away_team_id(name)')
      .eq('venue_id', Number(venue.id))
      .neq('status', 'cancelled')
      .order('scheduled_start', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true }),
    'Caricamento calendario campo'
  );

  return { venue, matches: data ?? [] };
}
