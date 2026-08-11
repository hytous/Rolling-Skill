(function attachThreadViewState(root, factory) {
    const api = factory()
    if (typeof module === "object" && module.exports) module.exports = api
    else root.RollingSkillThreadViewState = api
})(typeof globalThis !== "undefined" ? globalThis : this, function createModule() {
    "use strict"

    const STORAGE_KEY = "rolling-skill.thread-view-state.v1"
    const STORAGE_VERSION = 1
    const NEW_TASK_CONVERSATION_ID = "__new_task__"
    const DEFAULT_MAX_ENTRIES = 500
    const DEFAULT_MAX_DRAFT_LENGTH = 120000

    function boundedInteger(value, fallback) {
        const number = Number(value)
        return Number.isInteger(number) && number > 0 ? number : fallback
    }

    function normalizedIdentity(identity) {
        const runtimeId = String(identity?.runtimeId ?? "").trim()
        const workspaceRoot = String(identity?.workspaceRoot ?? "").trim()
        const conversationId = String(identity?.conversationId ?? "").trim()
        if (!runtimeId || !workspaceRoot || !conversationId) return null
        return {runtimeId, workspaceRoot, conversationId}
    }

    function keyFor(identity) {
        const normalized = normalizedIdentity(identity)
        return normalized
            ? JSON.stringify([
                  normalized.runtimeId,
                  normalized.workspaceRoot,
                  normalized.conversationId,
              ])
            : null
    }

    function timestamp(value) {
        const candidate = value instanceof Date ? value.toISOString() : String(value ?? "")
        return Number.isFinite(Date.parse(candidate)) ? new Date(candidate).toISOString() : null
    }

    function safeDefaultStorage() {
        try {
            return typeof globalThis.localStorage === "object" ? globalThis.localStorage : null
        } catch {
            return null
        }
    }

    function createThreadViewStateStore(options = {}) {
        const storage = Object.hasOwn(options, "storage") ? options.storage : safeDefaultStorage()
        const storageKey = String(options.storageKey || STORAGE_KEY)
        const maxEntries = boundedInteger(options.maxEntries, DEFAULT_MAX_ENTRIES)
        const maxDraftLength = boundedInteger(
            options.maxDraftLength,
            DEFAULT_MAX_DRAFT_LENGTH,
        )
        const now = typeof options.now === "function" ? options.now : () => new Date()
        let entries = {}

        function normalizeStoredEntry(entry) {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null
            if (typeof entry.draft !== "string") return null
            if (!Number.isFinite(entry.scrollTop) || entry.scrollTop < 0) return null
            if (typeof entry.atBottom !== "boolean") return null
            const updatedAt = timestamp(entry.updatedAt)
            if (!updatedAt) return null
            return {
                draft: entry.draft.slice(0, maxDraftLength),
                scrollTop: entry.scrollTop,
                atBottom: entry.atBottom,
                updatedAt,
            }
        }

        function prune() {
            entries = Object.fromEntries(
                Object.entries(entries)
                    .sort((left, right) =>
                        String(right[1].updatedAt).localeCompare(String(left[1].updatedAt)),
                    )
                    .slice(0, maxEntries),
            )
        }

        function load() {
            if (!storage || typeof storage.getItem !== "function") return
            try {
                const serialized = storage.getItem(storageKey)
                if (!serialized) return
                const parsed = JSON.parse(serialized)
                if (
                    parsed?.version !== STORAGE_VERSION ||
                    !parsed.entries ||
                    typeof parsed.entries !== "object" ||
                    Array.isArray(parsed.entries)
                ) {
                    return
                }
                for (const [key, entry] of Object.entries(parsed.entries)) {
                    const normalized = normalizeStoredEntry(entry)
                    if (normalized) entries[key] = normalized
                }
                prune()
            } catch {
                entries = {}
            }
        }

        function persist() {
            if (!storage || typeof storage.setItem !== "function") return false
            try {
                storage.setItem(
                    storageKey,
                    JSON.stringify({version: STORAGE_VERSION, entries}),
                )
                return true
            } catch {
                return false
            }
        }

        function currentTimestamp() {
            return timestamp(now()) || new Date().toISOString()
        }

        function get(identity) {
            const key = keyFor(identity)
            const entry = key ? entries[key] : null
            return entry ? {...entry} : null
        }

        function set(identity, patch = {}) {
            const key = keyFor(identity)
            if (!key || !patch || typeof patch !== "object") return false
            const previous = entries[key] ?? {
                draft: "",
                scrollTop: 0,
                atBottom: true,
                updatedAt: currentTimestamp(),
            }
            const draft = Object.hasOwn(patch, "draft")
                ? String(patch.draft ?? "").slice(0, maxDraftLength)
                : previous.draft
            const requestedScrollTop = Object.hasOwn(patch, "scrollTop")
                ? Number(patch.scrollTop)
                : previous.scrollTop
            const scrollTop = Number.isFinite(requestedScrollTop)
                ? Math.max(0, requestedScrollTop)
                : previous.scrollTop
            const atBottom = Object.hasOwn(patch, "atBottom")
                ? Boolean(patch.atBottom)
                : previous.atBottom
            entries[key] = {
                draft,
                scrollTop,
                atBottom,
                updatedAt: currentTimestamp(),
            }
            prune()
            persist()
            return true
        }

        function updateDraft(identity, draft) {
            return set(identity, {draft})
        }

        function updateScroll(identity, scrollTop, atBottom) {
            return set(identity, {scrollTop, atBottom})
        }

        function clearDraft(identity) {
            const key = keyFor(identity)
            if (!key || !entries[key]) return false
            return set(identity, {draft: ""})
        }

        function remove(identity) {
            const key = keyFor(identity)
            if (!key || !entries[key]) return false
            delete entries[key]
            persist()
            return true
        }

        function migrate(sourceIdentity, targetIdentity) {
            const sourceKey = keyFor(sourceIdentity)
            const targetKey = keyFor(targetIdentity)
            if (!sourceKey || !targetKey || sourceKey === targetKey || !entries[sourceKey]) {
                return false
            }
            const source = entries[sourceKey]
            entries[targetKey] = {...source, updatedAt: currentTimestamp()}
            delete entries[sourceKey]
            prune()
            persist()
            return true
        }

        function size() {
            return Object.keys(entries).length
        }

        load()

        return {
            get,
            set,
            updateDraft,
            updateScroll,
            clearDraft,
            remove,
            migrate,
            size,
        }
    }

    return {
        STORAGE_KEY,
        NEW_TASK_CONVERSATION_ID,
        DEFAULT_MAX_ENTRIES,
        DEFAULT_MAX_DRAFT_LENGTH,
        keyFor,
        createThreadViewStateStore,
    }
})
