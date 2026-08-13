/**
 * knockout-bracket.js
 * Google-World-Cup-style elimination bracket renderer.
 * Produces clean HTML (not SVG) with CSS connectors.
 */

// ─── Data Builder ────────────────────────────────────────────────────────────

export function buildKnockoutBracket({ matches }) {
  const rows = (matches ?? []).filter(Boolean);

  const byRound = new Map();
  for (const m of rows) {
    const roundName = String(m.round_name ?? '').trim();
    if (!roundName) continue;
    if (!byRound.has(roundName)) byRound.set(roundName, []);
    byRound.get(roundName).push(m);
  }

  const roundNames = [...byRound.keys()];

  const getRoundTypeAndOrder = (rawName) => {
    const name = String(rawName ?? '').trim();
    const s = name.toLowerCase();

    // GIRONE A/B/C/D/...
    if (s.includes('girone')) {
      const letterMatch = s.match(/girone[^a-z0-9]?([a-z])/i);
      const letter = (letterMatch?.[1] ?? '').toUpperCase();
      const letterOrder = letter ? letter.charCodeAt(0) - 'A'.charCodeAt(0) : 999;

      return {
        type: 'girone',
        order: 0 + letterOrder,
        label: letter ? `Gironi · ${letter}` : 'Gironi',
      };
    }

    // SEDICESIMI / OTTAVI / QUARTI / SEMIFINALI / FINALE
    if (s.includes('sedicesimi')) return { type: 'sedicesimi', order: 100, label: 'Sedicesimi di finale' };
    if (s.includes('ottavi')) return { type: 'ottavi', order: 200, label: 'Ottavi di finale' };
    if (s.includes('quarti')) return { type: 'quarti', order: 300, label: 'Quarti di finale' };
    if (s.includes('semifinale') || s.includes('semi')) return { type: 'semifinale', order: 400, label: 'Semifinale' };
    if (s.includes('finale')) return { type: 'finale', order: 500, label: 'Finale' };

    return { type: 'other', order: 1000, label: name };
  };

  const roundMeta = roundNames.map((roundName) => ({
    roundName,
    meta: getRoundTypeAndOrder(roundName),
    matches: byRound.get(roundName) ?? [],
  }));

  roundMeta.sort((a, b) => {
    if (a.meta.order !== b.meta.order) return a.meta.order - b.meta.order;

    const aFirst = a.matches[0]?.id ?? 0;
    const bFirst = b.matches[0]?.id ?? 0;
    if (aFirst !== bFirst) return aFirst - bFirst;

    return a.roundName.localeCompare(b.roundName, 'it', { sensitivity: 'base' });
  });

  return roundMeta.map(({ roundName, matches, meta }) => ({
    roundName,
    roundType: meta.type,
    roundLabel: meta.label,
    matches: [...matches].sort((a, b) => Number(a.id) - Number(b.id)),
  }));
}

// ─── HTML Renderer ────────────────────────────────────────────────────────────

/**
 * Returns an HTML string for the Google-style bracket.
 * Structure: [round col] [connector col] [round col] [connector col] ... [final col]
 */
