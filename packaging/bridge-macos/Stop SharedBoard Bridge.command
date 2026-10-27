#!/bin/bash
# SharedBoard.app — Andrew Barresi (https://github.com/AndBarresi). MIT.
bridge_folder="$(cd "$(dirname "$0")" && pwd -P)" || exit 1
/bin/bash "$bridge_folder/SharedBoard Bridge.app/Contents/Resources/bridge.command" --stop "$@"
bridge_status=$?
if [ "$bridge_status" -ne 0 ]; then
  printf '\nThe bridge could not stop. Read the message above. Press Return to close.\n'
  read -r bridge_reply
fi
exit "$bridge_status"
