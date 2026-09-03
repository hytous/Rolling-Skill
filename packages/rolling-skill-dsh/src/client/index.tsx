import workbenchCss from "./workbench/workbench.css"
import {DICTIONARIES, LOCALE_NAMESPACE} from "./locale"
import {CaseCaptureAction} from "./conversation/CaseCaptureAction"
import {ConversationCurationMarkers} from "./conversation/ConversationCurationMarkers"
import {WorkbenchLauncher} from "./workbench/WorkbenchLauncher"
import {RollingSkillSettings} from "./settings/RollingSkillSettings"
import {registerNativeSessionNavigation, type NativeSessions} from "./workbench/native-session-navigation"

interface ClientContext {
    sessions: NativeSessions
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

export const inject = ["slots", "locale", "sessions"]

export function apply(ctx: ClientContext): void {
    ctx.effect(() => registerNativeSessionNavigation(ctx.sessions), "rolling-skill: native session navigation")
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

    const RollingSkillSection = () => <RollingSkillSettings t={t}/>
    ctx.slots.inject("settings.section", () => ctx.slots.register({
        name: "settings.section",
        id: "rolling-skill",
        order: 20,
        label: () => t("nav"),
        locale: LOCALE_NAMESPACE,
    }, RollingSkillSection))

    const RollingSkillWorkbenchLauncher = (props: Record<string, unknown>) => (
        <WorkbenchLauncher wide={Boolean(props.wide)} locale={ctx.locale} t={t}/>
    )
    ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
        name: "sidebar.footer.action",
        id: "rolling-skill-workbench",
        order: 20,
        label: () => t("nav"),
        locale: LOCALE_NAMESPACE,
    }, RollingSkillWorkbenchLauncher))

    const RollingSkillCaseCaptureAction = (props: Record<string, unknown>) => (
        <CaseCaptureAction
            {...props}
            messageId={String(props.messageId ?? "")}
            sessionId={String(props.sessionId ?? "")}
            t={t}
        />
    )
    ctx.slots.inject("conversation.chat.assistant-actions", () => ctx.slots.register({
        name: "conversation.chat.assistant-actions",
        id: "rolling-skill-case-capture",
        order: 20,
        locale: LOCALE_NAMESPACE,
    }, RollingSkillCaseCaptureAction))

    const RollingSkillConversationMarkers = (props: Record<string, unknown>) => (
        <ConversationCurationMarkers
            sessionId={String(props.sessionId ?? "")}
            useSession={props.useSession as never}
            t={t}
        />
    )
    ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
        name: "conversation.session.header.utilities",
        id: "rolling-skill-curation-markers",
        order: 20,
        locale: LOCALE_NAMESPACE,
    }, RollingSkillConversationMarkers))
}
