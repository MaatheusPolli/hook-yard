# Imagem única para API e worker (o comando define o papel).
FROM node:22-alpine AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --prod \
      --filter @hookyard/api --filter @hookyard/worker --filter @hookyard/shared

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app ./
COPY tsconfig.base.json ./
COPY packages/shared/src packages/shared/src
COPY packages/shared/tsconfig.json packages/shared/
COPY apps/api/src apps/api/src
COPY apps/api/tsconfig.json apps/api/
COPY apps/worker/src apps/worker/src
COPY apps/worker/tsconfig.json apps/worker/
USER node
EXPOSE 3000 9464
# tsx é resolvido a partir do diretório do app; o worker usa working_dir apps/worker.
WORKDIR /app/apps/api
CMD ["node", "--import", "tsx", "src/server.ts"]
