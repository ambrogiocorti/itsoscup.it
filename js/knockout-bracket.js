/**
 * knockout-bracket.js
 * Professional elimination bracket renderer.
 * Produces structured round lanes with cards positioned over an SVG connector layer.
 */

const ROUND_ORDER = {
  girone: 0,
  sedicesimi: 100,
  ottavi: 200,
  quarti: 300,
  semifinale: 400,
  terzo_posto: 480,
  finale: 500,
  other: 1000,
};

const CARD_WIDTH = 256;
const CARD_HEIGHT = 126;
const ROUND_GAP = 78;
const ROW_STEP = 152;
const HEADER_HEIGHT = 72;
const SIDE_PADDING = 18;
const BOTTOM_PADDING = 28;

export function buildKnockoutBracket({ matches }) {
  const rows = (matches ?? []).filter(Boolean);
  const byRound = new Map();

  for (const match of rows) {
    const meta = getRoundMeta(match?.round_name);
    if (!byRound.has(meta.key)) {
      byRound.set(meta.key, {
        roundName: meta.label,
        roundType: meta.type,
        roundLabel: meta.label,
        order: meta.order,
        matches: [],
      });
    }
    byRound.get(meta.key).matches.push(match);
  }

  return [...byRound.values()]
    .sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return a.roundLabel.localeCompare(b.roundLabel, 'it', { sensitivity: 'base' });
    })
    .map((round) => ({
      roundName: round.roundName,
      roundType: round.roundType,
      roundLabel: round.roundLabel,
      matches: [...round.matches].sort(compareMatchesForBracket),
    }));
}

export function renderKnockoutBracketHtml({ rounds }) {
  const normalizedRounds = (rounds ?? []).filter((round) => (round?.matches ?? []).length > 0);
  if (!normalizedRounds.length) {
    return '<div class="kb-empty">Nessun turno disponibile.</div>';
  }

  const baseSlots = Math.max(
    1,
    ...normalizedRounds.map((round, roundIdx) => round.matches.length * Math.max(1, 2 ** roundIdx))
  );
  const boardWidth =
    SIDE_PADDING * 2 +
    normalizedRounds.length * CARD_WIDTH +
    Math.max(0, normalizedRounds.length - 1) * ROUND_GAP;
  const boardHeight = HEADER_HEIGHT + baseSlots * ROW_STEP + BOTTOM_PADDING;
  const positions = buildPositions({ rounds: normalizedRounds, baseSlots });

  const roundChrome = normalizedRounds
    .map((round, roundIdx) => {
      const x = getRoundX(roundIdx);
      return `
        <div class="kb-round-track" style="left:${x}px; width:${CARD_WIDTH}px;"></div>
        <div class="kb-round-heading" style="left:${x}px; width:${CARD_WIDTH}px;">
          <span class="kb-round-eyebrow">Turno ${roundIdx + 1}</span>
          <strong>${escHtml(round.roundLabel)}</strong>
          <span>${round.matches.length} ${round.matches.length === 1 ? 'partita' : 'partite'}</span>
        </div>
      `;
    })
    .join('');

  const connectors = buildConnectorPaths({ rounds: normalizedRounds, positions });
  const cards = normalizedRounds
    .flatMap((round, roundIdx) =>
      round.matches.map((match, matchIdx) => renderMatchCard({
        match,
        round,
        matchIdx,
        position: positions[roundIdx][matchIdx],
      }))
    )
    .join('');

  return `
    <div
      class="kb-bracket-google"
      style="--kb-board-width:${boardWidth}px; --kb-board-height:${boardHeight}px;">
      ${roundChrome}
      <svg
        class="kb-connector-svg"
        viewBox="0 0 ${boardWidth} ${boardHeight}"
        width="${boardWidth}"
        height="${boardHeight}"
        aria-hidden="true"
        focusable="false">
        ${connectors}
      </svg>
      ${cards}
    </div>
  `;
}

