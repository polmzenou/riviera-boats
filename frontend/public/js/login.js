import { api } from './api.js';
import { initLayout } from './layout.js';

// chemin local uniquement, sinon redirection ouverte
function nextUrl() {
  const next = new URLSearchParams(window.location.search).get('next');
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/boats.html';
}

const user = await initLayout();
if (user) window.location.replace(nextUrl());

const tabs = {
  login: { tab: document.getElementById('tab-login'), form: document.getElementById('login-form') },
  register: { tab: document.getElementById('tab-register'), form: document.getElementById('register-form') },
};

function show(name) {
  for (const [key, { tab, form }] of Object.entries(tabs)) {
    tab.setAttribute('aria-selected', String(key === name));
    form.classList.toggle('hidden', key !== name);
  }
  tabs[name].form.querySelector('input').focus();
}
tabs.login.tab.addEventListener('click', () => show('login'));
tabs.register.tab.addEventListener('click', () => show('register'));
if (window.location.hash === '#register') show('register');

function bind(form, path) {
  const error = form.querySelector('.form-error');
  const button = form.querySelector('button[type="submit"]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';
    button.disabled = true;
    try {
      await api(path, { method: 'POST', body: Object.fromEntries(new FormData(form)), redirectOn401: false });
      window.location.assign(nextUrl());
    } catch (err) {
      error.textContent = err.status === 429 ? 'Trop de tentatives, patientez une minute.' : err.message;
      button.disabled = false;
    }
  });
}

bind(tabs.login.form, '/api/auth/login');
bind(tabs.register.form, '/api/auth/register');
