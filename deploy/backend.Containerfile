# Build from the repo root: podman build -f deploy/backend.Containerfile -t localhost/otus-backend .
# Alpine for both stages: the binary links against musl, so it must be built on musl too.
FROM docker.io/library/rust:1-alpine AS build
# build-base + cmake: aws-lc-sys (rustls' crypto backend, used by the 42 OAuth client) compiles C
RUN apk add --no-cache build-base cmake
WORKDIR /src
COPY backend/ .
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release --locked && cp target/release/otus-backend /otus-backend

FROM docker.io/library/alpine:3
# ca-certificates: the 42 API is called over TLS
RUN apk add --no-cache ca-certificates \
    && adduser -S -D -H -u 10001 otus \
    && mkdir -p /data/uploads && chown otus /data/uploads
COPY --from=build /otus-backend /usr/local/bin/otus-backend
USER otus
ENV BIND_ADDR=127.0.0.1:3000 UPLOAD_DIR=/data/uploads RUST_LOG=info
CMD ["otus-backend"]
