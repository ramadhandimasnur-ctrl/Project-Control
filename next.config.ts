import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['postgres', 'exceljs'],
  /*
   * `next build` and `next dev` both write to .next by default, so building
   * while the dev server is running overwrites the manifest it is serving and
   * the browser starts 404-ing on chunks that no longer exist.
   *
   * Unset in production, so deployment behaviour is unchanged. `build:check`
   * sets it to keep verification builds out of the dev server's way.
   */
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
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
