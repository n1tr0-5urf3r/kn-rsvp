# syntax=docker/dockerfile:1

# Stage 1: build the React frontend
FROM node:22-trixie-slim AS frontend-build

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
# The npm cache is kept across builds, so a retry after a stalled download is
# fast and largely offline. The retry/timeout knobs ride out slow registry
# responses, which npm otherwise reports as "Exit handler never called!".
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund --fetch-retries 5 --fetch-timeout 600000

COPY frontend/ ./
RUN npm run build


# Stage 2: build the Rust backend (edition 2024 requires Rust >= 1.85)
FROM rust:1.96.1-trixie AS backend-build

WORKDIR /app/backend

COPY backend/Cargo.toml backend/Cargo.lock ./
COPY backend/migrations ./migrations
COPY backend/src ./src
RUN cargo build --release --bin rsvp


# Stage 3: minimal runtime image
FROM debian:trixie-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/data

COPY --from=backend-build /app/backend/target/release/rsvp /app/rsvp
COPY --from=frontend-build /app/frontend/dist /app/frontend-dist

ENV PORT=3000
ENV FRONTEND_DIST=/app/frontend-dist
ENV DATABASE_URL=sqlite:///app/data/rsvp.db
ENV BRANDING_DIR=/app/data/branding

EXPOSE 3000

CMD ["/app/rsvp"]
