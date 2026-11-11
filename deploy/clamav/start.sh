#!/bin/sh
# Download signatures on first start, keep them fresh in the background, run clamd.
set -eu
if ! ls /var/lib/clamav/main.c?d >/dev/null 2>&1; then
  echo "clamav: downloading virus signatures (first start, a few minutes)"
  freshclam --config-file=/etc/clamav/freshclam.conf --stdout
fi
freshclam --config-file=/etc/clamav/freshclam.conf --daemon --stdout &
exec clamd --config-file=/etc/clamav/clamd.conf
