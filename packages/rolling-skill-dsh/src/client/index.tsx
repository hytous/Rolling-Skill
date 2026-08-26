import {Workbench} from "./workbench/Workbench"
import workbenchCss from "./workbench/workbench.css"
import {DICTIONARIES, LOCALE_NAMESPACE} from "./locale"

interface ClientContext {
    effect(factory: () => (() => void), label: string): unknown
    locale: {
        bind(namespace: string): (key: string) => string
        getSnapshot(): {revision: number}
        register(namespace: string, dictionaries: typeof DICTIONARIES): () => void
        subscribe(listener: () => void): () => void
    }
    slots: {
        inject(name: string, register: () => unknown): unknown
        register(options: Record<string, unknown>, component: unknown): unknown
    }
}

export const inject = ["slots", "locale"]

export function apply(ctx: ClientContext): void {
    ctx.effect(
        () => ctx.locale.register(LOCALE_NAMESPACE, DICTIONARIES),
        "rolling-skill: dictionaries",
    )
    const t = ctx.locale.bind(LOCALE_NAMESPACE)
    ctx.effect(() => {
        const style = document.createElement("style")
        style.dataset.plugin = "@rolling-skill/dsh-plugin"
        style.textContent = workbenchCss
        document.head.appendChild(style)
        return () => style.remove()
    }, "rolling-skill: workbench styles")

    const RollingSkillSection = () => (
        <Workbench locale={ctx.locale} t={t}/>
    )
    ctx.slots.inject("settings.section", () => ctx.slots.register({
        name: "settings.section",
        id: "rolling-skill",
        order: 20,
        label: () => t("nav"),
        locale: LOCALE_NAMESPACE,
    }, RollingSkillSection))
}
