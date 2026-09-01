import type {ReactNode} from "react"

export type OperationState = "starting" | "running" | "succeeded" | "failed"

export function OperationStatus({
    state,
    children,
}: {
    state: OperationState
    children: ReactNode
}) {
    return (
        <div
            className="rolling-skill-operation-feedback"
            data-state={state}
            role={state === "failed" ? "alert" : "status"}
            aria-live="polite"
        >
            <span className="rolling-skill-operation-indicator" aria-hidden="true"/>
            <span>{children}</span>
        </div>
    )
}
