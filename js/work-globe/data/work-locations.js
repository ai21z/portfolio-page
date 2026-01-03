export const WORK_LOCATIONS = {
  greece: {
    name: 'Greece',
    imageCoords: { x: 777, y: 330 },
    color: [0.48, 0.68, 0.54],
    entries: [
      {
        company: 'Environmental Engineering & Lab Work',
        position: 'B.Eng studies, chemistry labs & research',
        period: 'Studies & early career',
        responsibilities: [
          'B.Eng Environmental Engineering (University of Western Macedonia)',
          'Water / soil / wastewater quality analysis in chemistry labs',
          'Greenhouse-gas emissions and environmental reporting work',
        ]
      },
      {
        company: 'Transition to Software & AI',
        position: 'Freelance, M.Sc. Software Engineering, EU platforms',
        period: 'Freelance & postgraduate work',
        responsibilities: [
          'Greek ↔ English transcription & translation on work-on-demand platforms, i18n/l10n projects',
          'M.Sc. Software Engineering (University of Thessaly)',
          'Software Engineer at Netcompany-Intrasoft: Full-stack development on EU statistical platforms (Java/Spring, React/Angular)',
          'Early data annotation & AI-related work'
        ]
      }
    ]
  },

  spain: {
    name: 'Spain',
    imageCoords: { x: 689, y: 310 },
    color: [1.0, 0.48, 0.2],
    entries: [
      {
        company: 'ADP (Lyric HCM)',
        position: 'Software Engineer',
        period: '2024 — Present',
        responsibilities: [
          'Software Engineer on Lyric HCM payroll platform',
          'Development & cross-region integrations under strict compliance',
          'Authoring developer runbooks, ADRs & troubleshooting guides'
        ]
      },
      {
        company: 'Data Annotation & Personal Projects',
        position: 'LLM testing, evaluation & tool-building (remote)',
        period: 'Alongside primary roles',
        responsibilities: [
          'AI model evaluation for code generation, reasoning and content quality',
          'Prompt, rubric and acceptance-test design for coding, refactoring & debugging tasks',
          'Design and development of local-first tools & prototypes (e.g. LOQ-J, True-Rolls)',
          'Experiments with local LLM workflows, retrieval (RAG) and developer productivity tooling'
        ]
      }
    ]
  }
};