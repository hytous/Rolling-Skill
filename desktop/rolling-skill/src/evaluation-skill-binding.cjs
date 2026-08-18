function runtimeReportsSkill(response, skillReference, {allowNameOnly = false} = {}) {
    for (const entry of response?.data ?? []) {
        for (const skill of entry.skills ?? []) {
            if (
                skill?.enabled &&
                skill.name === skillReference.name &&
                (
                    skill.path === skillReference.path ||
                    (allowNameOnly && skill.evidencePrecision === "name-only" && !skill.path)
                )
            ) {
                return true
            }
        }
    }
    return false
}

async function resolveSkillEvidenceBinding({
    descriptor,
    selectedRuntimeId,
    getSelectedRuntime,
    createClient,
    clientOptions,
    skillReference,
}) {
    let temporaryClient = null
    try {
        const runtime = descriptor.runtimeId === selectedRuntimeId
            ? await getSelectedRuntime()
            : (temporaryClient = createClient(descriptor, clientOptions))
        if (temporaryClient) await temporaryClient.start()
        if (typeof runtime.listSkills !== "function") return "unverified"
        const response = await runtime.listSkills({forceReload: true})
        return runtimeReportsSkill(response, skillReference) ? "verified" : "unverified"
    } catch {
        return "unverified"
    } finally {
        if (temporaryClient) await temporaryClient.stop().catch(() => {})
    }
}

function resolveExecutedSkillEvidenceBinding({
    declaredBinding = "unverified",
    skillReference,
    skillEvidence,
    traceEvidence,
}) {
    const frozenSkill = skillEvidence?.files?.find((entry) => entry.path === "SKILL.md")
    const expectedContentDigest = frozenSkill?.content === undefined
        ? null
        : skillContentDigest(frozenSkill.content)
    const skillName = String(skillReference?.name ?? skillEvidence?.name ?? "")
    const observed = []
    for (const entry of traceEvidence?.entries ?? []) {
        const update = entry?.message?.params?.update ?? {}
        const event = entry?.message?.params?.event ?? {}
        const dshExplicitSkill =
            event.type === "user/message" &&
            event.data?.source?.kind === "skill-invocation"
                ? String(event.data.source.name ?? "")
                : ""
        const dshToolSkill = event.type === "tool/call" && event.data?.name === "skill"
            ? (() => {
                  try {
                      return String(JSON.parse(event.data.arguments ?? "{}").name ?? "")
                  } catch {
                      return ""
                  }
              })()
            : ""
        const observedSkill = update.rawInput?.skill ?? (dshExplicitSkill || dshToolSkill)
        if (String(observedSkill ?? "") !== skillName) continue
        observed.push({
            sequence: entry.sequence,
            contentDigest: update.skillContentDigest ?? null,
        })
    }
    const matching = observed.find((entry) =>
        expectedContentDigest && entry.contentDigest === expectedContentDigest,
    )
    const observedDigests = observed.map((entry) => entry.contentDigest).filter(Boolean)
    const observedBinding = matching
        ? "matched"
        : observedDigests.length
          ? "mismatched"
          : observed.length
            ? "name_only"
            : "not_observed"
    const effectiveBinding = observedBinding === "matched"
        ? "verified-by-trace"
        : observedBinding === "mismatched"
          ? "unverified"
          : declaredBinding === "verified"
            ? "verified"
            : "unverified"
    return {
        declaredBinding: declaredBinding === "verified" ? "verified" : "unverified",
        observedBinding,
        effectiveBinding,
        skillName,
        expectedContentDigest,
        observedContentDigest: matching?.contentDigest ?? observedDigests.at(-1) ?? null,
        evidenceSequences: observed.map((entry) => entry.sequence),
    }
}

module.exports = {
    resolveExecutedSkillEvidenceBinding,
    resolveSkillEvidenceBinding,
    runtimeReportsSkill,
}
const {skillContentDigest} = require("./skill-content.cjs")
