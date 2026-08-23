const {
    CONTROL_METHODS,
    createPublicControlError,
    decodeCursor,
    encodeCursor,
} = require("./contracts.cjs")
const {
    normalizedSkillName,
    RawCaseConflictError,
} = require("../raw-case-store.cjs")

const FILTER_METHODS = Object.freeze({
    "context.get": "runtimeIds",
    "raw_cases.list": "skillIds",
    "runtimes.list": "runtimeIds",
    "datasets.list": "datasetIds",
    "skills.list": "skillIds",
    "skill_versions.list": "skillIds",
})

function invalidArgument(method, path, internalMessage = "Invalid control domain input") {
    return createPublicControlError("INVALID_ARGUMENT", {
        details: {method, issues: [{path}]},
        internalMessage,
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
    if (Array.isArray(result.skill?.warnings)) {
        result.skill.warnings = result.skill.warnings.map(sanitizedWarningMessage)
    }
    delete result.versions
    return result
}

function sanitizedWarningMessage(warning) {
    const message = String(warning ?? "")
    const matches = [
        /file:\/\/\/[^\s]*/iu.exec(message),
        /(^|[\s(<:='"])[A-Za-z]:[\\/]/u.exec(message),
        /(^|[\s(<:='"])\/(?!\/)/u.exec(message),
    ].filter(Boolean)
    if (matches.length === 0) return message
    const pathStart = Math.min(...matches.map((match) =>
        match.index + (match[1]?.length ?? 0),
    ))
    return `${message.slice(0, pathStart)}[absolute path omitted]`.trim()
}

function publicSkillReference(skill) {
    const stableId = identifier(skill?.id) ?? identifier(skill?.skillId)
    return {
        ...(stableId === null ? {} : {id: stableId}),
        name: String(skill?.name ?? ""),
    }
}

function sanitizedRawCasePublicValue(value, seen = new WeakMap()) {
    if (!value || typeof value !== "object") return value
    if (seen.has(value)) return seen.get(value)
    const result = Array.isArray(value) ? [] : {}
    seen.set(value, result)
    for (const [key, child] of Object.entries(value)) {
        result[key] = key === "skill" && child && typeof child === "object"
            ? publicSkillReference(child)
            : sanitizedRawCasePublicValue(child, seen)
    }
    return result
}

function sanitizedRepository(repository) {
    if (!repository || typeof repository !== "object") return repository
    const result = clone(repository)
    delete result.managedPath
    return result
}

function ownFields(value, keys) {
    const result = {}
    for (const key of keys) {
        if (Object.hasOwn(value ?? {}, key)) result[key] = clone(value[key])
    }
    return result
}

function managedRepositorySummary(repository) {
    const summary = ownFields(repository, ["id", "displayName", "defaultBranch"])
    if (typeof repository?.source?.kind === "string") {
        summary.source = {kind: repository.source.kind}
    }
    return summary
}

function managedSkillSummary(skill) {
    return {
        ...ownFields(skill, ["id", "repositoryId", "name", "status"]),
        warningCount: Array.isArray(skill?.warnings) ? skill.warnings.length : 0,
    }
}

function managedVersionSummary(version) {
    return ownFields(version, [
        "id",
        "repositoryId",
        "skillId",
        "commit",
        "contentDigest",
        "state",
        "versionLabel",
        "createdBy",
        "optimizationRoundId",
        "createdAt",
        "releasedAt",
        "deprecatedAt",
    ])
}

function createDomainServices(dependencies = {}) {
    const {
        rawCaseStore,
        evaluationStore,
        evaluationRunner,
        managedSkillManager,
        listRawCaseSkills,
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

    async function managedSkillOverview() {
        const overview = typeof managedSkillManager?.overview === "function"
            ? await managedSkillManager.overview()
            : {}
        return {
            repositories: clone(arrayFromInventory(overview, ["repositories"]))
                .map(sanitizedRepository),
            skills: clone(arrayFromInventory(overview, ["skills"])),
            versions: clone(arrayFromInventory(overview, ["versions"])),
        }
    }

    async function managedSkillInventory() {
        return (await managedSkillOverview()).skills
    }

    async function rawCaseSkillInventory() {
        if (typeof listRawCaseSkills !== "function") return managedSkillInventory()
        const inventory = await listRawCaseSkills()
        return clone(arrayFromInventory(inventory, ["skills", "available", "data"]))
    }

    function resolveSkillReferenceFrom(reference, inventory, {
        grant = null,
        method = null,
        path = [],
        toolSupplied = false,
    } = {}) {
        if (!reference || typeof reference !== "object") throw notFound("skill")
        if (toolSupplied && typeof reference.path === "string") {
            throw invalidArgument(
                method,
                [...path, "path"],
                "Tool-supplied Skill paths are not accepted",
            )
        }

        const stableId = identifier(reference.skillId) ?? identifier(reference.id)
        let candidates = matchingSkillReferences(reference, inventory)
        if (grant !== null) {
            const grantedIds = new Set(
                Array.isArray(grant?.scopes?.skillIds) ? grant.scopes.skillIds : [],
            )
            candidates = candidates.filter((skill) => grantedIds.has(skill?.id))
        }
        if (candidates.length === 0) throw notFound("skill")
        if (candidates.length > 1) {
            throw invalidArgument(
                method,
                stableId === null ? [...path, "name"] : [...path, "skillId"],
                "Skill reference is ambiguous inside the capability scope",
            )
        }
        return candidates[0]
    }

    function matchingSkillReferences(reference, inventory) {
        const stableId = identifier(reference?.skillId) ?? identifier(reference?.id)
        if (stableId !== null) {
            return inventory.filter((skill) => skill?.id === stableId)
        }
        const name = identifier(reference?.name)
        if (name === null) return []
        const normalizedName = normalizedSkillName(name)
        return inventory.filter(
            (skill) => normalizedSkillName(skill?.name) === normalizedName,
        )
    }

    async function resolveSkillReference(reference, options) {
        return resolveSkillReferenceFrom(reference, await rawCaseSkillInventory(), options)
    }

    function canonicalSkillReference(skill) {
        return {id: skill.id, name: skill.name}
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
        const skill = (await managedSkillInventory()).find((entry) => entry?.id === skillId)
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

    async function filteredRawCases(input, context, execution = null) {
        const allowed = scopeIds(context, "skillIds")
        if (allowed.size === 0) return []
        const records = execution?.rawCases ?? await rawCaseInventory(input.skillName)
        const skills = execution?.skills ?? await rawCaseSkillInventory()
        const visible = []
        for (const record of records) {
            const stableId = identifier(record?.skill?.skillId) ?? identifier(record?.skill?.id)
            const candidates = stableId === null
                ? skills.filter((skill) =>
                    normalizedSkillName(skill?.name) ===
                        normalizedSkillName(record?.skill?.name))
                : skills.filter((skill) => skill?.id === stableId)
            if (
                candidates.length > 0 &&
                candidates.every((candidate) => allowed.has(candidate?.id))
            ) visible.push(record)
        }
        return visible
    }

    async function filterResolution(method, input, grant) {
        const key = FILTER_METHODS[method]
        const granted = new Set(Array.isArray(grant?.scopes?.[key]) ? grant.scopes[key] : [])
        let inventoryIds = []
        let executionContext
        if (key === "runtimeIds") {
            const runtimes = await runtimeInventory()
            inventoryIds = runtimes.map((entry) => entry?.runtimeId)
            executionContext = {method, runtimes}
        } else if (key === "datasetIds") {
            const datasets = await datasetInventory()
            inventoryIds = datasets.map((entry) => entry?.id)
            executionContext = {method, datasets}
        } else {
            const overview = method === "skills.list" || method === "skill_versions.list"
                ? await managedSkillOverview()
                : null
            const skills = overview?.skills ?? await rawCaseSkillInventory()
            inventoryIds = skills.map((entry) => entry?.id)
            executionContext = {
                method,
                skills,
                overview,
                rawCases: method === "raw_cases.list"
                    ? await rawCaseInventory(input.skillName)
                    : null,
            }
        }
        return scopeResolution({
            method,
            mode: "filter",
            [key]: unique(inventoryIds.filter((id) => granted.has(id))),
        }, executionContext)
    }

    async function resolveScope(method, input, grant) {
        if (Object.hasOwn(FILTER_METHODS, method)) {
            return filterResolution(method, input, grant)
        }
        if (method === "evaluations.list" && input.datasetId === null) {
            const granted = new Set(Array.isArray(grant?.scopes?.datasetIds)
                ? grant.scopes.datasetIds
                : [])
            const datasets = await datasetInventory()
            const runs = await runInventory(null)
            return scopeResolution({
                method,
                mode: "filter",
                datasetIds: datasets
                    .map((entry) => entry?.id)
                    .filter((id) => granted.has(id)),
            }, {method, datasets, runs})
        }
        if (method === "raw_cases.enqueue") {
            const inventory = await rawCaseSkillInventory()
            const skills = []
            for (let index = 0; index < input.cases.length; index += 1) {
                skills.push(resolveSkillReferenceFrom(input.cases[index].skill, inventory, {
                    grant,
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
            const inventory = await rawCaseSkillInventory()
            const legacyOwner = identifier(rawCase.skill?.skillId) === null &&
                identifier(rawCase.skill?.id) === null
            const explicitTargetId = method === "raw_cases.update"
                ? identifier(input.changes.skill?.id)
                : null
            const ambiguousOwners = legacyOwner && explicitTargetId !== null
                ? matchingSkillReferences(rawCase.skill, inventory)
                : []
            const explicitRebind = ambiguousOwners.length > 1
            const skill = explicitRebind
                ? null
                : resolveSkillReferenceFrom(rawCase.skill, inventory, {grant, method})
            const skillIds = explicitRebind
                ? ambiguousOwners.map((candidate) => candidate?.id)
                : [skill.id]
            if (skillIds.some((skillId) => identifier(skillId) === null)) {
                throw invalidArgument(method, ["id"], "Legacy Skill owners require stable IDs")
            }
            let targetSkill = null
            if (method === "raw_cases.update" && input.changes.skill) {
                targetSkill = resolveSkillReferenceFrom(
                    input.changes.skill,
                    inventory,
                    {
                        grant,
                        method,
                        path: ["changes", "skill"],
                        toolSupplied: true,
                    },
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
            }, {method, rawCase, runtime, skill, ownerSkills: ambiguousOwners, targetSkill})
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
            const dataset = await requireDataset(input.datasetId)
            return scopeResolution(null, {
                method,
                dataset,
                runs: await runInventory(dataset.id),
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
            const execution = trustedExecution(context, "context.get")
            const inventory = execution?.runtimes ?? await runtimeInventory()
            const runtimes = inventory
                .filter((entry) => allowed.has(entry.runtimeId))
            const workspaceRoot = typeof dependencies.workspaceRoot === "function"
                ? await dependencies.workspaceRoot()
                : dependencies.workspaceRoot
            return {workspaceRoot: String(workspaceRoot ?? ""), runtimes}
        },

        async "raw_cases.list"(input, context) {
            const execution = trustedExecution(context, "raw_cases.list")
            const page = paginate(await filteredRawCases(input, context, execution), input)
            return {
                rawCases: page.items.map((record) => sanitizedRawCasePublicValue(record)),
                nextCursor: page.nextCursor,
            }
        },

        async "raw_cases.enqueue"(input, context) {
            const execution = trustedExecution(context, "raw_cases.enqueue")
            const cases = []
            for (let index = 0; index < input.cases.length; index += 1) {
                const rawCase = input.cases[index]
                const skill = execution?.skills[index] ??
                    await resolveSkillReference(rawCase.skill, {
                        grant: context?.grant,
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
            return sanitizedRawCasePublicValue(await rawCaseStore.addMany(cases))
        },

        async "raw_cases.update"(input, context) {
            const execution = trustedExecution(context, "raw_cases.update")
            const rawCase = execution?.rawCase ?? await requireRawCase(input.id)
            const changes = clone(input.changes)
            if (changes.skill) {
                const skill = execution?.targetSkill ??
                    await resolveSkillReference(changes.skill, {
                        grant: context?.grant,
                        method: "raw_cases.update",
                        path: ["changes", "skill"],
                        toolSupplied: true,
                    })
                changes.skill = canonicalSkillReference(skill)
            }
            if (typeof rawCaseStore?.updateIfCurrent !== "function") {
                throw new Error("Raw Case store unavailable")
            }
            try {
                return {rawCase: sanitizedRawCasePublicValue(await rawCaseStore.updateIfCurrent(input.id, {
                    expectedRevision: rawCase.revision,
                    expectedSkillName: rawCase.skill?.name,
                }, changes))}
            } catch (error) {
                let conflict = false
                try {
                    conflict = error instanceof RawCaseConflictError
                } catch {}
                if (conflict) throw createPublicControlError("CONTROL_BUSY")
                throw error
            }
        },

        async "raw_cases.dispatch"(input, context) {
            const execution = trustedExecution(context, "raw_cases.dispatch")
            const rawCase = execution?.rawCase ?? await requireRawCase(input.id)
            const skill = execution?.skill ?? await resolveSkillReference(rawCase.skill, {
                grant: context?.grant,
                method: "raw_cases.dispatch",
            })
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
            const execution = trustedExecution(context, "runtimes.list")
            const runtimes = execution?.runtimes ?? await runtimeInventory()
            return {
                runtimes: runtimes.filter((entry) => allowed.has(entry.runtimeId)),
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
            const execution = trustedExecution(context, "datasets.list")
            const inventory = execution?.datasets ?? await datasetInventory()
            const datasets = inventory.filter((entry) => allowed.has(entry.id))
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
            const execution = trustedExecution(context, "evaluations.list")
            let runs = execution?.runs ?? await runInventory(input.datasetId)
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
            const execution = trustedExecution(context, "skills.list")
            const overview = execution?.overview ?? await managedSkillOverview()
            const skills = overview.skills.filter((entry) => allowed.has(entry.id))
            const page = paginate(skills, input)
            const repositoryIds = new Set(page.items.map((entry) => entry.repositoryId))
            return {
                repositories: overview.repositories
                    .filter((entry) => repositoryIds.has(entry?.id))
                    .map(managedRepositorySummary),
                skills: page.items.map(managedSkillSummary),
                nextCursor: page.nextCursor,
            }
        },

        async "skill_versions.list"(input, context) {
            const allowed = scopeIds(context, "skillIds")
            const execution = trustedExecution(context, "skill_versions.list")
            const overview = execution?.overview ?? await managedSkillOverview()
            const versions = overview.versions.filter((entry) =>
                allowed.has(entry?.skillId) &&
                (input.skillId === null || entry?.skillId === input.skillId),
            )
            const page = paginate(versions, input)
            return {
                versions: page.items.map(managedVersionSummary),
                nextCursor: page.nextCursor,
            }
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
