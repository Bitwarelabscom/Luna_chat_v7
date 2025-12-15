/** @type {import('next').NextConfig} */
const nextConfig = {
  // basePath removed - now served at root of luna.bitwarelabs.com
  output: 'standalone',
  reactStrictMode: true,
  env: {
    // Empty in production - API calls go through nginx at /api
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || '',
  },
  async rewrites() {
    // Only use rewrites in development
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    if (!apiUrl) return [];

    return [
      {
        source: '/api/:path*',
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
