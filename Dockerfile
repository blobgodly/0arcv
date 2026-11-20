# Multi-stage Dockerfile for 0arc High-Performance Rust + Static Web

# --- Stage 1: Build Frontend ---
FROM node:20-alpine AS frontend-builder
WORKDIR /app
COPY package*.json .npmrc* ./
RUN npm install --legacy-peer-deps
COPY . .
RUN npm run build

# --- Stage 2: Build Rust Backend ---
FROM rust:1.85-alpine AS backend-builder
RUN apk add --no-cache musl-dev gcc libc-dev
WORKDIR /app
COPY rust-server/Cargo.toml rust-server/
COPY rust-server/src rust-server/src
WORKDIR /app/rust-server
RUN cargo build --release

# --- Stage 3: Minimal Runtime ---
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app

# Copy compiled frontend assets & rust binary
COPY --from=frontend-builder /app/dist ./dist
COPY --from=backend-builder /app/rust-server/target/release/zeroarc-server ./zeroarc-server

# Create data directory for local snapshots
RUN mkdir -p /app/data

ENV HOST=0.0.0.0
ENV PORT=3000
ENV NODE_ENV=production
ENV DATA_DIR=/app/data
ENV DIST_DIR=/app/dist

EXPOSE 3000

CMD ["./zeroarc-server"]
