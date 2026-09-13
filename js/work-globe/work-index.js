import { renderWorkIndex } from './work-index-content.js?v=20260913';

const mount = document.getElementById('work-index');
if (mount && !mount.children.length) mount.innerHTML = renderWorkIndex();
