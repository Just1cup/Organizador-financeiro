FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/whatsapp/package.json apps/whatsapp/package.json
RUN PUPPETEER_SKIP_DOWNLOAD=true pnpm install --filter @fluxo/whatsapp... --frozen-lockfile=false
COPY packages/shared packages/shared
COPY apps/whatsapp apps/whatsapp
RUN pnpm --filter @fluxo/shared build && pnpm --filter @fluxo/whatsapp test && pnpm --filter @fluxo/whatsapp build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates fonts-liberation && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /app
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/whatsapp/node_modules ./apps/whatsapp/node_modules
COPY --from=build /app/apps/whatsapp/dist ./apps/whatsapp/dist
COPY --from=build /app/apps/whatsapp/package.json ./apps/whatsapp/package.json
COPY --from=build /app/packages/shared ./packages/shared
CMD ["node", "apps/whatsapp/dist/index.js"]
