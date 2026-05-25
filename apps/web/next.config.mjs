import { networkInterfaces } from 'node:os'

function getLocalDevOrigins() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address)
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
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
}

export default nextConfig
