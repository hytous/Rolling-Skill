#!/bin/bash
set -euo pipefail

CERTIFICATE_NAME="Rolling Skill Local Development"
LOGIN_KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"

find_identity() {
    /usr/bin/security find-identity -p codesigning "$LOGIN_KEYCHAIN" 2>/dev/null |
        /usr/bin/awk -F'"' -v name="$CERTIFICATE_NAME" '
            $2 == name && $0 !~ /CSSMERR_/ {
                identity = $1
                sub(/^[[:space:]]*[0-9]+\)[[:space:]]*/, "", identity)
                sub(/[[:space:]]*$/, "", identity)
                print identity
                exit
            }
        '
}

SIGN_IDENTITY="$(find_identity)"
if [[ -n "$SIGN_IDENTITY" ]]; then
    printf '%s\n' "$SIGN_IDENTITY"
    exit 0
fi

TEMPORARY_DIRECTORY="$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/rolling-skill-signing.XXXXXX")"
cleanup() {
    if [[ "$TEMPORARY_DIRECTORY" == */rolling-skill-signing.* ]]; then
        /bin/rm -rf -- "$TEMPORARY_DIRECTORY"
    fi
}
trap cleanup EXIT

CERTIFICATE="$TEMPORARY_DIRECTORY/certificate.pem"

if ! /usr/bin/security find-certificate -c "$CERTIFICATE_NAME" "$LOGIN_KEYCHAIN" >/dev/null 2>&1; then
    /usr/bin/security create-keypair \
        -a rsa \
        -s 2048 \
        -d 3650 \
        -k "$LOGIN_KEYCHAIN" \
        -T /usr/bin/codesign \
        -T /usr/bin/security \
        "$CERTIFICATE_NAME"
fi

/usr/bin/security find-certificate \
    -c "$CERTIFICATE_NAME" \
    -p "$LOGIN_KEYCHAIN" \
    > "$CERTIFICATE"
/usr/bin/security add-trusted-cert \
    -r trustRoot \
    -p codeSign \
    -k "$LOGIN_KEYCHAIN" \
    "$CERTIFICATE"

SIGN_IDENTITY="$(find_identity)"
if [[ -z "$SIGN_IDENTITY" ]]; then
    echo "Failed to create the persistent Rolling Skill signing identity" >&2
    exit 1
fi

printf '%s\n' "$SIGN_IDENTITY"
