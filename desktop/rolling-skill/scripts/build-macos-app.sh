#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPOSITORY_ROOT="$(cd "$DESKTOP_ROOT/../.." && pwd)"
BUILT_APP="$DESKTOP_ROOT/dist/mac-arm64/Rolling Skill.app"
TARGET_APP="$REPOSITORY_ROOT/Rolling Skill.app"
BUILT_TOOL="$DESKTOP_ROOT/dist-tools/rolling-skill-tool"
TARGET_TOOL="$REPOSITORY_ROOT/rolling-skill-tool"
SIGN_IDENTITY="$(/bin/bash "$SCRIPT_DIR/ensure-local-signing-identity.sh")"
REQUIRED_NODE_MAJOR=22

select_supported_node() {
    local current_node=""
    local candidate=""
    local candidate_major=""

    current_node="$(command -v node 2>/dev/null || true)"
    for candidate in "$current_node" /opt/homebrew/bin/node /usr/local/bin/node; do
        [[ -n "$candidate" && -x "$candidate" ]] || continue
        candidate_major="$($candidate -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
        if [[ "$candidate_major" =~ ^[0-9]+$ ]] && (( candidate_major >= REQUIRED_NODE_MAJOR )); then
            export PATH="$(dirname "$candidate"):$PATH"
            return 0
        fi
    done

    echo "Node.js 22 or newer is required to build Rolling Skill." >&2
    exit 1
}

select_supported_node

if [[ "$TARGET_APP" != "$REPOSITORY_ROOT/Rolling Skill.app" ]]; then
    echo "Refusing unexpected application target: $TARGET_APP" >&2
    exit 1
fi

cd "$DESKTOP_ROOT"
npm ci
npm test
npm run pack:mac

for runtime_binary in codex codebuddy dsh; do
    if /usr/bin/find "$BUILT_APP/Contents" -type f -name "$runtime_binary" -print -quit | /usr/bin/grep -q .; then
        echo "Refusing application bundle with an embedded $runtime_binary runtime" >&2
        exit 1
    fi
done

/usr/bin/codesign --force --deep --sign "$SIGN_IDENTITY" "$BUILT_APP"
/usr/bin/codesign --verify --deep --strict --verbose=2 "$BUILT_APP"
/usr/bin/plutil -lint "$BUILT_APP/Contents/Info.plist"

if [[ -e "$TARGET_APP" ]]; then
    /bin/rm -rf "$TARGET_APP"
fi
/usr/bin/ditto "$BUILT_APP" "$TARGET_APP"
/bin/cp "$BUILT_TOOL" "$TARGET_TOOL"
/bin/chmod 755 "$TARGET_TOOL"

echo "Rolling Skill Desktop is ready: $TARGET_APP"
echo "Rolling Skill Raw Case Tool is ready: $TARGET_TOOL"
