FROM node:24-alpine AS build
WORKDIR /app
# Native Argon2/sharp dependencies can fall back to a local build when necessary.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
COPY scripts/postinstall.mjs scripts/local-runtime.mjs ./scripts/
ENV DOCKER_BUILD=1
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN NODE_OPTIONS=--max-old-space-size=768 npm run build -- --webpack

FROM node:24-alpine AS worker
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# The worker and protected CLI commands require tsx and the server libraries.
# Copy only their source/dependencies, not local data, env files or build traces.
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/lib ./lib
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/tsconfig.json ./tsconfig.json
RUN mkdir -p /var/lib/urbankare-backups && chown node:node /var/lib/urbankare-backups && chmod 700 /var/lib/urbankare-backups
USER node
ENTRYPOINT ["node", "scripts/container-entrypoint.mjs"]
CMD ["node", "--import", "tsx", "scripts/worker.ts"]

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/scripts/start.mjs /app/scripts/gateway.mjs /app/scripts/container-entrypoint.mjs /app/scripts/public-origin.mjs /app/scripts/process-lifecycle.mjs ./scripts/
COPY --from=build --chown=node:node /app/node_modules/ws ./node_modules/ws
COPY --from=build --chown=node:node /app/node_modules/helmet ./node_modules/helmet
USER node
EXPOSE 3000
ENV HOSTNAME=0.0.0.0
ENTRYPOINT ["node", "scripts/container-entrypoint.mjs"]
CMD ["node", "scripts/start.mjs"]
