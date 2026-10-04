# =============================================================================
#  FabriHub · API (servicios empresariales)
#  Etapa 1 compila TS → dist/index.mjs (esbuild). Etapa 2 corre como no-root.
# =============================================================================
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 --ingroup nodejs api
COPY --from=builder --chown=api:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=api:nodejs /app/dist ./dist
COPY --from=builder --chown=api:nodejs /app/package.json ./package.json
USER api
EXPOSE 4000
CMD ["node", "dist/index.mjs"]
