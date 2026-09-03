const {
    buildDatasetCsv,
    datasetExportFilename,
    originalFinalAssistantMessages,
} = require("../../../desktop/rolling-skill/src/dataset-csv-export.cjs")

const MUTATIONS = new Set([
    "cases.delete",
    "cases.refresh",
    "cases.refreshBatch",
    "datasets.delete",
    "rawCases.dispatch",
    "rawCases.recycle",
    "rawCases.update",
])

function copy(value) {
    return JSON.parse(JSON.stringify(value))
}

function requiredText(value, label, maximum = 4_096) {
    const text = typeof value === "string" ? value.trim() : ""
    if (!text || text.length > maximum) throw new Error(`${label} is required`)
    return text
}

function pageNumber(value, fallback, label, maximum) {
    const number = value === undefined ? fallback : Number(value)
    if (!Number.isSafeInteger(number) || number < 1 || number > maximum) {
        throw new Error(`${label} is invalid`)
    }
    return number
}

function currentCase(store, datasetId, caseId) {
    const entry = store.listCases(datasetId).find((candidate) => candidate.id === caseId)
    if (!entry) throw new Error("Unknown Case")
    return entry
}

function assertExpected(value, expected, label) {
    if (expected === undefined || expected === null) return
    if (String(value ?? "") !== String(expected)) {
        throw new Error(`${label} changed since it was loaded`)
    }
}

function fingerprint(method, input) {
    return JSON.stringify({method, input})
}

