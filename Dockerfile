# Stage 1: Build
FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json ./
RUN npm install --include=dev

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts

RUN npm run build

# Stage 2: Production Runner
FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4505
ENV BLENDER_PATH=/usr/bin/blender

# Install Blender, Python 3, and required scientific/image libraries
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    blender \
    python3 \
    python3-pil \
    python3-numpy \
    python3-opencv \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Patch Blender 3.4 glTF addon for EXT_texture_webp and modern numpy compatibility
COPY scripts/shared/docker/patch-blender-gltf.py /tmp/patch-blender-gltf.py
RUN python3 /tmp/patch-blender-gltf.py && rm -f /tmp/patch-blender-gltf.py

COPY package.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist
COPY src ./src
COPY scripts ./scripts

# Create storage mount points with node permissions
RUN mkdir -p /app/resources /app/public/models && chown -R node:node /app

USER node

EXPOSE 4505

CMD ["node", "--import", "tsx", "dist/main.js"]
