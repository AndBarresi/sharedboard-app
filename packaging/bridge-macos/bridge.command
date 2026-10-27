#!/bin/bash
# SharedBoard.app — Andrew Barresi (https://github.com/AndBarresi). MIT.
set -e
bridge_resources="$(cd "$(dirname "$0")" && pwd -P)"
exec "$bridge_resources/runtime/node" "$bridge_resources/launcher.mjs" "$@"
