import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['postgres', 'exceljs'],
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
