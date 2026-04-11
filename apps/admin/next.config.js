/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    OGUN_API_BASE_URL: process.env.OGUN_API_BASE_URL || 'http://localhost:4000/v1',
  },
};

module.exports = nextConfig;
