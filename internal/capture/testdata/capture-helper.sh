#!/bin/sh
set -eu

mode="both"
output_dir="."
while [ "$#" -gt 0 ]; do
  case "$1" in
    --mode) mode="$2"; shift 2 ;;
    --output-dir) output_dir="$2"; shift 2 ;;
    --device) shift 2 ;;
    --chunk-seconds|--chunk-overlap-seconds) shift 2 ;;
    *) shift ;;
  esac
done

scenario="${GAPPD_TEST_CAPTURE_SCENARIO:-clean}"
payload="123456789012345678901234567890123456789012345"

write_source() {
  printf '%s' "$payload" > "$output_dir/$1.wav"
}

write_requested() {
  if [ "$mode" != "system" ] && [ "$scenario" != "missing-mic" ]; then
    write_source mic
  fi
  if [ "$mode" != "mic" ] && [ "$scenario" != "missing-system" ]; then
    write_source system
  fi
}

emit_complete_stream() {
  if [ "$mode" != "system" ]; then
    printf '%s' "$payload" > "$output_dir/mic-chunk.wav"
    printf '{"type":"audio_chunk","source":"mic","path":"%s/mic-chunk.wav","start":0,"end":1,"canonicalStart":0,"canonicalEnd":1}\n' "$output_dir"
    printf '{"type":"audio_chunk_source_complete","source":"mic","count":1,"canonicalEnd":1}\n'
  fi
  if [ "$mode" != "mic" ]; then
    printf '%s' "$payload" > "$output_dir/system-chunk.wav"
    printf '{"type":"audio_chunk","source":"system","path":"%s/system-chunk.wav","start":0,"end":1,"canonicalStart":0,"canonicalEnd":1}\n' "$output_dir"
    printf '{"type":"audio_chunk_source_complete","source":"system","count":1,"canonicalEnd":1}\n'
  fi
  printf '{"type":"audio_chunk_stream_complete","sources":%s}\n' "$sources"
}

case "$mode" in
  mic) sources='["mic"]' ;;
  system) sources='["system"]' ;;
  *) sources='["mic","system"]' ;;
esac
if [ "$scenario" = "mismatched-ready" ]; then
  sources='["mic"]'
fi
if [ "$scenario" = "exit-before-ready" ]; then
  printf 'helper exited before readiness\n' >&2
  exit 8
fi

printf '{"type":"capture_ready","sources":%s}\n' "$sources"

case "$scenario" in
  unexpected)
    write_requested
    exit 0
    ;;
  unexpected-error)
    write_requested
    exit 9
    ;;
esac

finish() {
  if [ "$scenario" != "no-stop-ack" ]; then
    printf '{"type":"capture_stop_acknowledged"}\n'
  fi
  write_requested
  if [ "$scenario" = "complete-stream" ]; then
    emit_complete_stream
  fi
  if [ "$scenario" = "many-events" ]; then
    i=0
    while [ "$i" -lt 100 ]; do
      printf '{"type":"audio_chunk","source":"mic","path":"x","start":0,"end":1}\n'
      i=$((i + 1))
    done
  fi
  if [ "$scenario" = "nonclean" ]; then
    exit 7
  fi
  exit 0
}

trap finish INT TERM
while :; do
  sleep 1 &
  wait $! || true
done
