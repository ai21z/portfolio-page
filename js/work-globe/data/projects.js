export const PROJECTS = [
  {
    id: 'true-rolls',
    name: 'TrueRolls',
    description: 'Verifiable dice with Ed25519-signed receipts seeded from a BLS-verified public drand quicknet beacon. Receipts replay offline. Witnessed fairness against operator suppression remains a v2 goal.',
    tech: ['Rust', 'Ed25519', 'drand', 'WebAssembly', 'React'],
    github: 'https://github.com/ai21z/TrueRolls',

    initialAngle: 0,
    orbitRadius: 1.15,
    orbitTilt: 0,
    rotationSpeed: 4.0,

    // Aged ivory, #dbccad, an old carved die, so it stands apart from the Talos bronze. The moon is the project's d20.
    shape: 'd20',
    color: [0.86, 0.80, 0.68],
    moonRadius: 0.08,
    glowIntensity: 0.3,
    pulseSpeed: 0.5
  },
  {
    id: 'talos-cli',
    name: 'Talos, Local Workspace Operator',
    description: 'Local-first Java CLI workspace operator for governed developer tasks. Talos combines bounded tools, explicit approval gates, local model backends, durable traces, context handling and verification-oriented outcomes.',
    tech: ['Java', 'CLI', 'Approval Gates', 'Lucene', 'llama.cpp', 'Traceability'],
    github: 'https://github.com/ai21z/talos-assistant',
    site: 'https://taloslocal.com/',
    
    initialAngle: 180,
    orbitRadius: 1.15,
    orbitTilt: 0,
    rotationSpeed: 4.0,
    
    // The bronze of the Talos mark's brow bars, lifted for the light. The moon is the mark's helmet.
    shape: 'talos',
    color: [0.79, 0.61, 0.40],
    moonRadius: 0.08,
    glowIntensity: 0.3,
    pulseSpeed: 0.5
  }
];
