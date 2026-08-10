#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPOSITORY_ROOT="$(cd "$DESKTOP_ROOT/../.." && pwd)"
BUILT_APP="$DESKTOP_ROOT/dist/mac-arm64/Rolling Skill.app"
TARGET_APP="$REPOSITORY_ROOT/Rolling Skill.app"

if [[ "$TARGET_APP" != "$REPOSITORY_ROOT/Rolling Skill.app" ]]; then
    echo "Refusing unexpected application target: $TARGET_APP" >&2
    exit 1
fi

cd "$DESKTOP_ROOT"
npm ci
npm test
npm run pack:mac

/usr/bin/codesign --force --deep --sign - "$BUILT_APP"
/usr/bin/codesign --verify --deep --strict --verbose=2 "$BUILT_APP"
/usr/bin/plutil -lint "$BUILT_APP/Contents/Info.plist"

if [[ -e "$TARGET_APP" ]]; then
    /bin/rm -rf "$TARGET_APP"
fi
/usr/bin/ditto "$BUILT_APP" "$TARGET_APP"

echo "Rolling Skill Desktop is ready: $TARGET_APP"
