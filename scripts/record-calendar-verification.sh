#!/usr/bin/env bash
set -euo pipefail

# Record the real app and browser flow. The user completes Google sign-in and consent.
seconds="${1:-240}"
if [[ ! "$seconds" =~ ^[0-9]+$ ]] || (( seconds < 30 || seconds > 900 )); then
  echo 'Duration must be 30–900 seconds.' >&2
  exit 1
fi
output="${2:-$HOME/Desktop/gappd-calendar-verification.mov}"
if [[ -e "$output" ]]; then
  echo "Refusing to replace $output" >&2
  exit 1
fi
printf 'Prepare the app and a test calendar. Recording starts in 5 seconds.\n'
sleep 5
screencapture -v -V "$seconds" -k "$output"
printf 'Review the recording for personal data, codes, tokens, and unrelated windows: %s\n' "$output"
