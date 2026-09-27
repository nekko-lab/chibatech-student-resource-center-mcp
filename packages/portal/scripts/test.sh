#!/usr/bin/env sh
# Builds the test image and runs the type check and the tests inside the container.
# Nothing is installed on the host. Set LIVE=1 to also run the single live check
# against the real portal (at most 5 requests).
set -eu

cd "$(dirname "$0")/.."

IMAGE="${PORTAL_TEST_IMAGE:-chibatech-src-portal-test}"

docker build -t "$IMAGE" .

if [ "${LIVE:-}" = "1" ]; then
  docker run --rm --init --ipc=host -e LIVE=1 "$IMAGE"
else
  docker run --rm --init --ipc=host "$IMAGE"
fi
