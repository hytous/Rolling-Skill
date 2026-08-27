import applicationModule from "../../../rolling-skill-core/src/index.cjs"
import apiModule from "./api.cjs"
import sessionEvidenceModule from "./session-evidence.cjs"
import {registerRollingSkillTools} from "./tools.js"
import schedulerModule from "../scheduler/index.cjs"
import {createNativeSessionDispatcher} from "./native-session-dispatcher.js"
import {createPathRevealer} from "./reveal-path.js"

const {createRollingSkillApplication, resolveDataPaths} = applicationModule
const {createRollingSkillApiHandler} = apiModule
const {createSessionEvidenceSource} = sessionEvidenceModule
const {createSchedulerAdapter, resolveWorkerExecutable} = schedulerModule

export const inject = ["webServer", "tools", "sessionQuery", "agents"]

export function apply(ctx, config = {}) {
    const dataPaths = resolveDataPaths({dataRoot: config.dataRoot})
    const schedulerAdapter = createSchedulerAdapter({
        dataRoot: config.dataRoot,
        workerExecutable: resolveWorkerExecutable(import.meta.url),
    })
    const application = createRollingSkillApplication({
        dataRoot: config.dataRoot,
        schedulerAdapter,
        ...(ctx.runtimeRegistry ? {runtimeRegistry: ctx.runtimeRegistry} : {}),
        conversationEpisodeSource: createSessionEvidenceSource({
            sessionQuery: ctx.sessionQuery,
            traceRoot: dataPaths.dshConversationTraces,
        }),
        rawCaseDispatcher: createNativeSessionDispatcher({agents: ctx.agents}),
        revealPath: createPathRevealer(),
    })
    ctx.effect(() => {
        const disposeTools = registerRollingSkillTools(ctx, application)
        const disposeRoute = ctx.webServer.register({
            kind: "exact",
            path: "/rolling-skill/api",
            handler: createRollingSkillApiHandler(application),
        })
        return async () => {
            disposeTools()
            disposeRoute()
            await application.close()
        }
    }, "rolling-skill: host service")
}
