-- SharedBoard.app — Andrew Barresi (https://github.com/AndBarresi). MIT.
on run
    my launchBridge("--install")
end run

on open location incomingURL
    -- URL contents never become shell commands, arguments, or pairing instructions.
    my launchBridge("--start --no-browser")
end open location

on launchBridge(fixedArguments)
    set bridgeScript to (POSIX path of (path to me)) & "Contents/Resources/bridge.command"
    try
        do shell script "/bin/bash " & quoted form of bridgeScript & " " & fixedArguments
    on error bridgeError
        display dialog "SharedBoard Bridge could not start. " & bridgeError buttons {"OK"} default button "OK" giving up after 15
    end try
end launchBridge
