const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {tokenizeMessageLinks} = require("../renderer/message-links.js")

describe("message link tokenization", () => {
    it("keeps slash-prefixed commands, API routes, dates, ratios, and prose as plain text", () => {
        for (const value of [
            "/skill billing-cost-management",
            "调用 /v1/responses 后继续",
            "26/27 年预算",
            "输入/输出和 A/B 测试",
            "这不是路径 /后面的内容也不是",
            "[responses](/v1/responses)",
        ]) {
            assert.deepEqual(tokenizeMessageLinks(value), [{type: "text", text: value}])
        }
    })

    it("links high-confidence macOS paths and keeps an optional line number", () => {
        assert.deepEqual(tokenizeMessageLinks("打开 /Users/example/project/app.js:42。"), [
            {type: "text", text: "打开 "},
            {
                type: "local",
                label: "/Users/example/project/app.js:42",
                target: "/Users/example/project/app.js",
                line: 42,
            },
            {type: "text", text: "。"},
        ])
        assert.deepEqual(
            tokenizeMessageLinks("见 /private/tmp/output.txt, 然后继续"),
            [
                {type: "text", text: "见 "},
                {
                    type: "local",
                    label: "/private/tmp/output.txt",
                    target: "/private/tmp/output.txt",
                    line: null,
                },
                {type: "text", text: ", 然后继续"},
            ],
        )
    })

    it("accepts paths below the exact workspace even when its root is uncommon", () => {
        assert.deepEqual(
            tokenizeMessageLinks("文件 /work/acme/src/app.js", {workspaceRoot: "/work/acme"}),
            [
                {type: "text", text: "文件 "},
                {
                    type: "local",
                    label: "/work/acme/src/app.js",
                    target: "/work/acme/src/app.js",
                    line: null,
                },
            ],
        )
    })

    it("supports explicit Markdown web and Codex-style local file links", () => {
        assert.deepEqual(
            tokenizeMessageLinks(
                "[docs](https://example.com/a) [report](</Users/example/My Project/report.md:3>)",
            ),
            [
                {type: "external", label: "docs", target: "https://example.com/a"},
                {type: "text", text: " "},
                {
                    type: "local",
                    label: "report",
                    target: "/Users/example/My Project/report.md",
                    line: 3,
                },
            ],
        )
        assert.deepEqual(
            tokenizeMessageLinks("见 </Users/example/My Project/report.md:3>"),
            [
                {type: "text", text: "见 "},
                {
                    type: "local",
                    label: "/Users/example/My Project/report.md:3",
                    target: "/Users/example/My Project/report.md",
                    line: 3,
                },
            ],
        )
        assert.deepEqual(
            tokenizeMessageLinks("[wiki](https://example.com/a_(b))"),
            [
                {
                    type: "external",
                    label: "wiki",
                    target: "https://example.com/a_(b)",
                },
            ],
        )
        assert.deepEqual(
            tokenizeMessageLinks("[final](</Users/example/My Project/report (final).md:3>)"),
            [
                {
                    type: "local",
                    label: "final",
                    target: "/Users/example/My Project/report (final).md",
                    line: 3,
                },
            ],
        )
        assert.deepEqual(tokenizeMessageLinks("[app](/Users/example/a_(b).js)"), [
            {
                type: "local",
                label: "app",
                target: "/Users/example/a_(b).js",
                line: null,
            },
        ])
    })

    it("preserves rejected candidates before a later valid link", () => {
        assert.deepEqual(
            tokenizeMessageLinks("API /v1/responses；文档 https://example.com/docs。"),
            [
                {type: "text", text: "API /v1/responses；文档 "},
                {
                    type: "external",
                    label: "https://example.com/docs",
                    target: "https://example.com/docs",
                },
                {type: "text", text: "。"},
            ],
        )
    })

    it("trims sentence punctuation and an unmatched closing parenthesis from bare URLs", () => {
        assert.deepEqual(tokenizeMessageLinks("见 https://example.com/a)."), [
            {type: "text", text: "见 "},
            {
                type: "external",
                label: "https://example.com/a",
                target: "https://example.com/a",
            },
            {type: "text", text: ")."},
        ])
        assert.deepEqual(tokenizeMessageLinks("见 https://example.com/a_(b)."), [
            {type: "text", text: "见 "},
            {
                type: "external",
                label: "https://example.com/a_(b)",
                target: "https://example.com/a_(b)",
            },
            {type: "text", text: "."},
        ])
    })

    it("does not link HTML-like text, JSON API routes, or unsupported schemes", () => {
        for (const value of [
            "</div>",
            '{"path":"/api/v1"}',
            "[run](javascript:alert(1))",
            "file:///Users/example/project/app.js",
        ]) {
            assert.deepEqual(tokenizeMessageLinks(value), [{type: "text", text: value}])
        }
    })

    it("does not discover a local path in the middle of a word", () => {
        const value = "prefix/Users/example/project/app.js"
        assert.deepEqual(tokenizeMessageLinks(value), [{type: "text", text: value}])
    })
})
