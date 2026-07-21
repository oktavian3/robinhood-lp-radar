/** @type {import('next').NextConfig} */
const path = require('path');
const nextConfig = {
  images: { unoptimized: true },
  outputFileTracingRoot: path.join(__dirname, '..'),
  experimental: { webpackBuildWorker: false },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'https://api.avetrace.xyz/lp',
  },
};
module.exports = nextConfig;
