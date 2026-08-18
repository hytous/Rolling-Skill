;(function exposeMessageLinks(root, factory) {
    const api = factory()
    if (typeof module === "object" && module.exports) module.exports = api
    else root.RollingSkillMessageLinks = api
})(typeof globalThis === "undefined" ? this : globalThis, function createMessageLinks() {
    const candidatePattern = /\[([^\]\n]+)\]\(<?(https?:\/\/(?:[^\s()<>]|\([^()\s<>]*\))+|\/(?:[^\n()<>]|\([^()\n<>]*\))+)>?\)|<(\/[^<>\r\n]+)>|(https?:\/\/[^\s<>]+)|(\/(?:[^\s<>()]+\/)*[^\s<>()]+)/gi
    const knownLocalRoots = [
        "/Applications",
        "/Library",
        "/System",
        "/Users",
        "/Volumes",
        "/bin",
        "/dev",
        "/etc",
        "/home",
        "/opt",
        "/private",
        "/sbin",
        "/tmp",
        "/usr",
        "/var",
    ]

    function trimTrailingPunctuation(value) {
        const suffix = String(value).match(/[.,;!?，。；！？、\]}'"`]+$/u)?.[0] ?? ""
        let target = suffix ? value.slice(0, -suffix.length) : value
        let trimmedSuffix = suffix
        while (
            target.endsWith(")") &&
            (target.match(/\)/g)?.length ?? 0) > (target.match(/\(/g)?.length ?? 0)
        ) {
            target = target.slice(0, -1)
            trimmedSuffix = `)${trimmedSuffix}`
        }
        return {target, suffix: trimmedSuffix}
    }

    function isAtOrBelow(path, rootPath) {
        const root = String(rootPath ?? "").replace(/\/+$/, "")
        return Boolean(root) && (path === root || path.startsWith(`${root}/`))
    }

    function localPathReference(value, workspaceRoot = "") {
        const match = String(value ?? "").match(/^(\/.*?)(?::(\d+))?$/)
        if (!match) return null
        const path = match[1]
        const trusted =
            knownLocalRoots.some((rootPath) => isAtOrBelow(path, rootPath)) ||
            isAtOrBelow(path, workspaceRoot)
        if (!trusted) return null
        return {path, line: match[2] ? Number(match[2]) : null}
    }

    function hasBarePathBoundary(text, index) {
        if (index === 0) return true
        return /[\s([{<'"`:=：]/u.test(text[index - 1])
    }

    function pushText(tokens, text) {
        if (!text) return
        const previous = tokens.at(-1)
        if (previous?.type === "text") previous.text += text
        else tokens.push({type: "text", text})
    }

    function tokenizeMessageLinks(value, options = {}) {
        const text = String(value ?? "")
        const tokens = []
        candidatePattern.lastIndex = 0
        let cursor = 0

        for (const match of text.matchAll(candidatePattern)) {
            const markdown = match[1] !== undefined
            const angleLocal = match[3] !== undefined
            const bareLocal = match[5] !== undefined
            if (bareLocal && !hasBarePathBoundary(text, match.index)) continue

            const rawTarget = match[2] ?? match[3] ?? match[4] ?? match[5]
            const trimmed = markdown || angleLocal
                ? {target: rawTarget, suffix: ""}
                : trimTrailingPunctuation(rawTarget)
            let token = null
            if (/^https?:\/\//i.test(trimmed.target)) {
                token = {
                    type: "external",
                    label: markdown ? match[1] : trimmed.target,
                    target: trimmed.target,
                }
            } else {
                const local = localPathReference(trimmed.target, options.workspaceRoot)
                if (local) {
                    token = {
                        type: "local",
                        label: markdown ? match[1] : trimmed.target,
                        target: local.path,
                        line: local.line,
                    }
                }
            }
            if (!token) continue

            pushText(tokens, text.slice(cursor, match.index))
            tokens.push(token)
            pushText(tokens, trimmed.suffix)
            cursor = match.index + match[0].length
        }

        pushText(tokens, text.slice(cursor))
        return tokens
    }

    return {tokenizeMessageLinks}
})
