import { initLayout } from './layout.js';

const user = await initLayout();
if (user) {
  document.getElementById('cta-register').classList.add('hidden');
}

// sans session, nginx redirige vers le login sans encoder la query string dans next :
// on passe donc nous-mêmes par le login pour garder tous les filtres
document.getElementById('search').addEventListener('submit', (event) => {
  event.preventDefault();
  const params = new URLSearchParams();
  for (const [key, value] of new FormData(event.target)) if (value) params.set(key, value);
  const target = `/boats.html${params.size ? `?${params}` : ''}`;
  window.location.assign(user ? target : `/login.html?next=${encodeURIComponent(target)}`);
});
