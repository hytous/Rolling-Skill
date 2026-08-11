const assert = require("node:assert/strict")
const {describe, it} = require("node:test")
const marked = require("marked")

const {appendSafeMessageMarkdown} = require("../renderer/message-markdown.js")

class FakeNode {
    constructor(ownerDocument, type, value = "") {
        this.ownerDocument = ownerDocument
        this.nodeType = type === "#text" ? 3 : 1
        this.tagName = type === "#text" ? undefined : type.toUpperCase()
        this.data = type === "#text" ? value : undefined
        this.children = []
        this.dataset = {}
        this.attributes = new Map()
        this.className = ""
    }

    append(...nodes) {
        this.children.push(...nodes)
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value))
    }

    getAttribute(name) {
        return this.attributes.get(name) ?? null
    }

    set textContent(value) {
        if (this.nodeType === 3) {
            this.data = String(value)
            return
        }
        this.children = [this.ownerDocument.createTextNode(String(value))]
    }

    get textContent() {
        if (this.nodeType === 3) return this.data
        return this.children.map((child) => child.textContent).join("")
    }

    set innerHTML(_value) {
        throw new Error("innerHTML must not be used")
    }

    get innerHTML() {
        throw new Error("innerHTML must not be read")
    }
}

class FakeDocument {
    createElement(tag) {
        return new FakeNode(this, tag)
    }

    createTextNode(value) {
        return new FakeNode(this, "#text", String(value))
    }
}

function fixture(tokens) {
    const calls = []
    return {
        calls,
        marked: {
            lexer(value, options) {
                calls.push({value, options})
                return tokens
            },
        },
    }
}

function render(tokens, options = {}) {
    const document = new FakeDocument()
    const container = document.createElement("div")
    const source = fixture(tokens)
    appendSafeMessageMarkdown(container, options.value ?? "source markdown", {
        document,
        marked: source.marked,
        workspaceRoot: options.workspaceRoot,
    })
    return {container, calls: source.calls}
}

function descendants(node, tagName) {
    const expected = tagName.toUpperCase()
    const result = []
    for (const child of node.children ?? []) {
        if (child.tagName === expected) result.push(child)
        result.push(...descendants(child, tagName))
    }
    return result
}

