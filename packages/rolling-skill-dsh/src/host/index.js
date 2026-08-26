import applicationModule from "../../../rolling-skill-core/src/index.cjs"
import apiModule from "./api.cjs"

const {createRollingSkillApplication} = applicationModule
const {createRollingSkillApiHandler} = apiModule

export const inject = ["webServer", "tools"]

export function apply(ctx, config = {}) {
    const application = createRollingSkillApplication({dataRoot: config.dataRoot})
    ctx.effect(() => {
        const disposeRoute = ctx.webServer.register({
            kind: "exact",
            path: "/rolling-skill/api",
            handler: createRollingSkillApiHandler(application),
        })
        return async () => {
            disposeRoute()
            await application.close()
        }
    }, "rolling-skill: host service")
}
