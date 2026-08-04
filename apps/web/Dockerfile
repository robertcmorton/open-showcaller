FROM node:22-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@9

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile --filter @open-showcaller/web...
ARG NEXT_PUBLIC_SYNC_HTTP_URL
ARG NEXT_PUBLIC_SYNC_WS_URL
ARG NEXT_PUBLIC_DOC_WS_URL
ENV NEXT_PUBLIC_SYNC_HTTP_URL=$NEXT_PUBLIC_SYNC_HTTP_URL \
    NEXT_PUBLIC_SYNC_WS_URL=$NEXT_PUBLIC_SYNC_WS_URL \
    NEXT_PUBLIC_DOC_WS_URL=$NEXT_PUBLIC_DOC_WS_URL
RUN pnpm --filter @open-showcaller/web build

FROM node:22-alpine
WORKDIR /app
RUN npm install -g pnpm@9
COPY --from=build /app ./
ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "--filter", "@open-showcaller/web", "start"]
