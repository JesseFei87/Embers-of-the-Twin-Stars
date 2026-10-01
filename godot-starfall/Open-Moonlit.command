#!/bin/zsh
cd -- "${0:A:h}"
exec /Applications/Godot.app/Contents/MacOS/Godot --path "$PWD" --rendering-driver metal --resolution 1600x900 res://scenes/moonlit_pass.tscn "$@"
