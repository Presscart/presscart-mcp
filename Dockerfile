# syntax=docker/dockerfile:1

FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
# --ignore-scripts: skips the husky prepare hook, which requires a .git directory
RUN npm ci --ignore-scripts

COPY tsconfig.json tsconfig.build.json ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=builder /app/dist ./dist

USER node
EXPOSE 8080
CMD ["node", "dist/http.js"]
