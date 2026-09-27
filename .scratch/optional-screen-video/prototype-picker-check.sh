#!/bin/sh
# THROWAWAY, interactive test: verifies picker result and a playable movie; never selects content automatically.
set -eu
case "${1:-}" in cancel|window|display|close-window) case_name="$1" ;; *) echo 'Usage: prototype-picker-check.sh cancel|window|display|close-window' >&2; exit 2 ;; esac
root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
source="$root/.scratch/optional-screen-video/prototype-capture-api.swift"
app=/tmp/GappdVideoProbe.app
binary="$app/Contents/MacOS/probe-bin"
mkdir -p "$app/Contents/MacOS"
swiftc -parse-as-library -swift-version 6 -strict-concurrency=complete -target arm64-apple-macos26.0 -framework AppKit -framework ScreenCaptureKit -framework CoreMedia "$source" -o "$binary"
cp "$root/.scratch/optional-screen-video/prototype-video-Info.plist" "$app/Contents/Info.plist"
cp "$root/.scratch/optional-screen-video/prototype-video-launch.sh" "$app/Contents/MacOS/gappd-prototype-capture"
chmod +x "$app/Contents/MacOS/gappd-prototype-capture"
codesign --force --sign - --deep "$app" >/dev/null
out=$(mktemp -d /tmp/gappd-video-probe.XXXXXX)
movie="$out/screen.mov"
seconds=5
[ "$case_name" = close-window ] && seconds=15
printf 'Case: %s; test data: %s\n' "$case_name" "$out"
case "$case_name" in
 cancel) echo 'Cancel the picker; expect no file.' ;;
 window) echo 'Choose a NON-SENSITIVE window; expect playable video.' ;;
 display) echo 'Choose a NON-SENSITIVE display; expect playable video.' ;;
 close-window) echo 'Choose a disposable window, then close it during the 15-second recording.' ;;
esac
open -n -a "$app" --args "$movie" "$seconds"
log="$movie.log"
i=0
while [ "$i" -lt 300 ]; do
    if [ -f "$log" ] && grep -Eq 'Recording finalized|Picker cancelled|Recording failed|Stream could not start|Picker could not start|stopCapture failed|Recording completion callback not received' "$log"; then break; fi
    sleep 1
    i=$((i + 1))
done
if [ -f "$log" ]; then grep -E 'App active|Selected source|Picker|Recording|Stream|stopCapture' "$log" || true; fi
if [ "$case_name" = cancel ]; then
    if [ ! -e "$movie" ] && grep -q 'Picker cancelled' "$log"; then echo 'PASS: cancellation produced no video'; exit 0; fi
    echo 'FAIL: cancellation did not exit cleanly without a video'; exit 1
fi
if ! grep -q 'Recording finalized' "$log" || [ ! -s "$movie" ]; then echo "FAIL: no finalized movie. Check $log and macOS crash reports."; exit 1; fi
expected="$case_name"
[ "$case_name" = close-window ] && expected=window
if ! grep -q "Selected source: $expected" "$log"; then echo "FAIL: selected source was not $expected"; exit 1; fi
if ! ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height -show_entries format=duration -of default=noprint_wrappers=1 "$movie"; then echo 'FAIL: movie is not playable'; exit 1; fi
if [ "$case_name" = close-window ]; then
    duration=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$movie")
    if ! awk -v d="$duration" 'BEGIN { exit !(d < 14) }'; then echo 'FAIL: movie did not end early after window closed'; exit 1; fi
fi
echo 'PASS: finalized playable video (audio and app integration NOT validated)'
