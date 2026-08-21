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

function invalidArgument(method, path) {
    return createPublicControlError("INVALID_ARGUMENT", {
        details: {method, issues: [{path}]},
        internalMessage: "Tool-supplied Skill paths are not accepted",
    })
}

function notFound(resource) {
    return createPublicControlError("NOT_FOUND", {details: {resource}})
}

function clone(value) {
    return value === undefined ? undefined : structuredClone(value)
}

function immutableSnapshot(value) {
    const snapshot = clone(value)
    const freeze = (candidate) => {
        if (!candidate || typeof candidate !== "object" || Object.isFrozen(candidate)) {
            return candidate
        }
        for (const child of Object.values(candidate)) freeze(child)
        return Object.freeze(candidate)
    }
    return freeze(snapshot)
}

function scopeResolution(scope, executionContext = null) {
    return Object.freeze({
        scope: scope === null ? null : immutableSnapshot(scope),
        executionContext: executionContext === null
            ? null
            : immutableSnapshot(executionContext),
    })
}

function trustedExecution(context, method) {
    const execution = context?.executionContext
    return execution?.method === method && Object.isFrozen(execution) ? execution : null
}

function identifier(value) {
    return typeof value === "string" && value.length > 0 && value.length <= 200
        ? value
        : null
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

    function requireRuntimeFrom(inventory, runtimeId) {
        const runtime = inventory.find((entry) => entry?.runtimeId === runtimeId)
        if (!runtime) throw notFound("runtime")
        return runtime
    }

    async function skillInventory() {
        const overview = typeof managedSkillManager?.overview === "function"
            ? await managedSkillManager.overview()
            : {skills: []}
        return clone(arrayFromInventory(overview, ["skills"]))
    }

    async function resolveSkillReference(reference, {
        method = null,
        path = [],
        toolSupplied = false,
    } = {}) {
        if (!reference || typeof reference !== "object") throw notFound("skill")
        const name = identifier(reference.name)
        if (name === null) throw notFound("skill")
        if (toolSupplied && typeof reference.path === "string") {
            throw invalidArgument(method, [...path, "path"])
        }

        const candidates = (await skillInventory()).filter((skill) => skill?.name === name)
        if (candidates.length !== 1) throw notFound("skill")
        return candidates[0]
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
            throw notFound("dataset")
        }
    }

    async function casesForDataset(datasetId) {
        if (typeof evaluationStore?.listCases !== "function") return []
        return clone(await evaluationStore.listCases(datasetId))
            .filter((entry) => entry?.datasetId === datasetId)
    }

    async function evaluationStartSnapshot(input) {
        const dataset = await requireDataset(input.datasetId)
        const cases = await casesForDataset(input.datasetId)
        const caseIds = new Set(cases.map((entry) => entry.id))
        if (input.caseIds.some((caseId) => !caseIds.has(caseId))) {
            throw notFound("case")
        }
        const inventory = await runtimeInventory()
        const runtimes = input.runtimeConfigurations.map((profile) =>
            requireRuntimeFrom(inventory, profile.runtimeId),
        )
        const judgeRuntime = requireRuntimeFrom(
            inventory,
            input.judgeConfiguration.runtimeId,
        )
        return {dataset, cases, runtimes, judgeRuntime}
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
            throw notFound("evaluation_run")
        }
    }

    async function requireSkill(skillId) {
        const skill = (await skillInventory()).find((entry) => entry?.id === skillId)
        if (!skill) throw notFound("skill")
        return skill
    }

    async function requireSkillDetail(skillId) {
        const skill = await requireSkill(skillId)
        if (typeof managedSkillManager?.readSkill !== "function") throw notFound("skill")
        let detail
        try {
            detail = sanitizedSkillDetail(await managedSkillManager.readSkill(skillId))
        } catch {
            throw notFound("skill")
        }
        if (detail?.skill?.id !== skill.id) throw notFound("skill")
        return {detail, skill}
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
        if (Object.hasOwn(FILTER_METHODS, method)) {
            return scopeResolution(await filterResolution(method, grant))
        }
        if (method === "evaluations.list" && input.datasetId === null) {
            const granted = new Set(Array.isArray(grant?.scopes?.datasetIds)
                ? grant.scopes.datasetIds
                : [])
            return scopeResolution({
                method,
                mode: "filter",
                datasetIds: (await datasetInventory())
                    .map((entry) => entry?.id)
                    .filter((id) => granted.has(id)),
            })
        }
        if (method === "raw_cases.enqueue") {
            const skills = []
            for (let index = 0; index < input.cases.length; index += 1) {
                skills.push(await resolveSkillReference(input.cases[index].skill, {
                    method,
                    path: ["cases", index, "skill"],
                    toolSupplied: true,
                }))
            }
            return scopeResolution(
                {method, mode: "access", skillIds: unique(skills.map((skill) => skill.id))},
                {method, skills},
            )
        }
        if (method === "raw_cases.update" || method === "raw_cases.dispatch") {
            const rawCase = await requireRawCase(input.id)
            const skill = await resolveSkillReference(rawCase.skill)
            const skillIds = [skill.id]
            let targetSkill = null
            if (method === "raw_cases.update" && input.changes.skill) {
                targetSkill = await resolveSkillReference(
                    input.changes.skill,
                    {method, path: ["changes", "skill"], toolSupplied: true},
                )
                skillIds.push(targetSkill.id)
            }
            let runtime = null
            if (method === "raw_cases.dispatch") {
                runtime = await requireRuntime(input.runtime.runtimeId)
            }
            return scopeResolution({
                method,
                mode: "access",
                subject: {kind: "raw_case", id: rawCase.id},
                skillIds: unique(skillIds),
            }, {method, rawCase, runtime, skill, targetSkill})
        }
        if (method === "evaluations.get" || method === "evaluations.cancel") {
            const run = await requireEvaluationRun(input.runId)
            return scopeResolution({
                method,
                mode: "access",
                subject: {kind: "evaluation_run", id: run.id},
                datasetIds: [run.datasetId],
            }, {method, run})
        }
        if (method === "evaluations.start") {
            return scopeResolution(null, {
                method,
                ...await evaluationStartSnapshot(input),
            })
        }
        if (method === "runtimes.models") {
            return scopeResolution(null, {
                method,
                runtime: await requireRuntime(input.runtimeId),
            })
        }
        if (method === "datasets.get") {
            const dataset = await requireDataset(input.datasetId)
            return scopeResolution(null, {
                method,
                dataset,
                cases: input.includeCases ? await casesForDataset(dataset.id) : null,
            })
        }
        if (method === "evaluations.list" && input.datasetId !== null) {
            return scopeResolution(null, {
                method,
                dataset: await requireDataset(input.datasetId),
            })
        }
        if (method === "skills.get") {
            return scopeResolution(null, {
                method,
                ...await requireSkillDetail(input.skillId),
            })
        }
        return scopeResolution(null)
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

        async "raw_cases.enqueue"(input, context) {
            const execution = trustedExecution(context, "raw_cases.enqueue")
            const cases = []
            for (let index = 0; index < input.cases.length; index += 1) {
                const rawCase = input.cases[index]
                const skill = execution?.skills[index] ??
                    await resolveSkillReference(rawCase.skill, {
                        method: "raw_cases.enqueue",
                        path: ["cases", index, "skill"],
                        toolSupplied: true,
                    })
                cases.push({
                    ...clone(rawCase),
                    question: rawCase.question,
                    skill: canonicalSkillReference(skill),
                })
            }
            if (typeof rawCaseStore?.addMany !== "function") throw new Error("Raw Case store unavailable")
            return clone(await rawCaseStore.addMany(cases))
        },

        async "raw_cases.update"(input, context) {
            const execution = trustedExecution(context, "raw_cases.update")
            if (execution === null) await requireRawCase(input.id)
            const changes = clone(input.changes)
            if (changes.skill) {
                const skill = execution?.targetSkill ??
                    await resolveSkillReference(changes.skill, {
                        method: "raw_cases.update",
                        path: ["changes", "skill"],
                        toolSupplied: true,
                    })
                changes.skill = canonicalSkillReference(skill)
            }
            if (typeof rawCaseStore?.update !== "function") throw new Error("Raw Case store unavailable")
            return {rawCase: clone(await rawCaseStore.update(input.id, changes))}
        },

        async "raw_cases.dispatch"(input, context) {
            const execution = trustedExecution(context, "raw_cases.dispatch")
            const rawCase = execution?.rawCase ?? await requireRawCase(input.id)
            const skill = execution?.skill ?? await resolveSkillReference(rawCase.skill)
            const descriptor = execution?.runtime ?? await requireRuntime(input.runtime.runtimeId)
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

        async "runtimes.models"(input, context) {
            const execution = trustedExecution(context, "runtimes.models")
            const runtime = execution?.runtime ?? await requireRuntime(input.runtimeId)
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

        async "datasets.get"(input, context) {
            const execution = trustedExecution(context, "datasets.get")
            const dataset = execution?.dataset ?? await requireDataset(input.datasetId)
            const result = {dataset}
            if (input.includeCases) {
                result.cases = execution?.cases ?? await casesForDataset(dataset.id)
            }
            return result
        },

        async "evaluations.list"(input, context) {
            let runs = await runInventory(input.datasetId)
            if (input.datasetId === null) {
                const allowed = scopeIds(context, "datasetIds")
                runs = runs.filter((entry) => allowed.has(entry.datasetId))
            } else {
                const execution = trustedExecution(context, "evaluations.list")
                if (execution === null) await requireDataset(input.datasetId)
            }
            const page = paginate(runs, input)
            return {runs: page.items, nextCursor: page.nextCursor}
        },

        async "evaluations.get"(input, context) {
            const execution = trustedExecution(context, "evaluations.get")
            return {run: execution?.run ?? await requireEvaluationRun(input.runId)}
        },

        async "evaluations.start"(input, context) {
            const execution = trustedExecution(context, "evaluations.start") ??
                immutableSnapshot({
                    method: "evaluations.start",
                    ...await evaluationStartSnapshot(input),
                })
            if (typeof startEvaluation !== "function") throw new Error("Evaluation start unavailable")
            return {run: clone(await startEvaluation(clone(input), execution))}
        },

        async "evaluations.cancel"(input, context) {
            const execution = trustedExecution(context, "evaluations.cancel")
            if (execution === null) await requireEvaluationRun(input.runId)
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

        async "skills.get"(input, context) {
            const execution = trustedExecution(context, "skills.get")
            const detail = execution?.detail ?? (await requireSkillDetail(input.skillId)).detail
            return {skill: detail}
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
