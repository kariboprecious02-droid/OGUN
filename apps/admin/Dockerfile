FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# Build marker — surfaced via /_version. Lets us verify which build is live.
ARG COMMIT_SHA=unknown
ENV COMMIT_SHA=$COMMIT_SHA
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 4001
ENV PORT=4001
CMD ["node", "server.js"]
