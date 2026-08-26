const assert = require("node:assert/strict")
const {readFileSync, readdirSync, statSync} = require("node:fs")
const {join} = require("node:path")
const {it} = require("node:test")

it("does not ship package lifecycle hooks that delete Rolling Skill user data", () => {
    const packageRoot = join(__dirname, "..")
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"))
    assert.equal(Object.keys(manifest.scripts ?? {}).some((name) => /uninstall|postuninstall|preuninstall/iu.test(name)), false)

    const sources = []
    function visit(directory) {
        for (const name of readdirSync(directory)) {
            const path = join(directory, name)
            if (statSync(path).isDirectory()) visit(path)
            else sources.push(readFileSync(path, "utf8"))
        }
    }
    visit(join(packageRoot, "src"))
    assert.doesNotMatch(sources.join("\n"), /uninstall.*(?:rm|remove).*data|deleteUserData|clearUserData/iu)
})
