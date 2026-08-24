import nextConfig from 'eslint-config-next';

const config = [
  {
    // Recursive globs: bare '.next/' only matches at the repo root, so build
    // output nested anywhere (e.g. inside a .claude/worktrees/* checkout) would
    // contaminate lint. '**/' makes these immune to stray nested trees.
    ignores: [
      '**/.next/**',
      '**/node_modules/**',
      '**/.git/**',
      '**/out/**',
      '**/build/**',
      '.claude/worktrees/**'
    ]
  },
  ...(Array.isArray(nextConfig) ? nextConfig : [nextConfig])
];

export default config;