function renderMatchCard({ match, round, matchIdx, position }) {
  const homeName = match?.home?.name ?? null;
  const awayName = match?.away?.name ?? null;
  const status = getMatchStatus(match);
  const showScore = status.key === 'final' || status.key === 'live';
  const homeScore = numberOrNull(match?.home_score);
  const awayScore = numberOrNull(match?.away_score);
  const hasWinner = status.key === 'final' && homeScore !== null && awayScore !== null && homeScore !== awayScore;
  const homeWinner = hasWinner && homeScore > awayScore;
  const awayWinner = hasWinner && awayScore > homeScore;
  const stage = match?.round_name || round?.roundLabel || `Match ${matchIdx + 1}`;
  const schedule = formatCardDate(match);
  const venue = match?.venue?.name ?? 'Campo da definire';
  const title = `${stage} - ${homeName || 'Da definire'} vs ${awayName || 'Da definire'} - ${venue}`;

  return `
    <button
      type="button"
      class="kb-match-card kb-status-${status.key}${!homeName && !awayName ? ' kb-match-tbd' : ''}"
      style="left:${position.x}px; top:${position.top}px;"
      data-match-id="${escAttr(match?.id ?? '')}"
      title="${escAttr(title)}"
      aria-label="${escAttr(title)}">
      <span class="kb-card-head">
        <span class="kb-match-code">${escHtml(stage)}</span>
        <span class="kb-status-chip">${escHtml(status.shortLabel)}</span>
      </span>
      <span class="kb-teams">
        ${buildTeamRow({
          name: homeName,
          score: showScore ? homeScore : null,
          isWinner: homeWinner,
          isLoser: hasWinner && awayWinner,
        })}
        ${buildTeamRow({
          name: awayName,
          score: showScore ? awayScore : null,
          isWinner: awayWinner,
          isLoser: hasWinner && homeWinner,
        })}
      </span>
      <span class="kb-card-meta">
        <span class="kb-match-date">${escHtml(schedule)}</span>
        <span class="kb-match-venue">${escHtml(venue)}</span>
      </span>
    </button>
  `;
}

function buildTeamRow({ name, score, isWinner, isLoser }) {
  const classes = ['kb-team-row'];
  if (isWinner) classes.push('kb-winner');
  if (isLoser) classes.push('kb-loser');

  const label = name || 'Da definire';
  const scoreLabel = score !== null && score !== undefined ? String(score) : '-';
  const color = getTeamColor(label);

  return `
    <span class="${classes.join(' ')}">
      <span class="kb-team-flag" style="--kb-team-color:${color};"></span>
      <span class="kb-team-name">${escHtml(label)}</span>
      <span class="kb-team-score${isWinner ? ' kb-score-winner' : ''}">${escHtml(scoreLabel)}</span>
    </span>
  `;
}

function buildPositions({ rounds, baseSlots }) {
  return rounds.map((round, roundIdx) => {
    const count = Math.max(1, round.matches.length);
    const spacing = baseSlots / count;
    const x = getRoundX(roundIdx);

    return round.matches.map((_, matchIdx) => {
      const centerY = HEADER_HEIGHT + (matchIdx + 0.5) * spacing * ROW_STEP;
      return {
        x,
        centerY,
        top: centerY - CARD_HEIGHT / 2,
      };
    });
  });
}

function buildConnectorPaths({ rounds, positions }) {
  const paths = [];

  for (let roundIdx = 0; roundIdx < rounds.length - 1; roundIdx += 1) {
    const current = positions[roundIdx] ?? [];
    const next = positions[roundIdx + 1] ?? [];
    if (!current.length || !next.length) continue;

    current.forEach((from, matchIdx) => {
      const nextIdx = Math.min(next.length - 1, Math.floor((matchIdx * next.length) / current.length));
      const to = next[nextIdx];
      const x1 = from.x + CARD_WIDTH;
      const x2 = to.x;
      const midX = x1 + ROUND_GAP / 2;
      const y1 = from.centerY;
      const y2 = to.centerY;

      paths.push(`<path d="M ${x1} ${y1} H ${midX} V ${y2} H ${x2}" />`);
    });
  }

  return paths.join('');
}

function getRoundX(roundIdx) {
  return SIDE_PADDING + roundIdx * (CARD_WIDTH + ROUND_GAP);
}

