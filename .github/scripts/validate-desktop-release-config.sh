#!/usr/bin/env bash
set -euo pipefail

required=(
  APPLE_CERTIFICATE_P12_BASE64 APPLE_CERTIFICATE_PASSWORD
  APPLE_SIGNING_IDENTITY APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID
)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Release configuration is missing $name." >&2
    exit 1
  fi
done

client_pattern='^185849256404-[a-z0-9-]+\.apps\.googleusercontent\.com$'
if [[ ! "${GAPPD_GOOGLE_OAUTH_CLIENT_ID:-}" =~ $client_pattern ]]; then
  echo "Set GAPPD_GOOGLE_OAUTH_CLIENT_ID to the Gappd Production Desktop client ID." >&2
  exit 1
fi

echo "GAPPD_SIGNED_RELEASE=1" >> "$GITHUB_ENV"
echo "Release configuration: signed, notarized, and production Calendar enabled"
