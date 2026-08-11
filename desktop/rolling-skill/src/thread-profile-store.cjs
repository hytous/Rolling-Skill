const MAX_THREAD_PROFILES = 500

function profileKey(runtimeId, threadId) {
    const runtime = String(runtimeId ?? "").trim()
    const thread = String(threadId ?? "").trim()
    if (!runtime || !thread) return null
    return `${encodeURIComponent(runtime)}::${encodeURIComponent(thread)}`
}

function optionalValue(value) {
    if (value === null || value === undefined || String(value).trim() === "") return null
    const normalized = String(value).trim()
    return normalized.length <= 200 ? normalized : null
}

function readThreadProfile(preferences, runtimeId, threadId) {
    const key = profileKey(runtimeId, threadId)
    const entry = key ? preferences?.threadProfiles?.[key] : null
    if (!entry || typeof entry !== "object") return null
    const profile = {updatedAt: String(entry.updatedAt ?? "")}
    if (Object.hasOwn(entry, "modelId")) profile.modelId = optionalValue(entry.modelId)
    if (Object.hasOwn(entry, "effort")) profile.effort = optionalValue(entry.effort)
    return profile
}

function updateThreadProfiles(
    currentProfiles,
    runtimeId,
    threadId,
    patch = {},
    updatedAt = new Date().toISOString(),
) {
    const key = profileKey(runtimeId, threadId)
    if (!key) return {...(currentProfiles ?? {})}
    const profiles =
        currentProfiles && typeof currentProfiles === "object" ? {...currentProfiles} : {}
    const previous = profiles[key] && typeof profiles[key] === "object" ? profiles[key] : {}
    const next = {updatedAt: String(updatedAt)}
    if (Object.hasOwn(patch, "modelId")) next.modelId = optionalValue(patch.modelId)
    else if (Object.hasOwn(previous, "modelId")) next.modelId = optionalValue(previous.modelId)
    if (Object.hasOwn(patch, "effort")) next.effort = optionalValue(patch.effort)
    else if (Object.hasOwn(previous, "effort")) next.effort = optionalValue(previous.effort)
    profiles[key] = next
    return Object.fromEntries(
        Object.entries(profiles)
            .sort((left, right) =>
                String(right[1]?.updatedAt ?? "").localeCompare(
                    String(left[1]?.updatedAt ?? ""),
                ),
            )
            .slice(0, MAX_THREAD_PROFILES),
    )
}

module.exports = {readThreadProfile, updateThreadProfiles}
