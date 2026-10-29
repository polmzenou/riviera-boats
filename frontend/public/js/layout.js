import { api, h } from './api.js';
import { initials, reveal } from './ui.js';

const LINKS = [
  { href: '/', label: 'Accueil', public: true },
  { href: '/boats.html', label: 'Bateaux' },
  { href: '/bookings.html', label: 'Mes réservations' },
  { href: '/account.html', label: 'Mon compte' },
  { href: '/admin.html', label: 'Admin', admin: true },
];

function setupHeader() {
  const header = document.querySelector('.site-header');
  const toggle = h('button', { class: 'nav-toggle', type: 'button', 'aria-label': 'Menu', 'aria-expanded': 'false' }, h('span', { class: 'bars' }));
  toggle.addEventListener('click', () => {
    toggle.setAttribute('aria-expanded', String(header.classList.toggle('nav-open')));
  });
  header.querySelector('.nav').before(toggle);

  const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 24);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
}

export async function initLayout() {
  setupHeader();
  reveal();

  let user = null;
  try {
    const data = await api('/api/auth/me', { redirectOn401: false });
    user = data.user;
  } catch {
    user = null;
  }

  const here = window.location.pathname === '/index.html' ? '/' : window.location.pathname;
  const nav = document.querySelector('.nav');
  nav.replaceChildren(
    ...LINKS.filter((l) => l.public || (user && (!l.admin || user.role === 'admin'))).map((l) =>
      h('a', { href: l.href, 'aria-current': l.href === here ? 'page' : null }, l.label),
    ),
  );

  const box = document.querySelector('.user-box');
  if (user) {
    const logout = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, 'Déconnexion');
    logout.addEventListener('click', async () => {
      await api('/api/auth/logout', { method: 'POST', redirectOn401: false });
      window.location.assign('/');
    });
    box.replaceChildren(...[
      h('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(user.fullName)),
      h('span', { class: 'who' }, user.fullName),
      user.role === 'admin' ? h('span', { class: 'badge-admin' }, 'admin') : null,
      logout,
    ].filter(Boolean));
  } else {
    box.replaceChildren(h('a', { class: 'btn btn-gold btn-sm', href: '/login.html' }, 'Connexion'));
  }
  return user;
}
