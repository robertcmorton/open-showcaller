FROM node:22-alpine
WORKDIR /app
RUN npm install -g pnpm@9

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/sync ./apps/sync
RUN pnpm install --frozen-lockfile --filter @open-showcaller/sync...

ENV NODE_ENV=production
EXPOSE 8787
CMD ["pnpm", "--filter", "@open-showcaller/sync", "start"]
