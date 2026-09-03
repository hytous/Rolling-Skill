import {requestRollingSkill, RollingSkillApiError} from "../api"

const PAGE_LIMIT = 200
const MAX_PAGES = 1_000
const SNAPSHOT_RETRIES = 3

interface OperatorSummaryPage<Session, Job, Approval> {
    sessions: Session[]
    jobs: Job[]
    approvals: Approval[]
    totals?: {sessions?: number; jobs?: number; approvals?: number}
    nextCursor?: string | null
}

export interface OperatorSummaryResult<Session, Job, Approval> {
    sessions: Session[]
    jobs: Job[]
    approvals: Approval[]
    totals: {sessions: number; jobs: number; approvals: number}
}

async function loadStableOperatorSummary<Session, Job, Approval>(signal?: AbortSignal): Promise<OperatorSummaryResult<Session, Job, Approval>> {
    const sessions: Session[] = []
    const jobs: Job[] = []
    const approvals: Approval[] = []
    const seenCursors = new Set<string>()
    let cursor: string | null = null
    let totals: OperatorSummaryPage<Session, Job, Approval>["totals"]
    for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
        const page = await requestRollingSkill<OperatorSummaryPage<Session, Job, Approval>>(
            "operators.summary",
            {...(cursor === null ? {} : {cursor}), limit: PAGE_LIMIT},
            signal,
        )
        sessions.push(...page.sessions)
        jobs.push(...page.jobs)
        approvals.push(...page.approvals)
        totals = page.totals ?? totals
        if (page.nextCursor === null || page.nextCursor === undefined) {
            return {
                sessions,
                jobs,
                approvals,
                totals: {
                    sessions: totals?.sessions ?? sessions.length,
                    jobs: totals?.jobs ?? jobs.length,
                    approvals: totals?.approvals ?? approvals.length,
                },
            }
        }
        if (seenCursors.has(page.nextCursor)) throw new Error("Operator summary repeated a pagination cursor")
        seenCursors.add(page.nextCursor)
        cursor = page.nextCursor
    }
    throw new Error("Operator summary exceeded the pagination limit")
}

export async function loadOperatorSummary<Session, Job, Approval>(signal?: AbortSignal): Promise<OperatorSummaryResult<Session, Job, Approval>> {
    for (let attempt = 0; attempt < SNAPSHOT_RETRIES; attempt += 1) {
        try {
            return await loadStableOperatorSummary<Session, Job, Approval>(signal)
        } catch (error) {
            if (!(error instanceof RollingSkillApiError) || error.code !== "OPERATOR_SNAPSHOT_CHANGED" || attempt === SNAPSHOT_RETRIES - 1) throw error
        }
    }
    throw new Error("Operator summary could not be read")
}
