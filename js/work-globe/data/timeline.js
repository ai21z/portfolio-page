// Career core-sample: every milestone the Work rail renders, newest (surface) first.
//
// type     'work'    cone  -> focuses a globe location  (Earth turns, pin ignites)
//          'project' moon  -> frames a globe moon        (camera eases over, others dim)
//          'cert'    seal  -> bubble only, globe idle     (degrees + certifications)
// target   { kind: 'location' | 'moon', id } drives the globe on click; null = bubble only.
// sortKey  most-recent year of activity (present roles use a future value so they top the
//          column). The rail renders in descending sortKey order; the array is already sorted.
// dates    the label shown on the node, kept as a real range so "when I started" stays visible.

export const TIMELINE = [
  {
    id: 'adp',
    type: 'work',
    dates: '2024 — present',
    sortKey: 2026.9,
    title: 'ADP',
    subtitle: 'Software Engineer · Barcelona',
    summary: 'Software Engineer on the Lyric HCM payroll platform. Cross-region integrations under strict compliance, with runbooks and ADRs.',
    target: { kind: 'location', id: 'spain' }
  },
  {
    id: 'talos',
    type: 'project',
    dates: '2024 — present',
    sortKey: 2026.6,
    title: 'Talos',
    subtitle: 'Local workspace operator',
    summary: 'Local-first Java CLI workspace operator. Bounded tools, approval gates and traceable runs keep changes private and reproducible.',
    target: { kind: 'moon', id: 'talos-cli' }
  },
  {
    id: 'true-rolls',
    type: 'project',
    dates: '2024 — present',
    sortKey: 2026.55,
    title: 'True-Rolls',
    subtitle: 'Verifiable tabletop rolls',
    summary: 'Provably-fair dice rolls. A ChaCha20 RNG with HKDF key separation gives signed receipts, so any roll verifies after the fact.',
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
    dates: '2022 — 2024',
    sortKey: 2024.2,
    title: 'Netcompany-Intrasoft',
    subtitle: 'Software Engineer · remote',
    summary: 'Full-stack work on EU statistical platforms. Java and Spring on the back, React and Angular on the front.',
    target: { kind: 'location', id: 'greece' }
  },
  {
    id: 'cert-junit-mockito',
    type: 'cert',
    dates: '2024',
    sortKey: 2024.15,
    title: 'Testing Java with JUnit5 & Mockito',
    subtitle: 'Udemy',
    summary: 'Test-driven development in Java with JUnit5 and Mockito.',
    target: null
  },
  {
    id: 'cert-oci-foundations',
    type: 'cert',
    dates: '2023',
    sortKey: 2023.7,
    title: 'Oracle Cloud Infrastructure 2023 Foundations',
    subtitle: 'Oracle',
    summary: 'Certified Foundations Associate. Core Oracle Cloud Infrastructure services and architecture.',
    target: null
  },
  {
    id: 'cert-jee8',
    type: 'cert',
    dates: '2023',
    sortKey: 2023.6,
    title: 'Java Enterprise Edition 8',
    subtitle: 'Udemy',
    summary: 'Enterprise Java across the Java EE 8 stack.',
    target: null
  },
  {
    id: 'freelance-turn',
    type: 'work',
    dates: '2017 — 2022',
    sortKey: 2022.99,
    title: 'The turn to software',
    subtitle: 'Freelance · Greece',
    summary: 'Greek and English transcription and localization on demand, while teaching myself to build software.',
    target: { kind: 'location', id: 'greece' }
  },
  {
    id: 'cert-js-es6',
    type: 'cert',
    dates: '2022',
    sortKey: 2022.95,
    title: 'JavaScript: Understanding ES6 and Beyond',
    subtitle: 'Udemy',
    summary: 'Modern JavaScript, ES6 and beyond.',
    target: null
  },
  {
    id: 'cert-js-weird-parts',
    type: 'cert',
    dates: '2022',
    sortKey: 2022.9,
    title: 'JavaScript: Understanding the Weird Parts',
    subtitle: 'Udemy',
    summary: 'JavaScript internals and the language’s weird parts.',
    target: null
  },
  {
    id: 'msc',
    type: 'cert',
    dates: '2019 — 2021',
    sortKey: 2021.99,
    title: 'M.Sc. Computer Software Engineering',
    subtitle: 'University of Thessaly',
    summary: 'Postgraduate degree in software engineering.',
    target: null
  },
  {
    id: 'cert-azure-ad',
    type: 'cert',
    dates: '2021',
    sortKey: 2021.7,
    title: 'Azure Active Directory Identity & Access Management',
    subtitle: 'Udemy',
    summary: 'Identity and access management with Azure Active Directory.',
    target: null
  },
  {
    id: 'cert-devops-smart-cities',
    type: 'cert',
    dates: '2021',
    sortKey: 2021.3,
    title: 'DevOps Competences for Smart Cities',
    subtitle: 'University of Nicosia (UNIC) MOOC',
    summary: 'DevOps practice for smart-city systems.',
    target: null
  },
  {
    id: 'cert-frontend-gfoss',
    type: 'cert',
    dates: '2020',
    sortKey: 2020.5,
    title: 'Front-End Development',
    subtitle: 'GFOSS · Open Technologies Alliance',
    summary: 'Open-source front-end development.',
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
    id: 'cert-blockchain',
    type: 'cert',
    dates: '2018',
    sortKey: 2018.3,
    title: 'Blockchain Specialization',
    subtitle: 'Coursera',
    summary: 'Blockchain fundamentals and smart contracts.',
    target: null
  },
  {
    id: 'beng',
    type: 'cert',
    dates: '2009 — 2015',
    sortKey: 2015,
    title: 'B.Eng Environmental Engineering',
    subtitle: 'University of Western Macedonia',
    summary: 'Undergraduate engineering degree. Labs, chemistry and environmental reporting.',
    target: null
  }
];
