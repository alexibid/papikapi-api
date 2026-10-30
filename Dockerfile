# Stage 1: Build
FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json ./
RUN npm install --include=dev

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# Stage 2: Production
FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4505

COPY package.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist

# Create storage mount points with node permissions
RUN mkdir -p /app/resources /app/public/models && chown -R node:node /app

USER node

EXPOSE 4505

CMD ["node", "dist/main.js"]
