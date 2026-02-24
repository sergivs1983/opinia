const path = require('path');
// NOTE: NEXT_FONT_GOOGLE_MOCKED_RESPONSES removed – mock CSS referenced macOS-only
// font paths and caused "Missing mocked response" errors. next/font/google fetches
// Inter at build time on Vercel (internet available). For fully-offline local builds
// the font gracefully falls back to the CSS variable defined in globals.css.

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
    // Allow Supabase storage and Google profile images
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co' },
      { protocol: 'https', hostname: '*.supabase.in' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
    ],
  },

  // Suppress false-positive hydration warnings from ThemeProvider
  reactStrictMode: true,

  // Ensure messages/ JSON files are included in the serverless bundle
  experimental: {
    serverComponentsExternalPackages: [],
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      'next-intl': path.join(__dirname, 'src/lib/next-intl/compat/index.tsx'),
      'next-intl/server': path.join(__dirname, 'src/lib/next-intl/compat/server.ts'),
      'next-intl/middleware': path.join(__dirname, 'src/lib/next-intl/compat/middleware.ts'),
    };
    return config;
  },

};

module.exports = withNextIntl(nextConfig);
