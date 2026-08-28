import {Button} from "@deepseek-ai/dsh-client-ui-primitives"
import type {ComponentProps} from "react"

type PrimitiveButtonProps = ComponentProps<typeof Button>
type ActionTone = "primary" | "secondary" | "quiet"

export type ActionButtonProps = Omit<PrimitiveButtonProps, "variant"> & {
    tone?: ActionTone
}

const VARIANTS: Record<ActionTone, "primary" | "outline" | "ghost"> = {
    primary: "primary",
    secondary: "outline",
    quiet: "ghost",
}

export function ActionButton({tone = "secondary", className, ...props}: ActionButtonProps) {
    const classes = ["rolling-skill-action-button", className].filter(Boolean).join(" ")
    return (
        <Button
            {...props}
            className={classes}
            data-rolling-skill-tone={tone}
            variant={VARIANTS[tone]}
        />
    )
}