function getRoundMeta(rawName) {
  const originalName = String(rawName ?? '').trim();
  const fallbackLabel = originalName || 'Turno';
  const normalized = normalizeText(originalName);

  if (normalized.includes('girone')) {
    const letterMatch = normalized.match(/girone[^a-z0-9]*([a-z])/);
    const letter = (letterMatch?.[1] ?? '').toUpperCase();
    const letterOrder = letter ? letter.charCodeAt(0) - 'A'.charCodeAt(0) : 99;
    return {
      key: `girone-${letter || 'x'}`,
      type: 'girone',
      order: ROUND_ORDER.girone + letterOrder,
      label: letter ? `Girone ${letter}` : 'Gironi',
    };
  }

  if (normalized.includes('sedicesimi')) {
    return { key: 'sedicesimi', type: 'sedicesimi', order: ROUND_ORDER.sedicesimi, label: 'Sedicesimi di finale' };
  }
  if (normalized.includes('ottavi')) {
    return { key: 'ottavi', type: 'ottavi', order: ROUND_ORDER.ottavi, label: 'Ottavi di finale' };
  }
  if (normalized.includes('quarti')) {
    return { key: 'quarti', type: 'quarti', order: ROUND_ORDER.quarti, label: 'Quarti di finale' };
  }
  if (normalized.includes('semifinale') || normalized.includes('semi')) {
    return { key: 'semifinale', type: 'semifinale', order: ROUND_ORDER.semifinale, label: 'Semifinali' };
  }
  if ((normalized.includes('terzo') || normalized.includes('3')) && normalized.includes('posto')) {
    return { key: 'terzo-posto', type: 'terzo_posto', order: ROUND_ORDER.terzo_posto, label: 'Finale 3o posto' };
  }
  if (normalized.includes('finale')) {
    return { key: 'finale', type: 'finale', order: ROUND_ORDER.finale, label: 'Finale' };
  }

  return {
    key: `other-${normalizeKey(fallbackLabel)}`,
    type: 'other',
    order: ROUND_ORDER.other,
    label: fallbackLabel,
  };
}

function compareMatchesForBracket(a, b) {
  const aRoundNumber = extractFirstNumber(a?.round_name);
  const bRoundNumber = extractFirstNumber(b?.round_name);
  if (aRoundNumber !== bRoundNumber) return aRoundNumber - bRoundNumber;

  const aStart = dateValue(a?.scheduled_start);
  const bStart = dateValue(b?.scheduled_start);
  if (aStart !== bStart) return aStart - bStart;

  return Number(a?.id ?? 0) - Number(b?.id ?? 0);
}

function getMatchStatus(match) {
  if (match?.is_finished) return { key: 'final', label: 'Concluso', shortLabel: 'FINE' };
  const rawStatus = normalizeText(match?.status);
  if (rawStatus.includes('live') || rawStatus.includes('corso')) {
    return { key: 'live', label: 'In corso', shortLabel: 'IN DIRETTA' };
  }
  if (match?.scheduled_start) return { key: 'scheduled', label: 'Programmato', shortLabel: 'PROG' };
  return { key: 'pending', label: 'Da definire', shortLabel: 'DA DEFINIRE' };
}

function formatCardDate(match) {
  const start = match?.scheduled_start ? new Date(match.scheduled_start) : null;
  if (!start || Number.isNaN(start.getTime())) return 'Da definire';

  const datePart = new Intl.DateTimeFormat('it-IT', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  })
    .format(start)
    .replace(',', '');

  const timePart = new Intl.DateTimeFormat('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(start);

  return `${datePart}, ${timePart}`;
}

function getTeamColor(name) {
  const palette = [
    '#d93025',
    '#1a73e8',
    '#188038',
    '#f9ab00',
    '#9334e6',
    '#00acc1',
    '#e8710a',
    '#5f6368',
    '#c5221f',
    '#0b57d0',
  ];
  let hash = 0;
  for (const char of String(name ?? '')) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return palette[hash % palette.length];
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function extractFirstNumber(value) {
  const match = String(value ?? '').match(/\d+/);
  return match ? Number(match[0]) : 9999;
}

function dateValue(value) {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? Number.MAX_SAFE_INTEGER : date.getTime();
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function normalizeKey(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'turno';
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(str) {
  return escHtml(str).replace(/'/g, '&#039;');
}

export function renderKnockoutBracketSvg({ rounds }) {
  return renderKnockoutBracketHtml({ rounds });
}
