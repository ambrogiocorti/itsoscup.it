// Menu laterale a tendine: ogni gruppo (Panoramica, Preparazione, …) si apre e si chiude.
// Il gruppo della pagina attiva resta aperto; le altre scelte sono ricordate nella sessione.
const STORE_KEY = 'itsoscup_sidebar_open_groups_v1';

const readOpen = () => {
  try { return new Set(JSON.parse(sessionStorage.getItem(STORE_KEY) || '[]')); } catch { return new Set(); }
};
const writeOpen = (set) => {
  try { sessionStorage.setItem(STORE_KEY, JSON.stringify([...set])); } catch { /* memoria non disponibile */ }
};

function setGroupOpen(group, open) {
  group.classList.toggle('is-open', open);
  group.querySelector('.sidebar-group-toggle')?.setAttribute('aria-expanded', String(open));
}

function isLinkVisible(li) {
  return !li.classList.contains('hidden') && !li.hidden && li.querySelector('.sidebar-link:not(.hidden)');
}

/** Nasconde i gruppi senza voci consentite e apre quello della pagina attiva. */
export function syncSidebarGroups(root = document) {
  const open = readOpen();
  root.querySelectorAll('.sidebar-group').forEach((group) => {
    const items = [...group.querySelectorAll('.sidebar-submenu > li')];
    const visible = items.some(isLinkVisible);
    group.hidden = !visible;
    const hasActive = Boolean(group.querySelector('.sidebar-link.active, .sidebar-link[aria-current="page"]'));
    group.classList.toggle('has-active', hasActive);
    setGroupOpen(group, hasActive || open.has(group.dataset.sidebarGroup));
  });
}

export function initSidebarGroups(root = document) {
  const menu = root.querySelector('.sidebar-menu-grouped');
  if (!menu || menu.dataset.groupsReady === '1') { syncSidebarGroups(root); return; }
  menu.dataset.groupsReady = '1';
  menu.addEventListener('click', (event) => {
    const toggle = event.target.closest('.sidebar-group-toggle');
    if (!toggle) return;
    const group = toggle.closest('.sidebar-group');
    const willOpen = !group.classList.contains('is-open');
    setGroupOpen(group, willOpen);
    const open = readOpen();
    if (willOpen) open.add(group.dataset.sidebarGroup); else open.delete(group.dataset.sidebarGroup);
    writeOpen(open);
  });
  syncSidebarGroups(root);
}
