import { initLayout } from './layout.js';

const user = await initLayout();
if (user) {
  document.getElementById('cta-register').classList.add('hidden');
}
