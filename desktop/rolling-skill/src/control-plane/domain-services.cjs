const {isAbsolute, win32} = require("node:path")

const {
    CONTROL_METHODS,
    createPublicControlError,
    decodeCursor,
    encodeCursor,
} = require("./contracts.cjs")

const FILTER_METHODS = Object.freeze({
    "context.get": "runtimeIds",
    "raw_cases.list": "skillIds",
    "runtimes.list": "runtimeIds",
    "datasets.list": "datasetIds",
    "skills.list": "skillIds",
})

const SAFE_ERROR_MESSAGES = Object.freeze({
    INVALID_ARGUMENT: "Invalid domain service input",
    NOT_FOUND: "Control object was not found",
})

class DomainServiceError extends Error {
    constructor(code) {
        super(SAFE_ERROR_MESSAGES[code] ?? "Control operation failed")
        this.code = code
    }
}

function invalidArgument() {
    return new DomainServiceError("INVALID_ARGUMENT")
}

function notFound(resource) {
    return createPublicControlError("NOT_FOUND", {details: {resource}})
}

function clone(value) {
    return value === undefined ? undefined : structuredClone(value)
}

function identifier(value) {
    return typeof value === "string" && value.length > 0 && value.length <= 200
        ? value
        : null
}

function toolPathIsAbsolute(value) {
    return typeof value === "string" && (isAbsolute(value) || win32.isAbsolute(value))
}

function normalizedPath(value) {
    return typeof value === "string" ? value.replace(/\\/gu, "/").replace(/\/$/u, "") : null
}

function arrayFromInventory(value, keys = []) {
    if (Array.isArray(value)) return value
    for (const key of keys) {
        if (Array.isArray(value?.[key])) return value[key]
    }
    return []
}

function unique(values) {
    return [...new Set(values)]
}

function scopeIds(context, key) {
    const value = context?.scopeFilter?.[key]
    return new Set(Array.isArray(value) ? value : [])
}

function paginate(items, {cursor, limit}) {
    const sequence = cursor === null ? 0 : decodeCursor(cursor)
    const page = items.slice(sequence, sequence + limit)
    const nextSequence = sequence + page.length
    return {
        items: page,
        nextCursor: nextSequence < items.length ? encodeCursor(nextSequence) : null,
    }
}

function sanitizedSkillDetail(detail) {
    if (!detail || typeof detail !== "object") return detail
    const result = clone(detail)
    if (result.repository && typeof result.repository === "object") {
        delete result.repository.managedPath
    }
    return result
}

