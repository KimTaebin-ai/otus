# Build from the repo root: podman build -f deploy/web.Containerfile -t localhost/otus-web .
# One image holds both apps: the student app in /srv and the admin app in /srv-admin.
FROM docker.io/oven/bun:1-alpine AS build
# frontend/ and shared/ are siblings: frontend/src/shared is a symlink to ../../shared (code the
# student and admin apps share), so it only resolves with this layout.
WORKDIR /src/frontend
COPY frontend/package.json frontend/bun.lock ./
RUN bun install --frozen-lockfile
COPY shared/ /src/shared/
COPY frontend/ .
RUN bun run build

# The admin app, same layout: admin-front/ and shared/ are siblings (admin-front/src/shared is a
# symlink to ../../shared). Caddy serves it on ADMIN_SITE_ADDRESS from /srv-admin.
FROM docker.io/oven/bun:1-alpine AS build-admin
WORKDIR /src/admin-front
COPY admin-front/package.json admin-front/bun.lock ./
RUN bun install --frozen-lockfile
COPY shared/ /src/shared/
COPY admin-front/ .
RUN bun run build

# The official image grants caddy cap_net_bind_service for port 443. We listen on 8443 and
# the pod drops every capability, and a binary with file capabilities can't be exec'd
# then, so strip it here and copy only the binary (modifying it in place would store it twice).
FROM docker.io/library/caddy:2-alpine AS caddy
RUN setcap -r /usr/bin/caddy

# What the official image adds to Alpine, minus curl and the libcap tools
FROM docker.io/library/alpine:3
RUN apk add --no-cache ca-certificates mailcap
COPY --from=caddy /usr/bin/caddy /usr/bin/caddy
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/frontend/dist/frontend/browser /srv
COPY --from=build-admin /src/admin-front/dist/admin-front/browser /srv-admin
ENV XDG_CONFIG_HOME=/config XDG_DATA_HOME=/data
WORKDIR /srv
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
