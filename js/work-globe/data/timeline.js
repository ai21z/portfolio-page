// Current roles use a future sortKey to stay above completed work.

export const TIMELINE = [
  {
    id: 'adp',
    type: 'work',
    dates: '2024 - present',
    sortKey: 2026.9,
    title: 'ADP',
    subtitle: 'Software Engineer · Barcelona',
    summary: 'Software Engineer on the Lyric HCM payroll platform. Cross-region integrations under strict compliance, with runbooks and ADRs.',
    target: { kind: 'location', id: 'spain' }
  },
  {
    id: 'talos',
    type: 'project',
    dates: '2025 - present',
    sortKey: 2026.6,
    title: 'Talos',
    subtitle: 'Local workspace operator',
    summary: 'Installable local-first Java workspace operator with bounded tools, approval gates, local model backends and durable traces.',
    site: 'https://taloslocal.com/',
    target: { kind: 'moon', id: 'talos-cli' }
  },
  {
    id: 'true-rolls',
    type: 'project',
    dates: '2025 - present',
    sortKey: 2026.55,
    title: 'TrueRolls',
    subtitle: 'Verifiable tabletop rolls',
    summary: 'Verifiable dice with Ed25519-signed drand receipts that replay offline. Witnessed fairness against operator suppression is the v2 goal.',
    target: { kind: 'moon', id: 'true-rolls' }
  },
  {
    id: 'data-annotation',
    type: 'work',
    dates: '2024',
    sortKey: 2024.9,
    title: 'DataAnnotation',
    subtitle: 'AI model evaluation · remote',
    summary: 'Evaluating AI models on code generation and reasoning. Prompt, rubric and acceptance-test design for coding tasks.',
    target: { kind: 'location', id: 'spain' }
  },
  {
    id: 'netcompany',
    type: 'work',
    dates: '2022 - 2024',
    sortKey: 2024.2,
    title: 'Netcompany-Intrasoft',
    subtitle: 'Software Engineer · remote',
    summary: 'Full-stack work on EU statistical platforms. Java and Spring on the back, React and Angular on the front.',
    target: { kind: 'location', id: 'greece' }
  },
  {
    id: 'freelance-turn',
    type: 'work',
    dates: '2017 - 2022',
    sortKey: 2022.99,
    title: 'The turn to software',
    subtitle: 'Freelance · Greece',
    summary: 'Project-based data analysis, dashboards, reporting, localization and digital work for private clients while transitioning into software.',
    target: { kind: 'location', id: 'greece' }
  },
  {
    id: 'msc',
    type: 'cert',
    dates: '2019 - 2021',
    sortKey: 2021.99,
    title: 'M.Sc. Computer Software Engineering',
    subtitle: 'University of Thessaly',
    summary: 'Postgraduate degree in software engineering.',
    target: null
  },
  {
    id: 'cert-oracle-sql',
    type: 'cert',
    dates: '2018',
    sortKey: 2018.6,
    title: 'Oracle SQL: Database Design & Programming',
    subtitle: 'Certification',
    summary: 'Relational database design and SQL programming.',
    target: null
  },
  {
    id: 'beng',
    type: 'cert',
    dates: '2009 - 2015',
    sortKey: 2015,
    title: 'B.Eng Environmental Engineering',
    subtitle: 'University of Western Macedonia',
    summary: 'Undergraduate engineering degree. Labs, chemistry and environmental reporting.',
    target: null
  }
];
