# ─── Base ──────────────────────────────────────────────
FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl

# ─── Dependencies ──────────────────────────────────────
FROM base AS deps
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

# ─── Build ─────────────────────────────────────────────
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

# ─── Production runtime ────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package*.json ./
EXPOSE 4000
CMD ["node", "dist/main.js"]
