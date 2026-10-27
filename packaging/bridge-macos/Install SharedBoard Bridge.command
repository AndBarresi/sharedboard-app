#!/bin/bash
# SharedBoard.app — Andrew Barresi (https://github.com/AndBarresi). MIT.
bridge_folder="$(cd "$(dirname "$0")" && pwd -P)" || exit 1
/bin/bash "$bridge_folder/SharedBoard Bridge.app/Contents/Resources/bridge.command" --install --no-browser "$@"
bridge_status=$?
if [ "$bridge_status" -ne 0 ]; then
  printf '\nSetup did not finish. Read the message above and README.txt. Press Return to close.\n'
  read -r bridge_reply
fi
exit "$bridge_status"
