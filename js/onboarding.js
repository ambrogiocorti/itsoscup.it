const TOUR_PREFIX = 'tornei_tour_done_';

function createTourElements() {
  let overlay = document.getElementById('onboarding-overlay');
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.id = 'onboarding-overlay';
  overlay.className = 'onboarding-overlay';
  overlay.innerHTML = `
    <div class="onboarding-card" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <div class="onboarding-step-count" id="onboarding-count"></div>
      <h2 id="onboarding-title"></h2>
      <p id="onboarding-text"></p>
      <div class="onboarding-actions">
        <button class="btn btn-ghost" type="button" data-tour-skip>Salta</button>
        <button class="btn btn-primary" type="button" data-tour-next>Avanti</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

function clearHighlight() {
  document.querySelectorAll('.onboarding-highlight').forEach((el) => {
    el.classList.remove('onboarding-highlight');
  });
}

function showStep(overlay, steps, index, finish) {
  clearHighlight();
  const step = steps[index];
  const target = step.selector ? document.querySelector(step.selector) : null;
  target?.classList.add('onboarding-highlight');
  target?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });

  overlay.querySelector('#onboarding-count').textContent = `${index + 1} / ${steps.length}`;
  overlay.querySelector('#onboarding-title').textContent = step.title;
  overlay.querySelector('#onboarding-text').textContent = step.text;
  overlay.querySelector('[data-tour-next]').textContent = index === steps.length - 1 ? 'Fine' : 'Avanti';

  overlay.querySelector('[data-tour-next]').onclick = () => {
    if (index >= steps.length - 1) finish();
    else showStep(overlay, steps, index + 1, finish);
  };
  overlay.querySelector('[data-tour-skip]').onclick = finish;
}

export function startTourIfNeeded(pageKey, steps, { force = false } = {}) {
  if (!Array.isArray(steps) || !steps.length) return;
  const storageKey = `${TOUR_PREFIX}${pageKey}`;
  if (!force && window.localStorage.getItem(storageKey) === 'true') return;

  const overlay = createTourElements();
  const finish = () => {
    window.localStorage.setItem(storageKey, 'true');
    clearHighlight();
    overlay.classList.remove('open');
  };

  overlay.classList.add('open');
  showStep(overlay, steps, 0, finish);
}

