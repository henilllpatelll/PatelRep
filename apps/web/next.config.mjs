import { networkInterfaces } from 'node:os'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const isDev = process.env.NODE_ENV === 'development'
const appRoot = dirname(fileURLToPath(import.meta.url))

function getLocalDevOrigins() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address)
}

function buildCSP() {
  const connectSrc = [
    "'self'",
    'https://*.supabase.co',
    'wss://*.supabase.co',
    'https://patelrep-production.up.railway.app',
    'https://patelrep-web-production.up.railway.app',
    'https://stellar-integrity-production-30cf.up.railway.app',
    ...(isDev ? ['http://localhost:*', 'http://127.0.0.1:*'] : []),
    // TEMPORARY (37-04): allows the local-standalone-build regression harness
    // to talk to itself over plain HTTP on localhost. Env-gated, reverted
    // fully before this plan closes — same pattern as every phase since ~32.
    ...(process.env.REGRESSION_LOCAL_CSP ? ['http://localhost:*', 'http://127.0.0.1:*'] : []),
  ]

  const scriptSrc = [
    "'self'",
    "'unsafe-inline'",
    ...(isDev ? ["'unsafe-eval'"] : []),
  ]

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.supabase.co",
    `connect-src ${connectSrc.join(' ')}`,
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
}

function buildSecurityHeaders() {
  const headers = [
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-XSS-Protection', value: '1; mode=block' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    { key: 'Content-Security-Policy', value: buildCSP() },
  ]

  if (!isDev) {
    headers.push({ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' })
  }

  return headers
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keeps isolated browser checks from conflicting with an operator's active dev server.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // standalone output is for Railway/Docker self-hosting. Vercel manages its own serving
  // and its Turbopack build does not emit next-server.js.nft.json, so skip it there.
  ...(process.env.VERCEL ? {} : { output: 'standalone' }),
  // turbopack.root is only needed for local monorepo dev (no workspace lockfile at repo root).
  // On Vercel the rootDirectory is already apps/web, so setting this breaks outputFileTracingRoot.
  ...(process.env.VERCEL ? {} : { turbopack: { root: appRoot } }),
  allowedDevOrigins: getLocalDevOrigins(),
  serverExternalPackages: [],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
    ],
  },
  async headers() {
    return [{ source: '/(.*)', headers: buildSecurityHeaders() }]
  },
}

export default nextConfig
