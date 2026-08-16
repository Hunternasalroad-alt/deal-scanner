import nextConfig from 'eslint-config-next';

const config = [
  {
    ignores: [
      '.next/',
      'node_modules/',
      '.git/',
      'out/',
      'build/'
    ]
  },
  ...(Array.isArray(nextConfig) ? nextConfig : [nextConfig])
];

export default config;
