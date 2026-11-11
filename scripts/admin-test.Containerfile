# Isolated backend verification; does not use the deployed pod or backend/.env.
FROM docker.io/library/rust:1-alpine
RUN apk add --no-cache build-base cmake postgresql-dev python3
RUN RUSTFLAGS="-C target-feature=-crt-static" cargo install diesel_cli --version '~2.3' --locked --no-default-features --features postgres
RUN apk add --no-cache postgresql-client
RUN rustup component add rustfmt clippy
WORKDIR /work
