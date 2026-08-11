;(function exposeMessageMarkdown(root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory(require("./message-links.js"), require("he"))
    } else {
        root.RollingSkillMessageMarkdown = factory(root.RollingSkillMessageLinks, root.he)
    }
})(typeof globalThis === "undefined" ? this : globalThis, function createMessageMarkdown(messageLinks, entities) {
    "use strict"

    function requireLexer(options) {
        const markedApi = options.marked ?? globalThis.marked
        if (!markedApi || typeof markedApi.lexer !== "function") {
            throw new Error("Safe Markdown rendering requires marked.lexer")
        }
        return markedApi.lexer.bind(markedApi)
    }

    function requireDocument(container, options) {
        const documentRef = options.document ?? container?.ownerDocument ?? globalThis.document
        if (!documentRef || typeof documentRef.createElement !== "function") {
            throw new Error("Safe Markdown rendering requires a document")
        }
        return documentRef
    }

    function textNode(context, value) {
        return context.document.createTextNode(String(value ?? ""))
    }

    function decodeMarkdownEntities(value) {
        const source = String(value ?? "")
        return typeof entities?.decode === "function" ? entities.decode(source) : source
    }

    function classifyLink(value, context) {
        if (!messageLinks || typeof messageLinks.tokenizeMessageLinks !== "function") return null
        const target = String(value ?? "")
        if (!target || /[<>\r\n]/u.test(target)) return null
        const probe = messageLinks.tokenizeMessageLinks(`[link](<${target}>)`, {
            workspaceRoot: context.workspaceRoot,
        })
        return probe.length === 1 && probe[0].type !== "text" ? probe[0] : null
    }

    function createLink(token, context) {
        const link = context.document.createElement("a")
        link.className = "message-link"
        link.href = token.type === "external" ? token.target : "#"
        if (token.type === "external") {
            link.rel = "noreferrer"
            link.dataset.externalUrl = token.target
        } else {
            link.dataset.localPath = token.target
            if (token.line !== null) {
                link.dataset.line = String(token.line)
                link.title = `${token.target}:${token.line}`
            }
        }
        return link
    }

    function appendLinkifiedText(container, value, context) {
        const source = String(value ?? "")
        if (!source) return
        const tokens = messageLinks?.tokenizeMessageLinks?.(source, {
            workspaceRoot: context.workspaceRoot,
        }) ?? [{type: "text", text: source}]
        for (const token of tokens) {
            if (token.type === "text") {
                container.append(textNode(context, decodeMarkdownEntities(token.text)))
            }
            else {
                const link = createLink(token, context)
                link.append(textNode(context, decodeMarkdownEntities(token.label)))
                container.append(link)
            }
        }
    }

    function appendLiteral(container, value, context) {
        container.append(textNode(context, value))
    }

    function appendDecodedLiteral(container, value, context) {
        appendLiteral(container, decodeMarkdownEntities(value), context)
    }

    function appendInlineTokens(container, tokens, context, options = {}) {
        for (const token of Array.isArray(tokens) ? tokens : []) {
            switch (token?.type) {
                case "text":
                case "escape":
                    if (Array.isArray(token.tokens) && token.tokens.length) {
                        appendInlineTokens(container, token.tokens, context, options)
                    } else if (options.linkifyText === false) {
                        appendDecodedLiteral(container, token.text ?? token.raw ?? "", context)
                    } else {
                        appendLinkifiedText(container, token.text ?? token.raw ?? "", context)
                    }
                    break
                case "strong":
                case "em":
                case "del": {
                    const element = context.document.createElement(token.type)
                    appendInlineTokens(element, token.tokens, context, options)
                    container.append(element)
                    break
                }
                case "codespan": {
                    const code = context.document.createElement("code")
                    code.className = "markdown-inline-code"
                    appendLiteral(code, token.text ?? "", context)
                    container.append(code)
                    break
                }
                case "br":
                    container.append(context.document.createElement("br"))
                    break
                case "link": {
                    const classified = classifyLink(decodeMarkdownEntities(token.href), context)
                    if (!classified) {
                        appendLiteral(
                            container,
                            token.raw ?? `[${token.text ?? ""}](${token.href ?? ""})`,
                            context,
                        )
                        break
                    }
                    const link = createLink(classified, context)
                    if (Array.isArray(token.tokens) && token.tokens.length) {
                        appendInlineTokens(link, token.tokens, context, {linkifyText: false})
                    } else {
                        appendLiteral(link, token.text ?? classified.label, context)
                    }
                    container.append(link)
                    break
                }
                case "image":
                case "html":
                    appendLiteral(container, token.raw ?? token.text ?? "", context)
                    break
                default:
                    appendLiteral(container, token?.raw ?? token?.text ?? "", context)
                    break
            }
        }
    }

    function appendList(container, token, context) {
        const list = context.document.createElement(token.ordered ? "ol" : "ul")
        list.className = "markdown-list"
        if (token.ordered && Number.isInteger(token.start) && token.start !== 1) {
            list.setAttribute("start", token.start)
        }
        if (token.items?.some((item) => item.task)) list.className += " markdown-task-list"
        for (const item of token.items ?? []) {
            const listItem = context.document.createElement("li")
            const preserveParagraphs = Boolean(token.loose || item.loose)
            if (item.task) {
                const checkbox = context.document.createElement("input")
                checkbox.type = "checkbox"
                checkbox.disabled = true
                checkbox.checked = Boolean(item.checked)
                checkbox.setAttribute("aria-hidden", "true")
                listItem.append(checkbox)
            }
            for (const child of item.tokens ?? []) {
                if (child.type === "text" || child.type === "paragraph") {
                    const paragraph = preserveParagraphs
                        ? context.document.createElement("p")
                        : listItem
                    appendInlineTokens(
                        paragraph,
                        child.tokens ?? [{type: "text", text: child.text ?? child.raw ?? ""}],
                        context,
                    )
                    if (preserveParagraphs) listItem.append(paragraph)
                } else {
                    appendBlockToken(listItem, child, context)
                }
            }
            list.append(listItem)
        }
        container.append(list)
    }

    function cellTokens(cell) {
        if (Array.isArray(cell)) return cell
        if (Array.isArray(cell?.tokens)) return cell.tokens
        return [{type: "text", text: cell?.text ?? cell ?? ""}]
    }

    function appendTableRow(section, cells, tagName, alignments, context) {
        const row = context.document.createElement("tr")
        for (let index = 0; index < (cells ?? []).length; index += 1) {
            const cell = context.document.createElement(tagName)
            const alignment = alignments?.[index]
            if (alignment === "left" || alignment === "center" || alignment === "right") {
                cell.dataset.align = alignment
            }
            appendInlineTokens(cell, cellTokens(cells[index]), context)
            row.append(cell)
        }
        section.append(row)
    }

    function appendTable(container, token, context) {
        const wrapper = context.document.createElement("div")
        wrapper.className = "markdown-table-wrap"
        const table = context.document.createElement("table")
        table.className = "markdown-table"
        const head = context.document.createElement("thead")
        appendTableRow(head, token.header, "th", token.align, context)
        table.append(head)
        const body = context.document.createElement("tbody")
        for (const row of token.rows ?? []) {
            appendTableRow(body, row, "td", token.align, context)
        }
        table.append(body)
        wrapper.append(table)
        container.append(wrapper)
    }

    function appendBlockToken(container, token, context) {
        switch (token?.type) {
            case "space":
            case "def":
                break
            case "heading": {
                const depth = Math.min(6, Math.max(1, Number(token.depth) || 1))
                const heading = context.document.createElement(`h${depth}`)
                appendInlineTokens(heading, token.tokens, context)
                container.append(heading)
                break
            }
            case "paragraph": {
                const paragraph = context.document.createElement("p")
                appendInlineTokens(paragraph, token.tokens, context)
                container.append(paragraph)
                break
            }
            case "text": {
                const paragraph = context.document.createElement("p")
                appendInlineTokens(
                    paragraph,
                    token.tokens ?? [{type: "text", text: token.text ?? token.raw ?? ""}],
                    context,
                )
                container.append(paragraph)
                break
            }
            case "list":
                appendList(container, token, context)
                break
            case "blockquote": {
                const quote = context.document.createElement("blockquote")
                appendBlockTokens(quote, token.tokens, context)
                container.append(quote)
                break
            }
            case "code": {
                const pre = context.document.createElement("pre")
                const code = context.document.createElement("code")
                const language = String(token.lang ?? "").trim().split(/\s+/u)[0]
                if (/^[A-Za-z0-9_+-]+$/u.test(language)) code.dataset.language = language
                appendLiteral(code, token.text ?? "", context)
                pre.append(code)
                container.append(pre)
                break
            }
            case "table":
                appendTable(container, token, context)
                break
            case "hr":
                container.append(context.document.createElement("hr"))
                break
            case "html": {
                const paragraph = context.document.createElement("p")
                paragraph.className = "markdown-raw-html"
                appendLiteral(paragraph, token.raw ?? token.text ?? "", context)
                container.append(paragraph)
                break
            }
            default: {
                const paragraph = context.document.createElement("p")
                appendLiteral(paragraph, token?.raw ?? token?.text ?? "", context)
                container.append(paragraph)
                break
            }
        }
    }

    function appendBlockTokens(container, tokens, context) {
        for (const token of Array.isArray(tokens) ? tokens : []) {
            appendBlockToken(container, token, context)
        }
    }

    function appendSafeMessageMarkdown(container, value, options = {}) {
        const document = requireDocument(container, options)
        const lexer = requireLexer(options)
        const tokens = lexer(String(value ?? ""), {
            gfm: true,
            breaks: true,
            pedantic: false,
        })
        if (!Array.isArray(tokens)) throw new Error("marked.lexer must return Markdown tokens")
        appendBlockTokens(container, tokens, {
            document,
            workspaceRoot: String(options.workspaceRoot ?? ""),
        })
        return container
    }

    return {appendSafeMessageMarkdown}
})
