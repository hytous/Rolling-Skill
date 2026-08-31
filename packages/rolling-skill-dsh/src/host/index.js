import applicationModule from "../../../rolling-skill-core/src/index.cjs"
import apiModule from "./api.cjs"
import sessionEvidenceModule from "./session-evidence.cjs"
import {registerRollingSkillTools} from "./tools.js"
import schedulerModule from "../scheduler/index.cjs"
import {createNativeSessionDispatcher} from "./native-session-dispatcher.js"
import {createPathRevealer} from "./reveal-path.js"
import skillSourcePickerModule from "./skill-source-picker.cjs"

const {createRollingSkillApplication, resolveDataPaths} = applicationModule
const {createRollingSkillApiHandler} = apiModule
const {createSessionEvidenceSource} = sessionEvidenceModule
const {createSchedulerAdapter, resolveWorkerExecutable} = schedulerModule
const {createNativeSkillSourcePicker, createSkillSourceDispatch} = skillSourcePickerModule

export const inject = ["webServer", "tools", "sessionQuery", "agents"]

export function apply(ctx, config = {}, dependencies = {}) {
    const environment = dependencies.environment ?? process.env
    if (environment.ROLLING_SKILL_OPERATOR_HOST === "1") return

    const dataPaths = resolveDataPaths({dataRoot: config.dataRoot})
    const schedulerAdapter = createSchedulerAdapter({
        dataRoot: config.dataRoot,
        workerExecutable: resolveWorkerExecutable(import.meta.url),
    })
    const application = createRollingSkillApplication({
        dataRoot: config.dataRoot,
        schedulerAdapter,
        ...(dependencies.runtimeRegistry ? {runtimeRegistry: dependencies.runtimeRegistry} : {}),
        conversationEpisodeSource: createSessionEvidenceSource({
            sessionQuery: ctx.sessionQuery,
            traceRoot: dataPaths.dshConversationTraces,
        }),
        rawCaseDispatcher: createNativeSessionDispatcher({agents: ctx.agents}),
        revealPath: createPathRevealer(),
    })
    const publicApplication = createSkillSourceDispatch(
        application,
        dependencies.skillSourcePicker ?? createNativeSkillSourcePicker(),
    )
    ctx.effect(() => {
        const disposeTools = registerRollingSkillTools(ctx, application)
        const disposeRoute = ctx.webServer.register({
            kind: "exact",
            path: "/rolling-skill/api",
            handler: createRollingSkillApiHandler(publicApplication),
        })
        return async () => {
            disposeTools()
            disposeRoute()
            await application.close()
        }
    }, "rolling-skill: host service")
}
