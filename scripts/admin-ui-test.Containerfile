FROM docker.io/oven/bun:1-alpine
RUN apk add --no-cache chromium chromium-chromedriver
WORKDIR /repo
