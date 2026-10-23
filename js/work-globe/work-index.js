import { renderWorkIndex } from './work-index-content.js';

const mount = document.getElementById('work-index');
if (mount && !mount.children.length) mount.innerHTML = renderWorkIndex();
