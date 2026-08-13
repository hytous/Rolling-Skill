const assert = require("node:assert/strict")
const {readFileSync} = require("node:fs")
const {join} = require("node:path")
const test = require("node:test")

const desktopRoot = join(__dirname, "..")

test("macOS builds use the persistent local signing identity", () => {
    const buildScript = readFileSync(
        join(desktopRoot, "scripts", "build-macos-app.sh"),
        "utf8",
    )

    assert.match(buildScript, /ensure-local-signing-identity\.sh/)
    assert.match(buildScript, /codesign[^\n]+--sign "\$SIGN_IDENTITY"/)
    assert.doesNotMatch(buildScript, /codesign[^\n]+--sign -(?:\s|$)/m)
})

test("the local identity bootstrap keeps private material out of the repository", () => {
    const bootstrap = readFileSync(
        join(desktopRoot, "scripts", "ensure-local-signing-identity.sh"),
        "utf8",
    )

    assert.match(bootstrap, /Rolling Skill Local Development/)
    assert.match(bootstrap, /security find-identity/)
    assert.match(bootstrap, /security create-keypair/)
    assert.match(bootstrap, /security add-trusted-cert/)
    assert.match(bootstrap, /mktemp -d/)
    assert.doesNotMatch(bootstrap, /desktop\/rolling-skill\/(?:assets|scripts).*\.(?:p12|pem|key)/)
})
