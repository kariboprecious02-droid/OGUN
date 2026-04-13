/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Required for the Docker-based deploy — generates .next/standalone
  // which apps/admin/Dockerfile copies. Without this, docker build fails
  // at "COPY --from=builder /app/.next/standalone" and staging keeps
  // serving the previous revision.
  output: 'standalone',
  // NOTE: OGUN_API_BASE_URL used to be declared in `env:` here. That's
  // a BUILD-time substitution — Next.js inlines the value into the
  // compiled JS. Since Cloud Build runs `docker build` without the env
  // set, the fallback 'http://localhost:4000/v1' would get baked in
  // and Cloud Run runtime env vars would have no effect. We removed it
  // so process.env.OGUN_API_BASE_URL is read at RUNTIME in server
  // components — which is what we want for Cloud Run.
};

module.exports = nextConfig;
