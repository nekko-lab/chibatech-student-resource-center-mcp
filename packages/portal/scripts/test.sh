#!/usr/bin/env sh
# Builds the root test image and runs the type check and the tests inside the container
# (delegates to the root scripts/test.sh). Nothing is installed on the host. Set LIVE=1 to
# also run the single live check against the real portal (at most 5 requests).
set -eu
exec "$(dirname "$0")/../../../scripts/test.sh" packages/portal "$@"
