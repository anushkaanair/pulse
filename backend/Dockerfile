# Multi-stage build: compile in a full node image (needs devDependencies —
# typescript lives there), ship only the compiled dist/ + prod deps.
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
# dist/ already includes db/migrations/*.sql — copied in during `npm run
# build` (see scripts/copy-migrations.mjs). tsc alone would silently drop
# them, which is exactly the bug that broke the first real deploy.
COPY --from=build /app/dist ./dist
EXPOSE 4000
CMD ["node", "dist/index.js"]
