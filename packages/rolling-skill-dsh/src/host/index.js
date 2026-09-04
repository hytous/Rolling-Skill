import {existsSync} from "node:fs"
import {dirname, resolve} from "node:path"
import {fileURLToPath} from "node:url"

import applicationModule from "../../../rolling-skill-core/src/index.cjs"
import apiModule from "./api.cjs"
import sessionEvidenceModule from "./session-evidence.cjs"
import {registerRollingSkillTools} from "./tools.js"
import schedulerModule from "../scheduler/index.cjs"
import {createNativeSessionDispatcher} from "./native-session-dispatcher.js"
import {createPathRevealer} from "./reveal-path.js"
import skillSourcePickerModule from "./skill-source-picker.cjs"
import applicationOwnerModule from "../../../rolling-skill-core/src/application-owner.cjs"

const {createRollingSkillApplication, resolveDataPaths} = applicationModule
const {createRollingSkillApiHandler} = apiModule
const {createSessionEvidenceSource} = sessionEvidenceModule
const {createSchedulerAdapter, resolveWorkerExecutable} = schedulerModule
const {createNativeSkillSourcePicker, createSkillSourceDispatch} = skillSourcePickerModule
const {createOwnedApplication} = applicationOwnerModule

export function resolveControlToolExecutable(moduleUrl = import.meta.url) {
    const moduleDirectory = dirname(fileURLToPath(moduleUrl))
    const packagedTool = resolve(moduleDirectory, "rolling-skill-tool")
    if (existsSync(packagedTool)) return packagedTool
    return resolve(
        moduleDirectory,
        "..",
        "..",
        "..",
        "..",
        "desktop",
        "rolling-skill",
        "dist-tools",
        "rolling-skill-tool",
    )
}

export const inject = ["webServer", "tools", "sessionQuery", "agents", "apiProxy"]

export function apply(ctx, config = {}, dependencies = {}) {
    const environment = dependencies.environment ?? process.env
    const dataPaths = resolveDataPaths({dataRoot: config.dataRoot})
    const conversationEpisodeSource = createSessionEvidenceSource({
        sessionQuery: ctx.sessionQuery,
        traceRoot: dataPaths.dshConversationTraces,
    })
    if (environment.ROLLING_SKILL_OPERATOR_HOST === "1") {
        // The Worker needs source evidence while the main UI is closed. Do not
        // create another application/store/scheduler in this managed Runtime.
        ctx.effect(() => ctx.webServer.register({
            kind: "exact",
            path: "/rolling-skill/evidence",
            handler: createRollingSkillApiHandler({dispatch(method, input) {
                if (method !== "capture") throw new Error("Unknown Rolling Skill method")
                return conversationEpisodeSource.capture(input)
            }}),
        }), "rolling-skill: trusted evidence reader")
        return
    }
    const schedulerAdapter = createSchedulerAdapter({
        dataRoot: config.dataRoot,
        workerExecutable: resolveWorkerExecutable(import.meta.url),
    })
    const controlToolPath = dependencies.controlToolPath ?? resolveControlToolExecutable(import.meta.url)
    const application = createOwnedApplication({lockDirectory: dataPaths.locks, createApplication: () => createRollingSkillApplication({
        dataRoot: config.dataRoot,
        schedulerAdapter,
        operatorToolPath: controlToolPath,
        installationToolPath: controlToolPath,
        ...(dependencies.runtimeRegistry ? {runtimeRegistry: dependencies.runtimeRegistry} : {}),
        conversationEpisodeSource,
        rawCaseDispatcher: createNativeSessionDispatcher({apiProxy: ctx.apiProxy}),
        revealPath: createPathRevealer(),
    })})
    void application.start().catch(() => { /* API reports a busy owner and retries after it exits. */ })
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
