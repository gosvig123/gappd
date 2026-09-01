#!/usr/bin/env bash
set -euo pipefail

cert_path="$RUNNER_TEMP/gappd-macos-signing.p12"
keychain_path="$RUNNER_TEMP/gappd-macos-signing.keychain-db"
keychain_password="$(uuidgen)"

python3 - <<'PY'
import base64
import os
from pathlib import Path

value = os.environ['APPLE_CERTIFICATE_P12_BASE64']
Path(os.environ['RUNNER_TEMP'], 'gappd-macos-signing.p12').write_bytes(base64.b64decode(value))
PY

security create-keychain -p "$keychain_password" "$keychain_path"
security set-keychain-settings -lut 21600 "$keychain_path"
security unlock-keychain -p "$keychain_password" "$keychain_path"
security import "$cert_path" -k "$keychain_path" -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" "$keychain_path"
security list-keychains -d user -s "$keychain_path" "$HOME/Library/Keychains/login.keychain-db"
security default-keychain -d user -s "$keychain_path"

if ! security find-identity -v -p codesigning "$keychain_path" | grep -F "$APPLE_SIGNING_IDENTITY" >/dev/null; then
  echo "Expected signing identity not found: $APPLE_SIGNING_IDENTITY" >&2
  security find-identity -v -p codesigning "$keychain_path" >&2 || true
  exit 1
fi

{
  echo "CSC_LINK=$cert_path"
  echo "CSC_KEYCHAIN=$keychain_path"
} >> "$GITHUB_ENV"
