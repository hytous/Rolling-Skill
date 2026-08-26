import applicationModule from "../../../rolling-skill-core/src/index.cjs"
import apiModule from "./api.cjs"
import {registerRollingSkillTools} from "./tools.js"

const {createRollingSkillApplication} = applicationModule
const {createRollingSkillApiHandler} = apiModule

export const inject = ["webServer", "tools"]

export function apply(ctx, config = {}) {
    const application = createRollingSkillApplication({dataRoot: config.dataRoot})
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
