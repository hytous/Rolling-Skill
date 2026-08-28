import ReactMarkdown from "react-markdown"
import type {ReactNode} from "react"

import markdownPolicy from "./markdown-policy.cjs"

const safeMarkdownLink = markdownPolicy.safeMarkdownLink as (
    value: string | undefined,
) => string | null

export function MarkdownContent({
    children,
    compact = false,
}: {
    children: string | null | undefined
    compact?: boolean
}) {
    const value = typeof children === "string" ? children : ""
    return (
        <div className={`rolling-skill-markdown${compact ? " rolling-skill-markdown-compact" : ""}`}>
            <ReactMarkdown
                skipHtml
                components={{
                    a({href, children: linkChildren}: {href?: string; children?: ReactNode}) {
                        const safeHref = safeMarkdownLink(href)
                        if (!safeHref) return <span>{linkChildren}</span>
                        const external = !safeHref.startsWith("#")
                        return <a href={safeHref} {...(external ? {target: "_blank", rel: "noreferrer"} : {})}>{linkChildren}</a>
                    },
                    img({alt}: {alt?: string}) {
                        return <span className="rolling-skill-markdown-image-placeholder">{alt || "Image"}</span>
                    },
                }}
            >
                {value}
            </ReactMarkdown>
        </div>
    )
}
