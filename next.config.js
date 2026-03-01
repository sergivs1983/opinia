const path = require('path');
// NOTE: NEXT_FONT_GOOGLE_MOCKED_RESPONSES removed – mock CSS referenced macOS-only
// font paths and caused "Missing mocked response" / ENOENT errors on Vercel Linux.
// NOTE: __dirname is NOT used anywhere in this file — all paths use path.resolve()
// which bases on process.cwd() and works in both CJS and ESM evaluation contexts.

let withNextIntl = (config) => config;
try {
  withNextIntl = require('next-intl/plugin')('./i18n.ts');
} catch {
  // Offline/dev fallback: keep build working with local compat layer.
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Vercel-optimized standalone output — smaller deploys, faster cold starts
  output: 'standalone',

  images: {
    // SECURITY: remotePatterns is empty because the app uses <Image> only for
    // local static files (e.g. /brand/logo.png).  All external images
    // (Supabase signed URLs, Google profile pictures) are displayed with plain
    // <img> tags and do NOT go through the /_next/image optimizer.
    // Keeping remotePatterns empty prevents the SSRF / path-traversal vectors
    // described in GHSA-f82v-jwr5-mffw / GHSA-3h5q-q6xp-mxc4 entirely.
    // If a future <Image src="https://…"> is added, add a *specific* entry here
    // (e.g. { protocol:'https', hostname:'abc123.supabase.co', pathname:'/storage/v1/object/**' }).
    remotePatterns: [],
  },

  // Suppress false-positive hydration warnings from ThemeProvider
  reactStrictMode: true,

  // Ensure messages/ JSON files are included in the serverless bundle
  experimental: {
    serverComponentsExternalPackages: [],
  },
  async rewrites() {
    return {
      beforeFiles: [
        { source: '/api/_internal/google/publish', destination: '/api/cron/worker/google/publish' },
        { source: '/api/_internal/tripadvisor/sync', destination: '/api/cron/worker/tripadvisor/sync' },
        { source: '/api/_internal/tripadvisor/publish', destination: '/api/cron/worker/tripadvisor/publish' },
        { source: '/api/_internal/booking/sync', destination: '/api/cron/worker/booking/sync' },
        { source: '/api/_internal/booking/publish', destination: '/api/cron/worker/booking/publish' },
        { source: '/api/_internal/rules/run', destination: '/api/internal/rules/run' },
        { source: '/api/_internal/insights/rollup', destination: '/api/internal/insights/rollup' },
        { source: '/api/_internal/signals/run', destination: '/api/internal/signals/run' },
        { source: '/api/_internal/signals/backfill', destination: '/api/internal/signals/backfill' },
        { source: '/api/_internal/signals/to-weekly', destination: '/api/internal/signals/to-weekly' },
      ],
    };
  },
  webpack: (config) => {
    // Use path.resolve() (process.cwd()-based) instead of path.join(__dirname, …)
    // so this works correctly in both CJS and ESM evaluation contexts.
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      'next-intl': path.resolve('src/lib/next-intl/compat/index.tsx'),
      'next-intl/server': path.resolve('src/lib/next-intl/compat/server.ts'),
      'next-intl/middleware': path.resolve('src/lib/next-intl/compat/middleware.ts'),
    };
    return config;
  },

};

module.exports = withNextIntl(nextConfig);
