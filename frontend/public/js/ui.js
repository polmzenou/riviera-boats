import { h } from './api.js';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

// les éléments .reveal apparaissent quand ils entrent dans l'écran
export function reveal(root = document) {
  const items = [...root.querySelectorAll('.reveal:not(.is-visible)')];
  if (reduceMotion || !('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('is-visible'));
    return;
  }
  document.documentElement.classList.add('reveal-ready');
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  for (const el of items) {
    const siblings = [...el.parentElement.children].filter((c) => c.classList.contains('reveal'));
    el.style.setProperty('--d', `${Math.min(siblings.indexOf(el), 6) * 70}ms`);
    observer.observe(el);
  }
}

export function countUp(el, value, format = (n) => String(Math.round(n))) {
  if (reduceMotion) {
    el.textContent = format(value);
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min((now - start) / 1100, 1);
    el.textContent = format(value * (1 - (1 - t) ** 3));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function confirmDialog({ title, message, confirmLabel = 'Confirmer', danger = false }) {
  const ok = h('button', { class: danger ? 'btn btn-danger' : 'btn', type: 'button', 'data-confirm': true }, confirmLabel);
  const cancel = h('button', { class: 'btn btn-ghost', type: 'button' }, 'Annuler');
  const dialog = h('dialog', { class: 'confirm', 'aria-labelledby': 'confirm-title' },
    h('div', { class: 'dlg-body' },
      h('span', { class: danger ? 'confirm-icon danger' : 'confirm-icon', 'aria-hidden': 'true' }, danger ? '!' : '?'),
      h('h2', { id: 'confirm-title' }, title),
      h('p', { class: 'muted' }, message),
      h('div', { class: 'dlg-foot' }, cancel, ok)));
  document.body.append(dialog);
  return new Promise((resolve) => {
    ok.addEventListener('click', () => dialog.close('ok'));
    cancel.addEventListener('click', () => dialog.close('cancel'));
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'ok');
      dialog.remove();
    });
    dialog.showModal();
    cancel.focus();
  });
}
