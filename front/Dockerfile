# =============================================================================
#  FabriHub · Front (servicios de usuario)
#  Etapa 1: build de Vite + server.mjs (esbuild). Etapa 2: Express no-root.
#  Las VITE_* se embeben en el bundle en tiempo de build.
# =============================================================================
FROM node:22-alpine AS builder
WORKDIR /app

ARG VITE_PUBLIC_ENCRIP_KEY
ARG VITE_APP_VERSION
ARG VITE_ENVIRONMENT
ENV VITE_PUBLIC_ENCRIP_KEY=${VITE_PUBLIC_ENCRIP_KEY}
ENV VITE_APP_VERSION=${VITE_APP_VERSION}
ENV VITE_ENVIRONMENT=${VITE_ENVIRONMENT}

COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY . .
RUN npm run build && npm run build:server && npm prune --omit=dev

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 --ingroup nodejs web
COPY --from=builder --chown=web:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=web:nodejs /app/dist ./dist
COPY --from=builder --chown=web:nodejs /app/server.mjs ./server.mjs
COPY --from=builder --chown=web:nodejs /app/package.json ./package.json
USER web
EXPOSE 3005
CMD ["node", "server.mjs"]
