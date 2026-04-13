/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Required for the Docker-based deploy — generates .next/standalone
  // which apps/admin/Dockerfile copies. Without this, docker build fails
  // at "COPY --from=builder /app/.next/standalone" and staging keeps
  // serving the previous revision.
  output: 'standalone',
  env: {
    OGUN_API_BASE_URL: process.env.OGUN_API_BASE_URL || 'http://localhost:4000/v1',
  },
};

module.exports = nextConfig;