describe("safe message Markdown rendering", () => {
    it("renders real marked lexer output for the Markdown structures used in conversations", () => {
        const document = new FakeDocument()
        const container = document.createElement("div")
        appendSafeMessageMarkdown(
            container,
            [
                "## Result",
                "",
                "- first",
                "- **second**",
                "",
                "| Model | Cost |",
                "| --- | ---: |",
                "| Hunyuan | 12 |",
                "",
                "```sh",
                "echo A/B",
                "```",
            ].join("\n"),
            {document, marked},
        )

        assert.equal(descendants(container, "h2")[0].textContent, "Result")
        assert.equal(descendants(container, "li").length, 2)
        assert.equal(descendants(container, "strong")[0].textContent, "second")
        assert.equal(descendants(container, "table").length, 1)
        assert.equal(descendants(container, "td")[1].textContent, "12")
        assert.equal(descendants(container, "pre")[0].textContent, "echo A/B")
        assert.equal(descendants(container, "a").length, 0)
    })

    it("decodes safe Markdown entities as text without parsing HTML", () => {
        const document = new FakeDocument()
        const container = document.createElement("div")
        appendSafeMessageMarkdown(container, "AT&amp;T &lt;tag&gt; &#35;1 &copy; &mdash; &hellip;", {
            document,
            marked,
        })

        assert.equal(container.textContent, "AT&T <tag> #1 © — …")
        assert.equal(descendants(container, "tag").length, 0)
    })

    it("preserves paragraph boundaries in loose lists", () => {
        const document = new FakeDocument()
        const container = document.createElement("div")
        appendSafeMessageMarkdown(
            container,
            "- first paragraph\n\n  second paragraph\n\n- next",
            {document, marked},
        )

        const items = descendants(container, "li")
        assert.equal(items.length, 2)
        assert.deepEqual(
            descendants(items[0], "p").map((paragraph) => paragraph.textContent),
            ["first paragraph", "second paragraph"],
        )
    })

    it("uses the injected marked lexer and renders common block and inline structures", () => {
        const tokens = [
            {
                type: "heading",
                depth: 2,
                tokens: [{type: "text", text: "Result"}],
            },
            {
                type: "paragraph",
                tokens: [
                    {type: "strong", tokens: [{type: "text", text: "bold"}]},
                    {type: "text", text: " and "},
                    {type: "em", tokens: [{type: "text", text: "italic"}]},
                    {type: "text", text: " and "},
                    {type: "del", tokens: [{type: "text", text: "old"}]},
                    {type: "br"},
                    {type: "codespan", text: "a/b"},
                ],
            },
            {
                type: "list",
                ordered: false,
                items: [
                    {tokens: [{type: "text", tokens: [{type: "text", text: "first"}]}]},
                    {tokens: [{type: "text", tokens: [{type: "text", text: "second"}]}]},
                ],
            },
            {
                type: "blockquote",
                tokens: [
                    {type: "paragraph", tokens: [{type: "text", text: "quoted"}]},
                ],
            },
            {type: "code", lang: "js unsafe", text: "const ratio = 'A/B'"},
            {type: "hr"},
        ]
        const {container, calls} = render(tokens)

        assert.equal(calls.length, 1)
        assert.equal(calls[0].value, "source markdown")
        assert.equal(calls[0].options.gfm, true)
        assert.equal(descendants(container, "h2")[0].textContent, "Result")
        assert.equal(descendants(container, "strong")[0].textContent, "bold")
        assert.equal(descendants(container, "em")[0].textContent, "italic")
        assert.equal(descendants(container, "del")[0].textContent, "old")
        assert.equal(descendants(container, "br").length, 1)
        assert.equal(descendants(container, "ul")[0].children.length, 2)
        assert.equal(descendants(container, "blockquote")[0].textContent, "quoted")
        assert.equal(descendants(container, "pre")[0].textContent, "const ratio = 'A/B'")
        assert.equal(descendants(container, "pre")[0].children[0].dataset.language, "js")
        assert.equal(descendants(container, "hr").length, 1)
    })

    it("renders GFM tables without style or HTML injection", () => {
        const {container} = render([
            {
                type: "table",
                align: ["left", "right"],
                header: [
                    {tokens: [{type: "text", text: "Business"}]},
                    {tokens: [{type: "text", text: "Cost"}]},
                ],
                rows: [
                    [
                        {tokens: [{type: "text", text: "PCG"}]},
                        {tokens: [{type: "strong", tokens: [{type: "text", text: "12"}]}]},
                    ],
                ],
            },
        ])

        assert.equal(descendants(container, "table").length, 1)
        assert.deepEqual(
            descendants(container, "th").map((cell) => cell.textContent),
            ["Business", "Cost"],
        )
        assert.deepEqual(
            descendants(container, "td").map((cell) => cell.textContent),
            ["PCG", "12"],
        )
        assert.equal(descendants(container, "th")[1].dataset.align, "right")
    })

    it("uses the existing message-link classifier for safe web and local links", () => {
        const {container} = render(
            [
                {
                    type: "paragraph",
                    tokens: [
                        {
                            type: "link",
                            raw: "[docs](https://example.com/docs?a=1&amp;b=2)",
                            href: "https://example.com/docs?a=1&amp;b=2",
                            tokens: [{type: "text", text: "AT&amp;T docs"}],
                        },
                        {type: "text", text: " "},
                        {
                            type: "link",
                            raw: "[app](</work/acme/src/app.js:42>)",
                            href: "/work/acme/src/app.js:42",
                            tokens: [{type: "text", text: "app"}],
                        },
                    ],
                },
            ],
            {workspaceRoot: "/work/acme"},
        )

        const links = descendants(container, "a")
        assert.equal(links.length, 2)
        assert.equal(links[0].textContent, "AT&T docs")
        assert.equal(links[0].dataset.externalUrl, "https://example.com/docs?a=1&b=2")
        assert.equal(links[1].dataset.localPath, "/work/acme/src/app.js")
        assert.equal(links[1].dataset.line, "42")
    })

    it("keeps rejected Markdown links, HTML, and images inert and textual", () => {
        const {container} = render([
            {
                type: "paragraph",
                tokens: [
                    {
                        type: "link",
                        raw: "[route](/v1/responses)",
                        href: "/v1/responses",
                        tokens: [{type: "text", text: "route"}],
                    },
                    {type: "text", text: " "},
                    {
                        type: "link",
                        raw: "[run](javascript:alert(1))",
                        href: "javascript:alert(1)",
                        tokens: [{type: "text", text: "run"}],
                    },
                    {type: "text", text: " "},
                    {type: "html", raw: "<img src=x onerror=alert(1)>"},
                    {type: "text", text: " "},
                    {type: "image", raw: "![secret](https://example.com/secret.png)", text: "secret"},
                ],
            },
        ])

        assert.equal(descendants(container, "a").length, 0)
        assert.equal(descendants(container, "img").length, 0)
        assert.equal(descendants(container, "script").length, 0)
        assert.match(container.textContent, /\[route\]\(\/v1\/responses\)/)
        assert.match(container.textContent, /javascript:alert/)
        assert.match(container.textContent, /<img src=x onerror=alert\(1\)>/)
        assert.match(container.textContent, /!\[secret\]/)
    })

    it("does not linkify URLs or paths inside fenced or inline code", () => {
        const {container} = render([
            {type: "code", text: "https://example.com\n/Users/example/app.js"},
            {
                type: "paragraph",
                tokens: [
                    {type: "codespan", text: "https://example.com /Users/example/app.js"},
                ],
            },
        ])

        assert.equal(descendants(container, "a").length, 0)
        assert.equal(descendants(container, "code").length, 2)
    })

    it("does not turn slash commands, API routes, dates, ratios, or prose into links", () => {
        const value = "/skill billing 调用 /v1/responses，26/27 年，A/B，输入/输出"
        const {container} = render([
            {type: "paragraph", tokens: [{type: "text", text: value}]},
        ])

        assert.equal(descendants(container, "a").length, 0)
        assert.equal(container.textContent, value)
    })

    it("decodes entity-obfuscated URLs and paths without turning them into links", () => {
        const value = "https&#58;//example.com and &#47;Users/example/app.js"
        const {container} = render([
            {type: "paragraph", tokens: [{type: "text", text: value}]},
        ])

        assert.equal(descendants(container, "a").length, 0)
        assert.equal(container.textContent, "https://example.com and /Users/example/app.js")
    })

    it("fails clearly when marked.lexer is unavailable", () => {
        const document = new FakeDocument()
        const container = document.createElement("div")
        assert.throws(
            () => appendSafeMessageMarkdown(container, "text", {document, marked: {}}),
            /marked\.lexer/i,
        )
    })
})