function createCaseServices({store, rawCaseStore, recycleService, refreshManager = null, dispatchRawCase = null}) {
    if (!store || !rawCaseStore || !recycleService) {
        throw new Error("Rolling Skill Case service dependencies are required")
    }
    const completed = new Map()

    async function once(method, input, operation) {
        const idempotencyKey = requiredText(input.idempotencyKey, "Idempotency key", 500)
        const key = `${method}\u0000${idempotencyKey}`
        const signature = fingerprint(method, input)
        const previous = completed.get(key)
        if (previous) {
            if (previous.signature !== signature) {
                throw new Error("Idempotency key was already used with different input")
            }
            return copy(await previous.value)
        }
        const pending = Promise.resolve().then(operation)
        completed.set(key, {signature, value: pending})
        try {
            return copy(await pending)
        } catch (error) {
            completed.delete(key)
            throw error
        }
    }

    function requireRefreshManager() {
        if (!refreshManager || typeof refreshManager.createSession !== "function") {
            throw new Error("Case refresh Runtime is unavailable")
        }
        return refreshManager
    }

    const methods = {
        "cases.list": ({datasetId, page = 1, pageSize = 50, caseScope = "all"}) => {
            const normalizedDatasetId = requiredText(datasetId, "Dataset id", 200)
            const normalizedPage = pageNumber(page, 1, "Case page", 1_000_000)
            const normalizedPageSize = pageNumber(pageSize, 50, "Case page size", 200)
            if (caseScope !== "all" && caseScope !== "goodcase" && caseScope !== "badcase") {
                throw new Error("Case scope is unsupported")
            }
            const selected = store.listCases(normalizedDatasetId)
                .filter((entry) => caseScope === "all" || entry.caseType === caseScope)
            const total = selected.length
            const offset = (normalizedPage - 1) * normalizedPageSize
            return {
                items: selected.slice(offset, offset + normalizedPageSize),
                page: normalizedPage,
                pageSize: normalizedPageSize,
                total,
                pageCount: Math.ceil(total / normalizedPageSize),
            }
        },
        "cases.get": ({datasetId, caseId}) => currentCase(
            store,
            requiredText(datasetId, "Dataset id", 200),
            requiredText(caseId, "Case id", 200),
        ),
        "cases.delete": (input) => once("cases.delete", input, () => {
            const datasetId = requiredText(input.datasetId, "Dataset id", 200)
            const caseId = requiredText(input.caseId, "Case id", 200)
            const entry = currentCase(store, datasetId, caseId)
            assertExpected(entry.updatedAt, input.expectedUpdatedAt, "Case")
            return recycleService.deleteCase({
                datasetId,
                caseId,
                recoverQuestions: input.recoverQuestions !== false,
            })
        }),
        "cases.refresh": (input) => once("cases.refresh", input, () => {
            const datasetId = requiredText(input.datasetId, "Dataset id", 200)
            const caseId = requiredText(input.caseId, "Case id", 200)
            const entry = currentCase(store, datasetId, caseId)
            assertExpected(entry.updatedAt, input.expectedUpdatedAt, "Case")
            return requireRefreshManager().createSession({
                datasetId,
                caseId,
                runtimeId: optionalRuntimeId(input.runtimeId),
            })
        }),
        "cases.refreshBatch": (input) => once("cases.refreshBatch", input, async () => {
            const datasetId = requiredText(input.datasetId, "Dataset id", 200)
            const scope = input.scope ?? "goodcase"
            if (scope !== "goodcase" && scope !== "all") {
                throw new Error("Case refresh scope is unsupported")
            }
            const active = new Set(store.listCurationSessions()
                .filter((session) =>
                    session.operation === "refresh" &&
                    session.status !== "archived" &&
                    session.status !== "cancelled",
                )
                .map((session) => session.targetCaseId))
            const skipped = []
            const eligible = []
            for (const entry of store.listCases(datasetId)) {
                if (scope === "goodcase" && entry.caseType !== "goodcase") continue
                if (active.has(entry.id)) {
                    skipped.push({caseId: entry.id, reason: "refresh-in-progress"})
                } else {
                    eligible.push(entry)
                }
            }
            const sessions = []
            const failures = []
            for (const entry of eligible) {
                try {
                    sessions.push(await requireRefreshManager().createSession({
                        datasetId,
                        caseId: entry.id,
                        runtimeId: optionalRuntimeId(input.runtimeId),
                    }))
                } catch (error) {
                    failures.push({caseId: entry.id, error: error?.message ?? String(error)})
                }
            }
            return {scope, eligibleCount: eligible.length, skipped, sessions, ...(failures.length ? {failures} : {})}
        }),
        "datasets.delete": (input) => once("datasets.delete", input, () => {
            const datasetId = requiredText(input.datasetId, "Dataset id", 200)
            const dataset = store.getDataset(datasetId)
            assertExpected(dataset.createdAt, input.expectedCreatedAt, "Dataset")
            return recycleService.deleteDataset({
                datasetId,
                recoverQuestions: input.recoverQuestions !== false,
            })
        }),
        "datasets.exportCsv": ({datasetId, caseScope = "all", outputMode = "curated"}) => {
            const normalizedDatasetId = requiredText(datasetId, "Dataset id", 200)
            const dataset = store.getDataset(normalizedDatasetId)
            const allCases = store.listCases(normalizedDatasetId)
            const selected = caseScope === "goodcase"
                ? allCases.filter((entry) => entry.caseType === "goodcase")
                : allCases
            const options = {caseScope, outputMode}
            return {
                filename: datasetExportFilename(dataset.name, options),
                content: buildDatasetCsv(allCases, options),
                caseCount: selected.length,
                missingOriginalCount: outputMode === "original"
                    ? selected.filter((entry) => !originalFinalAssistantMessages(entry).length).length
                    : 0,
            }
        },
        "rawCases.dispatch": (input) => once("rawCases.dispatch", input, async () => {
            if (typeof dispatchRawCase !== "function") {
                throw new Error("Native DSH Session dispatch is unavailable")
            }
            if (input.target !== "new" && input.target !== "current") {
                throw new Error("Raw Case dispatch target is unsupported")
            }
            const targetSessionId = input.target === "current"
                ? requiredText(input.sessionId, "Current DSH Session id", 300)
                : null
            const id = requiredText(input.id, "Raw Case id", 200)
            const rawCase = rawCaseStore.requireRecord(id)
            const dispatched = await dispatchRawCase({
                question: rawCase.question,
                note: rawCase.note ?? "",
                skill: rawCase.skill ? {
                    ...(typeof rawCase.skill.id === "string" ? {id: rawCase.skill.id} : {}),
                    name: rawCase.skill.name,
                } : null,
                target: input.target,
                ...(targetSessionId ? {sessionId: targetSessionId} : {}),
            })
            const sessionId = requiredText(dispatched?.sessionId, "Dispatched DSH Session id", 300)
            const result = {
                sessionId,
                status: typeof dispatched.status === "string" ? dispatched.status : "queued",
                target: input.target,
            }
            rawCaseStore.markDispatched(id, {mode: input.target, ...result})
            return result
        }),
        "rawCases.update": (input) => once("rawCases.update", input, () =>
            rawCaseStore.updateIfCurrent(
                requiredText(input.id, "Raw Case id", 200),
                {
                    expectedRevision: input.expectedRevision,
                    expectedSkillName: requiredText(input.expectedSkillName, "Raw Case Skill name", 200),
                },
                input.changes ?? {},
            ),
        ),
        "rawCases.recycle": (input) => once("rawCases.recycle", input, () =>
            rawCaseStore.delete(requiredText(input.id, "Raw Case id", 200)),
        ),
    }

    async function dispatch(method, input = {}) {
        if (!Object.hasOwn(methods, method)) throw new Error(`Unknown Case service method: ${method}`)
        return copy(await methods[method](copy(input)))
    }

    return Object.freeze({dispatch, methods: Object.freeze(methods), mutations: MUTATIONS})
}

function optionalRuntimeId(value) {
    return value === undefined || value === null || value === ""
        ? null
        : requiredText(value, "Runtime id", 500)
}

module.exports = {createCaseServices}
