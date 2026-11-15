FROM node:24-alpine AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10 --activate

FROM base AS dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
WORKDIR /app
ENV MIGRATION_DATABASE_URL=postgresql://build:build@localhost:5432/salonix
COPY tsconfig.json tsconfig.server.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY src ./src
RUN pnpm build

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod=false
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/logs && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
