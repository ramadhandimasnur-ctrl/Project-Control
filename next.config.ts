import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['postgres', 'exceljs'],
  experimental: {
    serverActions: {
      // Server actions default to a 1 MB body. The source workbook is a few
      // megabytes, and rejecting it at the framework boundary would produce a
      // failure the application cannot explain.
      bodySizeLimit: '16mb',
    },
  },
  eslint: {
    // Lint is a separate CI step (`npm run lint`); don't slow the build down.
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Typecheck is a separate CI step (`npm run typecheck`) and must never be skipped.
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
