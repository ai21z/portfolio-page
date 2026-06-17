export const PROJECTS = [
  {
    id: 'true-rolls',
    name: 'True-Rolls',
    description: 'Provably-fair dice rolls for tabletop. A ChaCha20 RNG with HKDF key separation produces signed receipts and replay proofs, so any roll can be verified after the fact, no trust required.',
    tech: ['ChaCha20', 'HKDF', 'Cryptography', 'Verifiable RNG'],
    github: '',

    initialAngle: 0,
    orbitRadius: 1.15,
    orbitTilt: 0,
    rotationSpeed: 4.0,

    color: [0.85, 0.52, 0.28],
    moonRadius: 0.08,
    glowIntensity: 0.3,
    pulseSpeed: 0.5
  },
  {
    id: 'talos-cli',
    name: 'Talos, Local Workspace Operator',
    description: 'Local-first Java CLI workspace operator for governed developer tasks. Talos uses bounded tools, explicit approval gates, local inspect-edit-verify loops and traceable runs so changes stay private, reviewable and reproducible.',
    tech: ['Java', 'CLI', 'Workspace Operator', 'Approval Gates', 'Lucene', 'Local LLMs'],
    github: '',                 // public repo not ready yet (was https://github.com/ai21z/talos-cli)
    soon: 'Beta release coming soon',
    
    initialAngle: 180,
    orbitRadius: 1.15,
    orbitTilt: 0,
    rotationSpeed: 4.0,
    
    color: [0.48, 0.68, 0.54],
    moonRadius: 0.08,
    glowIntensity: 0.3,
    pulseSpeed: 0.5
  }
  
  // Future projects (2-4 maximum with current design):
  // Add new projects here with staggered initialAngle values
  // Recommended angles:
  //   2 projects: [0°, 180°]
  //   3 projects: [0°, 120°, 240°]
  //   4 projects: [0°, 90°, 180°, 270°]
  //
  // Example:
  // {
  //   id: 'project-2',
  //   name: 'Second Project',
  //   description: '...',
  //   tech: ['React', 'TypeScript', 'Node.js'],
  //   github: 'https://github.com/...',
  //   initialAngle: 120,
  //   orbitRadius: 1.65,
  //   orbitTilt: -8,
  //   rotationSpeed: 4.0,
  //   color: [0.95, 0.55, 0.25],
  //   moonRadius: 0.18,
  //   glowIntensity: 0.3,
  //   pulseSpeed: 0.5
  // }
];
