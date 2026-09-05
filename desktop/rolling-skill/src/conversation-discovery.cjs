const CAPTURE_CADENCES = new Set(["daily", "weekly"])

function scheduleParts(schedule = {}) {
    if (!CAPTURE_CADENCES.has(schedule.cadence)) {
        throw new Error("Automatic capture cadence is invalid")
    }
    const match = /^(?:([01]\d|2[0-3])):([0-5]\d)$/u.exec(String(schedule.time ?? ""))
    if (!match) throw new Error("Automatic capture time is invalid")
    const weekday = Number(schedule.weekday)
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
        throw new Error("Automatic capture weekday is invalid")
    }
    return {cadence: schedule.cadence, hour: Number(match[1]), minute: Number(match[2]), weekday}
}

function localSlot(year, month, day, hour, minute) {
    return new Date(year, month, day, hour, minute, 0, 0)
}

function previousScheduledSlot(nowInput, schedule) {
    const now = new Date(nowInput)
    if (!Number.isFinite(now.getTime())) throw new Error("Automatic capture current time is invalid")
    const {cadence, hour, minute, weekday} = scheduleParts(schedule)
    const candidate = localSlot(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute)
    if (cadence === "daily") {
        if (candidate > now) candidate.setDate(candidate.getDate() - 1)
        return candidate
    }
    candidate.setDate(candidate.getDate() + weekday - candidate.getDay())
    if (candidate > now) candidate.setDate(candidate.getDate() - 7)
    return candidate
}

function nextScheduledSlot(nowInput, schedule) {
    const now = new Date(nowInput)
    if (!Number.isFinite(now.getTime())) throw new Error("Automatic capture current time is invalid")
    const {cadence, hour, minute, weekday} = scheduleParts(schedule)
    const candidate = localSlot(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute)
    if (cadence === "daily") {
        if (candidate <= now) candidate.setDate(candidate.getDate() + 1)
        return candidate
    }
    candidate.setDate(candidate.getDate() + weekday - candidate.getDay())
    if (candidate <= now) candidate.setDate(candidate.getDate() + 7)
    return candidate
}

function dueCaptureSlot({now = new Date(), schedule, lastScheduledSlot = null} = {}) {
    const due = previousScheduledSlot(now, schedule)
    if (!lastScheduledSlot) return due
    const satisfied = new Date(lastScheduledSlot)
    if (!Number.isFinite(satisfied.getTime())) return due
    return satisfied >= due ? null : due
}

function requiredText(value, label, maximum = 4_000) {
    const normalized = String(value ?? "").trim()
    if (!normalized) throw new Error(`${label} is required`)
    if (normalized.length > maximum) throw new Error(`${label} is too long`)
    return normalized
}

