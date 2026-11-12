// Podio per evento dell'atletica nell'Albo (area admin e home pubblica).
import { escapeHtml } from './utils.js';
import { formatAthleticsValue } from './athletics-quick-core.js';

const MEDALS = ['gold', 'silver', 'bronze'];
const MEDAL_LABELS = ['1°', '2°', '3°'];

export function getEventPodiums(entry) {
  const list = entry?.archived_snapshot?.event_podiums;
  return Array.isArray(list) ? list.filter((item) => Array.isArray(item?.podium) && item.podium.length) : [];
}

/** @param {(name:string)=>string} formatName per applicare la privacy dei nomi nelle pagine pubbliche */
export function renderEventPodiumsHtml(entry, { formatName = (name) => name, showClass = true } = {}) {
  const podiums = getEventPodiums(entry);
  if (!podiums.length) return '';
  return `<div class="honor-podiums">${podiums.map((event) => `
    <section class="honor-podium" aria-label="Podio ${escapeHtml(event.event_name)}">
      <h4>${escapeHtml(event.event_name)}</h4>
      <ol>${event.podium.map((row, index) => `
        <li class="${MEDALS[index] ?? ''}">
          <span class="honor-medal" aria-hidden="true">${MEDAL_LABELS[index] ?? row.rank}</span>
          <span class="honor-podium-name"><strong>${escapeHtml(formatName(row.player_name))}</strong>${showClass && row.team_name ? `<small>${escapeHtml(row.team_name)}</small>` : ''}</span>
          <span class="honor-podium-value">${escapeHtml(formatAthleticsValue(row.value, event.unit))}</span>
        </li>`).join('')}
      </ol>
    </section>`).join('')}</div>`;
}