function createDomainServices(dependencies = {}) {
    const {
        rawCaseStore,
        evaluationStore,
        evaluationRunner,
        managedSkillManager,
        listRuntimes,
        listModelsForRuntime,
        dispatchRawCase,
        startEvaluation,
    } = dependencies

    async function runtimeInventory() {
        const inventory = typeof listRuntimes === "function" ? await listRuntimes() : []
        return clone(arrayFromInventory(inventory, ["available", "runtimes", "data"]))
    }

    async function requireRuntime(runtimeId) {
        const runtime = (await runtimeInventory()).find((entry) => entry?.runtimeId === runtimeId)
        if (!runtime) throw notFound("runtime")
        return runtime
    }

    async function skillInventory() {
        const overview = typeof managedSkillManager?.overview === "function"
            ? await managedSkillManager.overview()
            : {skills: []}
        return clone(arrayFromInventory(overview, ["skills"]))
    }

    function skillPathAliases(skill) {
        return unique([
            skill?.path,
            skill?.skillRoot,
            skill?.manifestPath,
        ].map(normalizedPath).filter(Boolean))
    }

    async function resolveSkillReference(reference, {toolSupplied = false} = {}) {
        if (!reference || typeof reference !== "object") throw invalidArgument()
        const name = identifier(reference.name)
        if (name === null) throw invalidArgument()
        if (toolSupplied && toolPathIsAbsolute(reference.path)) throw invalidArgument()

        const candidates = (await skillInventory()).filter((skill) => skill?.name === name)
        if (candidates.length === 0) throw notFound("skill")
        let selected = candidates.length === 1 ? candidates[0] : null
        const requestedPath = normalizedPath(reference.path)
        if (requestedPath !== null) {
            const pathMatches = candidates.filter((skill) =>
                skillPathAliases(skill).includes(requestedPath),
            )
            if (pathMatches.length === 1) selected = pathMatches[0]
            else if (toolSupplied || selected === null) throw notFound("skill")
        }
        if (!selected) throw notFound("skill")
        return selected
    }

    function canonicalSkillReference(skill) {
        const reference = {name: skill.name}
        const trustedPath = typeof skill.path === "string" && skill.path
            ? skill.path
            : null
        if (trustedPath) reference.path = trustedPath
        return reference
    }

    async function rawCaseInventory(skillName = null) {
        if (typeof rawCaseStore?.list !== "function") return []
        return clone(await rawCaseStore.list({skillName}))
    }

    async function requireRawCase(id) {
        let rawCase = null
        if (typeof rawCaseStore?.get === "function") rawCase = await rawCaseStore.get(id)
        else rawCase = (await rawCaseInventory()).find((entry) => entry?.id === id) ?? null
        if (!rawCase || rawCase.id !== id) throw notFound("raw_case")
        return clone(rawCase)
    }

    async function datasetInventory() {
        if (typeof evaluationStore?.listDatasets !== "function") return []
        return clone(await evaluationStore.listDatasets())
    }

    async function requireDataset(datasetId) {
        const summary = (await datasetInventory()).find((entry) => entry?.id === datasetId)
        if (!summary) throw notFound("dataset")
        if (typeof evaluationStore?.getDataset !== "function") return summary
        try {
            const dataset = await evaluationStore.getDataset(datasetId)
            if (!dataset || dataset.id !== datasetId) throw notFound("dataset")
            return clone(dataset)
        } catch (error) {
            if (error instanceof DomainServiceError) throw error
            throw notFound("dataset")
        }
    }

    async function casesForDataset(datasetId) {
        if (typeof evaluationStore?.listCases !== "function") return []
        return clone(await evaluationStore.listCases(datasetId))
            .filter((entry) => entry?.datasetId === datasetId)
    }

    async function validateEvaluationStart(input) {
        await requireDataset(input.datasetId)
        const cases = await casesForDataset(input.datasetId)
        const caseIds = new Set(cases.map((entry) => entry.id))
        if (input.caseIds.some((caseId) => !caseIds.has(caseId))) {
            throw notFound("case")
        }
        for (const profile of input.runtimeConfigurations) {
            await requireRuntime(profile.runtimeId)
        }
        await requireRuntime(input.judgeConfiguration.runtimeId)
    }

    async function runInventory(datasetId = null) {
        const list = evaluationStore?.listEvaluationRunSummaries ??
            evaluationStore?.listEvaluationRuns
        if (typeof list !== "function") return []
        const runs = clone(await list.call(evaluationStore, datasetId))
        return Array.isArray(runs)
            ? runs.filter((entry) => datasetId === null || entry?.datasetId === datasetId)
            : []
    }

    async function requireEvaluationRun(runId) {
        const summary = (await runInventory(null)).find((entry) => entry?.id === runId)
        if (!summary) throw notFound("evaluation_run")
        if (typeof evaluationStore?.getEvaluationRun !== "function") return summary
        try {
            const run = await evaluationStore.getEvaluationRun(runId)
            if (!run || run.id !== runId) throw notFound("evaluation_run")
            return clone(run)
        } catch (error) {
            if (error instanceof DomainServiceError) throw error
            throw notFound("evaluation_run")
        }
    }

    async function requireSkill(skillId) {
        const skill = (await skillInventory()).find((entry) => entry?.id === skillId)
        if (!skill) throw notFound("skill")
        return skill
    }

    async function filteredRawCases(input, context) {
        const allowed = scopeIds(context, "skillIds")
        if (allowed.size === 0) return []
        const records = await rawCaseInventory(input.skillName)
        const visible = []
        for (const record of records) {
            try {
                const owner = await resolveSkillReference(record.skill)
                if (allowed.has(owner.id)) visible.push(record)
            } catch {}
        }
        return visible
    }

    async function filterResolution(method, grant) {
        const key = FILTER_METHODS[method]
        const granted = new Set(Array.isArray(grant?.scopes?.[key]) ? grant.scopes[key] : [])
        let inventoryIds = []
        if (key === "runtimeIds") {
            inventoryIds = (await runtimeInventory()).map((entry) => entry?.runtimeId)
        } else if (key === "datasetIds") {
            inventoryIds = (await datasetInventory()).map((entry) => entry?.id)
        } else {
            inventoryIds = (await skillInventory()).map((entry) => entry?.id)
        }
        return {
            method,
            mode: "filter",
            [key]: unique(inventoryIds.filter((id) => granted.has(id))),
        }
    }

    async function resolveScope(method, input, grant) {
        if (Object.hasOwn(FILTER_METHODS, method)) return filterResolution(method, grant)
        if (method === "evaluations.list" && input.datasetId === null) {
            const granted = new Set(Array.isArray(grant?.scopes?.datasetIds)
                ? grant.scopes.datasetIds
                : [])
            return {
                method,
                mode: "filter",
                datasetIds: (await datasetInventory())
                    .map((entry) => entry?.id)
                    .filter((id) => granted.has(id)),
            }
        }
        if (method === "raw_cases.enqueue") {
            const skillIds = []
            for (const rawCase of input.cases) {
                skillIds.push((await resolveSkillReference(rawCase.skill, {toolSupplied: true})).id)
            }
            return {method, mode: "access", skillIds: unique(skillIds)}
        }
        if (method === "raw_cases.update" || method === "raw_cases.dispatch") {
            const rawCase = await requireRawCase(input.id)
            const skillIds = [(await resolveSkillReference(rawCase.skill)).id]
            if (method === "raw_cases.update" && input.changes.skill) {
                skillIds.push((await resolveSkillReference(
                    input.changes.skill,
                    {toolSupplied: true},
                )).id)
            }
            if (method === "raw_cases.dispatch") {
                await requireRuntime(input.runtime.runtimeId)
            }
            return {
                method,
                mode: "access",
                subject: {kind: "raw_case", id: rawCase.id},
                skillIds: unique(skillIds),
            }
        }
        if (method === "evaluations.get" || method === "evaluations.cancel") {
            const run = await requireEvaluationRun(input.runId)
            return {
                method,
                mode: "access",
                subject: {kind: "evaluation_run", id: run.id},
                datasetIds: [run.datasetId],
            }
        }
        if (method === "evaluations.start") {
            await validateEvaluationStart(input)
        }
        return null
    }

    const handlers = {
        async "context.get"(_input, context) {
            const allowed = scopeIds(context, "runtimeIds")
            const runtimes = (await runtimeInventory())
                .filter((entry) => allowed.has(entry.runtimeId))
            const workspaceRoot = typeof dependencies.workspaceRoot === "function"
                ? await dependencies.workspaceRoot()
                : dependencies.workspaceRoot
            return {workspaceRoot: String(workspaceRoot ?? ""), runtimes}
        },

        async "raw_cases.list"(input, context) {
            const page = paginate(await filteredRawCases(input, context), input)
            return {rawCases: page.items, nextCursor: page.nextCursor}
        },

        async "raw_cases.enqueue"(input) {
            const cases = []
            for (const rawCase of input.cases) {
                const skill = await resolveSkillReference(rawCase.skill, {toolSupplied: true})
                cases.push({
                    ...clone(rawCase),
                    question: rawCase.question,
                    skill: canonicalSkillReference(skill),
                })
            }
            if (typeof rawCaseStore?.addMany !== "function") throw new Error("Raw Case store unavailable")
            return clone(await rawCaseStore.addMany(cases))
        },

        async "raw_cases.update"(input) {
            await requireRawCase(input.id)
            const changes = clone(input.changes)
            if (changes.skill) {
                const skill = await resolveSkillReference(changes.skill, {toolSupplied: true})
                changes.skill = canonicalSkillReference(skill)
            }
            if (typeof rawCaseStore?.update !== "function") throw new Error("Raw Case store unavailable")
            return {rawCase: clone(await rawCaseStore.update(input.id, changes))}
        },

        async "raw_cases.dispatch"(input) {
            const rawCase = await requireRawCase(input.id)
            const skill = await resolveSkillReference(rawCase.skill)
            const descriptor = await requireRuntime(input.runtime.runtimeId)
            if (typeof dispatchRawCase !== "function") throw new Error("Runtime dispatch unavailable")
            const result = await dispatchRawCase({
                rawCase,
                skill: clone(skill),
                mode: input.mode,
                runtime: {
                    ...descriptor,
                    modelId: input.runtime.modelId,
                    effort: input.runtime.effort,
                },
            })
            return {threadId: result.threadId, turnId: result.turnId ?? null}
        },

        async "runtimes.list"(_input, context) {
            const allowed = scopeIds(context, "runtimeIds")
            return {
                runtimes: (await runtimeInventory())
                    .filter((entry) => allowed.has(entry.runtimeId)),
            }
        },

        async "runtimes.models"(input) {
            const runtime = await requireRuntime(input.runtimeId)
            if (typeof listModelsForRuntime !== "function") return {models: []}
            const result = await listModelsForRuntime(runtime.runtimeId, clone(runtime))
            return {models: clone(arrayFromInventory(result, ["models", "data"]))}
        },

        async "datasets.list"(input, context) {
            const allowed = scopeIds(context, "datasetIds")
            const datasets = (await datasetInventory()).filter((entry) => allowed.has(entry.id))
            const page = paginate(datasets, input)
            return {datasets: page.items, nextCursor: page.nextCursor}
        },

        async "datasets.get"(input) {
            const dataset = await requireDataset(input.datasetId)
            const result = {dataset}
            if (input.includeCases) result.cases = await casesForDataset(dataset.id)
            return result
        },

        async "evaluations.list"(input, context) {
            let runs = await runInventory(input.datasetId)
            if (input.datasetId === null) {
                const allowed = scopeIds(context, "datasetIds")
                runs = runs.filter((entry) => allowed.has(entry.datasetId))
            } else {
                await requireDataset(input.datasetId)
            }
            const page = paginate(runs, input)
            return {runs: page.items, nextCursor: page.nextCursor}
        },

        async "evaluations.get"(input) {
            return {run: await requireEvaluationRun(input.runId)}
        },

        async "evaluations.start"(input) {
            await validateEvaluationStart(input)
            if (typeof startEvaluation !== "function") throw new Error("Evaluation start unavailable")
            return {run: clone(await startEvaluation(clone(input)))}
        },

        async "evaluations.cancel"(input) {
            await requireEvaluationRun(input.runId)
            if (typeof evaluationRunner?.cancel !== "function") {
                throw new Error("Evaluation cancellation unavailable")
            }
            return {run: clone(await evaluationRunner.cancel(input.runId))}
        },

        async "skills.list"(input, context) {
            const allowed = scopeIds(context, "skillIds")
            const skills = (await skillInventory()).filter((entry) => allowed.has(entry.id))
            const page = paginate(skills, input)
            return {skills: page.items, nextCursor: page.nextCursor}
        },

        async "skills.get"(input) {
            await requireSkill(input.skillId)
            if (typeof managedSkillManager?.readSkill !== "function") throw notFound("skill")
            return {skill: sanitizedSkillDetail(await managedSkillManager.readSkill(input.skillId))}
        },
    }

    for (const method of CONTROL_METHODS) {
        if (typeof handlers[method] !== "function") throw new Error(`Missing domain handler: ${method}`)
    }
    Object.defineProperty(handlers, "resolveScope", {
        configurable: false,
        enumerable: false,
        value: resolveScope,
        writable: false,
    })
    return Object.freeze(handlers)
}

module.exports = {createDomainServices}
