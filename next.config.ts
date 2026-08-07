import type { NextConfig } from 'next'

import { BASE_PATH } from './src/lib/basePath'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Emits .next/standalone with a self-contained server.js and only the
  // node_modules actually reached — this is what the Docker runner stage copies.
  output: 'standalone',
  // Served at ops.aiaccountant.com/pulse. Client-side fetches to internal API
  // routes still need BASE_PATH by hand — see src/lib/basePath.ts.
  basePath: BASE_PATH,
  assetPrefix: BASE_PATH,
}

export default nextConfig
