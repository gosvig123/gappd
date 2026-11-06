#!/usr/bin/env bash
set -euo pipefail

# A stable release ships a commit that CI already tested: this workflow runs no tests itself.
# Needs the latest CI test-and-build check on the checked-out commit to have passed. Waits up to
# 15 minutes for a run that is still going; CI does not run on tags, so a commit that was never
# pushed to a branch has no run and fails after 2 minutes.
sha="$(git rev-parse HEAD)"
started=$(date +%s)
while :; do
  latest="$(gh api "repos/$GITHUB_REPOSITORY/commits/$sha/check-runs?check_name=test-and-build" \
    --jq '.check_runs | sort_by(.started_at) | last | "\(.status // "missing") \(.conclusion // "none") \(.html_url // "-")"')"
  read -r state conclusion url <<<"$latest"
  [[ "$state" == "completed" ]] && break
  waited=$(( $(date +%s) - started ))
  if [[ "$state" == "missing" ]] && (( waited >= 2 * 60 )); then
    echo "Stable release stopped: commit $sha has no CI test-and-build run." >&2
    echo "Push the commit to beta so CI runs, wait for it to pass, then run this workflow again." >&2
    exit 1
  fi
  if (( waited >= 15 * 60 )); then
    echo "Stable release stopped: CI test-and-build on $sha is still $state after 15 minutes ($url)." >&2
    echo "Wait for CI to finish and pass, then run this workflow again." >&2
    exit 1
  fi
  echo "Waiting for CI test-and-build on $sha ($state)"
  sleep 20
done
if [[ "$conclusion" != "success" ]]; then
  echo "Stable release stopped: CI test-and-build on $sha ended with $conclusion ($url)." >&2
  echo "Fix the failure (rerun only a proven flaky test), wait for CI to pass, then run this workflow again." >&2
  exit 1
fi
echo "CI test-and-build passed on $sha: $url"
