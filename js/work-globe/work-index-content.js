import { WORK_LOCATIONS } from './data/work-locations.js?v=20260711';
import { PROJECTS } from './data/projects.js?v=20260711';

function escape(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

export function renderProjectLinks() {
  return PROJECTS.map(project => `<a href="${escape(project.github)}" target="_blank" rel="noopener noreferrer">${escape(project.name)}</a>`).join('\n');
}

export function renderWorkIndex() {
  const work = Object.values(WORK_LOCATIONS).flatMap(location => location.entries.map(entry => `
    <li class="work-index-entry">
      <h3>${escape(entry.company)}</h3>
      <p class="work-index-meta">${escape([entry.position, entry.period, location.name].filter(Boolean).join(' | '))}</p>
      <ul>${(entry.responsibilities || []).map(task => `<li>${escape(task)}</li>`).join('')}</ul>
    </li>`)).join('');
  const projects = PROJECTS.map(project => `
    <li class="work-index-entry">
      <h3>${escape(project.name)}</h3>
      <p>${escape(project.description)}</p>
      <p class="work-index-meta">${escape(project.tech.join(' | '))}</p>
      <a class="work-index-link" href="${escape(project.github)}" target="_blank" rel="noopener noreferrer">View on GitHub</a>
    </li>`).join('');
  return `<h2 class="work-index-title">Work history</h2><ul class="work-index-list">${work}</ul>
    <h2 class="work-index-title">Projects</h2><ul class="work-index-list">${projects}</ul>`;
}
