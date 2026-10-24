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
    facts: {
      role: 'Software Engineer, Lyric HCM',
      stack: 'Java, Spring Boot',
      outcome: 'Country-compliant payroll features shipped across regions. Second place and the Creativity and Innovation Trophy at the 2025 ADP hackathon.'
    },
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
    facts: {
      role: 'Author and maintainer',
      stack: 'Java 21, Picocli, Gradle, Apache Lucene, llama.cpp, Ollama',
      outcome: 'Installable developer betas for Windows x64 and Ubuntu or WSL x64, with documented trust, privacy and capability boundaries.'
    },
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
    facts: {
      role: 'Author',
      stack: 'Rust, Axum, WebAssembly, React, Three.js, PostgreSQL, Redis',
      outcome: 'Every roll carries an Ed25519-signed receipt that anyone can replay offline, in the browser or on the command line.'
    },
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
    facts: {
      role: 'AI model evaluation contractor',
      stack: 'Java, JavaScript, TypeScript, Python, C#, SQL',
      outcome: 'Scored and corrected LLM-generated code and reasoning, and designed the prompts and acceptance tests that judged it.'
    },
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
    facts: {
      role: 'Software Engineer, EU Programmes',
      stack: 'Java, Spring, React, Angular, SQL',
      outcome: 'Features on ESDEN and SDMX-RI, two live EU statistical platforms, and a legacy team database migrated on a short timeline.'
    },
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
    facts: {
      role: 'Independent contractor',
      stack: 'Excel, Python, SQL, Google Data Studio, JavaScript, TypeScript',
      outcome: 'Dashboards, multi-page reports and property comparisons for a private real estate investment engagement.'
    },
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
