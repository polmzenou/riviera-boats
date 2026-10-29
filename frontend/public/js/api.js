export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function api(path, { method = 'GET', body, redirectOn401 = true } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null;

  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && redirectOn401) {
    // session expirée
    window.location.assign(`/login.html?next=${encodeURIComponent(window.location.pathname)}`);
  }
  if (!res.ok) {
    const details = Array.isArray(data.details) ? data.details.map((d) => `${d.field} : ${d.message}`).join(', ') : '';
    throw new ApiError(res.status, data.error ?? `Erreur ${res.status}`, details);
  }
  return data;
}

// pas d'innerHTML : les données de l'API sont insérées en texte
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

const euroFmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const euroRoundFmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
export const euro = (n) => (Number.isInteger(n) ? euroRoundFmt : euroFmt).format(n);

const toDate = (iso) => new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const frDate = (iso) => (iso ? dateFmt.format(toDate(iso)) : '');

const monthFmt = new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'UTC' });
export function dateParts(iso) {
  const d = toDate(iso);
  return { day: d.getUTCDate(), month: monthFmt.format(d).replace('.', '') };
}

export function todayIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function toast(message, type = 'info') {
  let zone = document.querySelector('.toast-zone');
  if (!zone) {
    zone = h('div', { class: 'toast-zone', role: 'status', 'aria-live': 'polite' });
    document.body.append(zone);
  }
  const el = h('div', { class: `toast ${type}` }, message);
  zone.append(el);
  setTimeout(() => el.remove(), 4500);
}

const BOAT_TYPES = ['voilier', 'catamaran', 'yacht', 'semi-rigide', 'moteur'];
export const boatArt = (type) => `/img/boats/${BOAT_TYPES.includes(type) ? type : 'voilier'}.svg`;

export const STATUS_LABEL = { pending: 'En attente de paiement', paid: 'Payée', cancelled: 'Annulée' };
