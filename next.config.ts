import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Emits .next/standalone with a self-contained server.js and only the
  // node_modules actually reached — this is what the Docker runner stage copies.
  output: 'standalone',
}

export default nextConfig
