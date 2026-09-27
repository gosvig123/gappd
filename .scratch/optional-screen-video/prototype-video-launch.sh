#!/bin/sh
exec "$(dirname "$0")/probe-bin" "$@" > "$1.log" 2>&1