function exactKeys(value, expected, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${label} JSON schema is invalid`)
    }
    const actual = Object.keys(value).sort()
    const wanted = [...expected].sort()
    if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
        throw new Error(`${label} JSON contains unsupported fields`)
    }
}

function firstJsonObject(text) {
    const source = String(text ?? "")
    const start = source.indexOf("{")
    if (start < 0) throw new Error("Analysis did not return a JSON object")
    let depth = 0
    let inString = false
    let escaped = false
    for (let index = start; index < source.length; index += 1) {
        const character = source[index]
        if (inString) {
            if (escaped) escaped = false
            else if (character === "\\") escaped = true
            else if (character === '"') inString = false
            continue
        }
        if (character === '"') {
            inString = true
            continue
        }
        if (character === "{") depth += 1
        if (character === "}") {
            depth -= 1
            if (depth === 0) {
                try {
                    return JSON.parse(source.slice(start, index + 1))
                } catch (error) {
                    throw new Error(`Analysis returned invalid JSON: ${error.message}`)
                }
            }
        }
    }
    throw new Error("Analysis returned incomplete JSON")
}

function boundaryMessages(userMessages = []) {
    return userMessages.map((message) => ({
        id: requiredText(message?.id, "User Item id"),
        turnId: requiredText(message?.turnId, "User turn id"),
        text: String(message?.text ?? ""),
    }))
}

function buildBoundaryPrompt({threadId, userMessages} = {}) {
    const input = {
        threadId: requiredText(threadId, "Thread id"),
        userMessages: boundaryMessages(userMessages),
    }
    return `Identify complete user problem ranges from incremental user messages only.
Keep follow-ups, corrections, and clarifications for the same problem in one range. Close a range
when a new intent begins. Leave the final unfinished problem in pendingStartUserItemId. Use only
the supplied stable IDs. Do not create a range for Rolling Skill internal orchestration, Skill
installation or maintenance, Rubric/Curator/Judge work, evaluation or optimization tasks, generated
agent-to-agent prompts, or test fixtures; for a batch containing only those messages, return no
segments and no pending range. Return JSON only with this exact schema:
{"segments":[{"startUserItemId":"id","endUserItemId":"id","summary":"short text"}],"pendingStartUserItemId":"id-or-null"}
<incremental-user-messages>${JSON.stringify(input)}</incremental-user-messages>`
}

function parseBoundaryResult(text, {userMessageIds = []} = {}) {
    const value = firstJsonObject(text)
    exactKeys(value, ["segments", "pendingStartUserItemId"], "Boundary result")
    if (!Array.isArray(value.segments)) throw new Error("Boundary result segments are invalid")
    const ids = userMessageIds.map((id) => requiredText(id, "User Item id"))
    const positions = new Map(ids.map((id, index) => [id, index]))
    let previousEnd = -1
    const segments = value.segments.map((segment) => {
        exactKeys(segment, ["startUserItemId", "endUserItemId", "summary"], "Boundary segment")
        const startUserItemId = requiredText(segment.startUserItemId, "Boundary start user Item id")
        const endUserItemId = requiredText(segment.endUserItemId, "Boundary end user Item id")
        const start = positions.get(startUserItemId)
        const end = positions.get(endUserItemId)
        if (start === undefined || end === undefined) {
            throw new Error("Boundary segment references an unknown user Item id")
        }
        if (start > end || start <= previousEnd) {
            throw new Error("Boundary segments overlap or are out of order")
        }
        previousEnd = end
        return {
            startUserItemId,
            endUserItemId,
            summary: requiredText(segment.summary, "Boundary summary", 500),
        }
    })
    const pendingStartUserItemId = value.pendingStartUserItemId === null
        ? null
        : requiredText(value.pendingStartUserItemId, "Pending start user Item id")
    if (pendingStartUserItemId !== null) {
        const pending = positions.get(pendingStartUserItemId)
        if (pending === undefined) throw new Error("Pending range references an unknown user Item id")
        if (pending <= previousEnd) throw new Error("Pending range overlaps a completed segment")
    }
    return {segments, pendingStartUserItemId}
}

function compactEpisodeItem(item = {}) {
    return {
        id: String(item.id ?? ""),
        turnId: String(item.turnId ?? ""),
        type: String(item.type ?? ""),
        text: String(item.text ?? ""),
    }
}

function compactActivity(activity = {}) {
    const fields = ["type", "status", "server", "tool", "command", "name", "skillName"]
    return Object.fromEntries(
        fields
            .filter((field) => activity[field] !== undefined && activity[field] !== null)
            .map((field) => [field, String(activity[field]).slice(0, 4_000)]),
    )
}

function buildOutcomePrompt({threadId, episode = {}, skills = [], datasets = []} = {}) {
    const input = {
        threadId: requiredText(threadId, "Thread id"),
        episode: {
            originalQuestion: String(episode.originalQuestion ?? ""),
            items: (episode.items ?? []).map(compactEpisodeItem),
            activity: (episode.toolActivity ?? []).map(compactActivity),
        },
        enabledSkills: skills.map((skill) => ({
            name: String(skill?.name ?? ""),
            description: String(skill?.description ?? "").slice(0, 4_000),
            path: skill?.path ? String(skill.path) : null,
            runtimeId: skill?.runtimeId ? String(skill.runtimeId) : null,
        })),
        datasetBindings: datasets.map((dataset) => ({
            id: String(dataset?.id ?? ""),
            name: String(dataset?.name ?? ""),
            skill: dataset?.skillReference
                ? {
                    name: String(dataset.skillReference.name ?? ""),
                    path: dataset.skillReference.path ? String(dataset.skillReference.path) : null,
                }
                : null,
        })),
    }
    return `Decide whether this completed episode is eligible to become a Skill evaluation Case.
The supplied enabledSkills list is the complete user-selected managed Skill target set. Do not infer any other local or system Skill, even when the episode resembles or mentions it; if no listed Skill clearly applies, mark the episode ineligible.
A human-authored request is necessary but not sufficient. Apply this counterfactual domain check: would the originalQuestion require invoking the selected Skill for the domain described in enabledSkills if Rolling Skill, Dataset, Runtime, and automation controls were removed from context? If no, mark it ineligible. Generic word overlap is not domain evidence: debugging an optimization button is not a cost optimization task, and configuring a Dataset for a Skill is not a task for that Skill.
A Case must be a human-authored real-world problem intended for one enabled Skill. Exclude Rolling
Skill internal orchestration, automatic detection, Curator, Rubric, Judge, Case refresh, evaluation,
optimization, Skill installation/audit/maintenance, generated agent-to-agent prompts, and test
fixtures. Embedded source questions, Skill names, rubrics, or successful outputs do not make an
internal task eligible. For an ineligible episode set skillName and caseType to null. Otherwise
judge the purpose and provenance of the request, not just the product names it mentions. A human
incident report about Rolling Skill can use sourceKind human_task, but it remains ineligible unless
the originalQuestion itself is in an enabled Skill's described domain. Keep generated orchestration
and synthetic test fixtures excluded.
Identify the principal enabled Skill, outcome, recommended Case type, and final Assistant Item. Copy
finalAssistantItemId exactly from a supplied agentMessage id; use null if no exact id applies.
Return JSON only with this exact schema:
{"eligibleForCase":true,"sourceKind":"human_task|rolling_skill_internal|skill_installation|evaluation_or_optimization|other_internal","skillName":"name-or-null","outcome":"resolved|unresolved|uncertain","caseType":"goodcase|badcase|null","finalAssistantItemId":"id-or-null","confidence":0.8,"reason":"short text"}
<candidate-episode>${JSON.stringify(input)}</candidate-episode>`
}

function parseOutcomeResult(text, {skillNames = [], assistantItemIds = []} = {}) {
    const value = firstJsonObject(text)
    exactKeys(
        value,
        [
            "eligibleForCase",
            "sourceKind",
            "skillName",
            "outcome",
            "caseType",
            "finalAssistantItemId",
            "confidence",
            "reason",
        ],
        "Outcome result",
    )
    if (typeof value.eligibleForCase !== "boolean") {
        throw new Error("Outcome Case eligibility is invalid")
    }
    if (!new Set([
        "human_task",
        "rolling_skill_internal",
        "skill_installation",
        "evaluation_or_optimization",
        "other_internal",
    ]).has(value.sourceKind)) {
        throw new Error("Outcome source kind is invalid")
    }
    const skillName = value.skillName === null ? null : requiredText(value.skillName, "Outcome Skill name")
    if (skillName !== null && !skillNames.includes(skillName)) {
        throw new Error("Outcome result references an unknown Skill")
    }
    if (!new Set(["resolved", "unresolved", "uncertain"]).has(value.outcome)) {
        throw new Error("Outcome result status is invalid")
    }
    const caseType = value.caseType === null ? null : value.caseType
    if (caseType !== null && !new Set(["goodcase", "badcase"]).has(caseType)) {
        throw new Error("Outcome result Case type is invalid")
    }
    if (value.eligibleForCase && value.sourceKind !== "human_task") {
        throw new Error("Eligible Case must come from a human task")
    }
    if (value.eligibleForCase && (skillName === null || caseType === null)) {
        throw new Error("Eligible Case requires a Skill and Case type")
    }
    if (!value.eligibleForCase && (skillName !== null || caseType !== null)) {
        throw new Error("Ineligible episode cannot select a Skill or Case type")
    }
    let finalAssistantItemId = value.finalAssistantItemId === null
        ? null
        : requiredText(value.finalAssistantItemId, "Final Assistant Item id")
    if (finalAssistantItemId !== null && !assistantItemIds.includes(finalAssistantItemId)) {
        // This optional locator is model-produced. Never trust an invented id,
        // but do not fail the whole scan over a transcription error: callers
        // safely fall back to the already-frozen Episode end boundary.
        finalAssistantItemId = null
    }
    if (typeof value.confidence !== "number" || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) {
        throw new Error("Outcome confidence must be between 0 and 1")
    }
    return {
        eligibleForCase: value.eligibleForCase,
        sourceKind: value.sourceKind,
        skillName,
        outcome: value.outcome,
        caseType,
        finalAssistantItemId,
        confidence: value.confidence,
        reason: requiredText(value.reason, "Outcome reason", 1_000),
    }
}

function partitionUserMessages(messages = [], {maxMessages = 40, maxCharacters = 24_000} = {}) {
    if (!Number.isInteger(maxMessages) || maxMessages < 1) throw new Error("Message budget is invalid")
    if (!Number.isInteger(maxCharacters) || maxCharacters < 1) throw new Error("Character budget is invalid")
    const batches = []
    let batch = []
    let characters = 0
    for (const message of messages) {
        const length = String(message?.text ?? "").length
        if (batch.length && (batch.length >= maxMessages || characters + length > maxCharacters)) {
            batches.push(batch)
            batch = []
            characters = 0
        }
        batch.push(message)
        characters += length
        if (batch.length >= maxMessages || characters >= maxCharacters) {
            batches.push(batch)
            batch = []
            characters = 0
        }
    }
    if (batch.length) batches.push(batch)
    return batches
}

module.exports = {
    buildBoundaryPrompt,
    buildOutcomePrompt,
    dueCaptureSlot,
    nextScheduledSlot,
    parseBoundaryResult,
    parseOutcomeResult,
    partitionUserMessages,
    previousScheduledSlot,
}