export function renderKnockoutBracketHtml({ rounds }) {
  if (!rounds || rounds.length === 0) {
    return '<div class="kb-empty">Nessun turno disponibile.</div>';
  }

  const columns = []; // alternating: round-col, connector-col

  rounds.forEach((round, roundIdx) => {
    const isLastRound = roundIdx === rounds.length - 1;
    const label = getRoundLabel(round.roundName, round.matches.length);

    // Build match cards for this round
    const matchCards = round.matches.map((match) => {
      const home = match?.home?.name ?? null;
      const away = match?.away?.name ?? null;
      const finished = Boolean(match?.is_finished);
      const homeScore = match?.home_score ?? null;
      const awayScore = match?.away_score ?? null;
      const metaParts = [
        finished ? 'Finale' : match?.status === 'live' ? 'Live' : 'Da giocare',
        formatScheduleRange(match),
        match?.venue?.name ?? null,
      ].filter(Boolean);

      let homeWinner = false;
      let awayWinner = false;
      if (finished && homeScore !== null && awayScore !== null) {
        if (Number(homeScore) > Number(awayScore)) homeWinner = true;
        else if (Number(awayScore) > Number(homeScore)) awayWinner = true;
      }

      return `
        <div class="kb-match-wrap">
          <div class="kb-match-card${finished ? ' kb-match-finished' : ''}${!home && !away ? ' kb-match-tbd' : ''}"
               data-match-id="${match?.id ?? ''}">
            ${buildTeamRow({ name: home, score: finished ? homeScore : null, isWinner: homeWinner, isLoser: finished && !homeWinner && awayWinner })}
            <div class="kb-match-divider"></div>
            ${buildTeamRow({ name: away, score: finished ? awayScore : null, isWinner: awayWinner, isLoser: finished && !awayWinner && homeWinner })}
            <div class="kb-match-meta">${escHtml(metaParts.join(' · '))}</div>
          </div>
        </div>
      `;
    }).join('');

    // Round column
    columns.push(`
      <div class="kb-round" data-round-index="${roundIdx}">
        <div class="kb-round-label">${label}</div>
        <div class="kb-round-matches">
          ${matchCards}
        </div>
      </div>
    `);

    // Add connector column between rounds (except after last)
    if (!isLastRound) {
      const nextMatchCount = rounds[roundIdx + 1]?.matches?.length ?? 1;
      const pairCount = round.matches.length; // pairs feeding into next round
      // Generate one bracket arm per pair (every 2 current-round matches)
      const arms = Array.from({ length: Math.ceil(pairCount / 2) }).map((_, i) =>
        `<div class="kb-arm"></div>`
      ).join('');

      columns.push(`
        <div class="kb-connector-col">
          ${arms}
        </div>
      `);
    }
  });

  return `<div class="kb-bracket-google">${columns.join('')}</div>`;
}

function buildTeamRow({ name, score, isWinner, isLoser }) {
  const classes = [
    'kb-team-row',
    isWinner ? 'kb-winner' : '',
    isLoser ? 'kb-loser' : '',
  ].filter(Boolean).join(' ');

  const nameHtml = name
    ? `<span class="kb-team-name">${escHtml(name)}</span>`
    : `<span class="kb-team-name kb-team-tbd-text">Da definire</span>`;

  const hasScore = score !== null && score !== undefined;
  const scoreHtml = hasScore
    ? `<span class="kb-team-score${isWinner ? ' kb-score-winner' : ''}">${score}</span>`
    : `<span class="kb-team-score kb-score-empty">–</span>`;

  return `
    <div class="${classes}">
      ${nameHtml}
      ${scoreHtml}
    </div>
  `;
}

function getRoundLabel(roundName, matchCount) {
  const s = String(roundName ?? '').trim();
  if (s) return escHtml(s);
  if (matchCount === 1) return 'Finale';
  if (matchCount === 2) return 'Semifinali';
  if (matchCount === 4) return 'Quarti di Finale';
  if (matchCount === 8) return 'Ottavi di Finale';
  if (matchCount === 16) return 'Sedicesimi';
  return `Turno (${matchCount})`;
}

function formatScheduleRange(match) {
  const start = match?.scheduled_start ? new Date(match.scheduled_start) : null;
  if (!start || Number.isNaN(start.getTime())) return null;

  const startDate = new Intl.DateTimeFormat('it-IT', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(start);
  const end = match?.scheduled_end ? new Date(match.scheduled_end) : null;
  if (!end || Number.isNaN(end.getTime())) return startDate;

  const endTime = new Intl.DateTimeFormat('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(end);
  return `${startDate}-${endTime}`;
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Legacy SVG shim ─────────────────────────────────────────────────────────

export function renderKnockoutBracketSvg({ rounds }) {
  return renderKnockoutBracketHtml({ rounds });
}
