#!/usr/bin/env bash
# Runs the real infra/host/idraft-install-infra as root in an Ubuntu 24.04 container (the production
# OS), on a copy of this infra/ tree staged the way CI stages it, and checks what lands in /srv/idraft/infra
# (the checks are infra/test/install-infra-checks.sh). Needs Docker, and network access the first time
# to build a small image with rsync.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=infra/test/lib.sh
source "$here/lib.sh"

image=idraft-installtest:local
if ! docker image inspect "$image" >/dev/null 2>&1; then
  printf 'FROM ubuntu:24.04\nRUN apt-get update -qq && apt-get install -y -qq --no-install-recommends rsync >/dev/null && rm -rf /var/lib/apt/lists/*\n' \
    | docker build -q -t "$image" - >/dev/null
fi

docker run --rm -v "$infra_dir:/src:ro" "$image" bash /src/test/install-infra-checks.sh
echo "Install-infra test passed."
