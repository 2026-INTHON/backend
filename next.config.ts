import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  async redirects() {
    return [
      { source: '/docs', destination: '/api/v1/docs', permanent: false },
      { source: '/openapi.json', destination: '/api/v1/openapi.json', permanent: false },
      { source: '/health', destination: '/api/v1/health', permanent: false },
    ];
  },
};
export default config;
