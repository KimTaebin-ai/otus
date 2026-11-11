# Build from the repo root: podman build -f deploy/clamav.Containerfile -t localhost/otus-clamav .
# ClamAV from Alpine's packages: the official clamav image has no arm64 build.
FROM docker.io/library/alpine:3
RUN apk add --no-cache clamav-daemon freshclam
COPY deploy/clamav/clamd.conf deploy/clamav/freshclam.conf /etc/clamav/
COPY deploy/clamav/start.sh /usr/local/bin/clamav-start
# the clamav user from the package; signatures live in a volume at /var/lib/clamav
USER clamav
CMD ["/usr/local/bin/clamav-start"]
