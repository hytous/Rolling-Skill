# Evaluation Judge Details Public Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让当前统一格式评测在详情页显示逐项 Judge 评论、真实模型与绑定状态，同时继续隐藏私有执行数据。

**Architecture:** 扩充 `evaluations.get` 的严格公共 schema，并在 domain service 中逐字段构造安全视图。列表接口保持摘要化，Renderer 复用现有统一评分展示。

**Tech Stack:** Node.js、Zod、Electron Renderer、`node:test`

---

### Task 1: 锁定详情契约行为

**Files:**
- Modify: `desktop/rolling-skill/test/control-plane.test.cjs`

- [x] **Step 1: 写失败测试**

构造包含统一评分详情与私有执行字段的完整评测记录，断言公共读取保留评分评论并移除私有字段。

- [x] **Step 2: 验证测试因详情字段缺失而失败**

Run: `node --test --test-name-pattern='returns sanitized criterion-level Judge comments' test/control-plane.test.cjs`

Expected: FAIL，`judgeConfiguration` 尚未出现在公共结果中。

### Task 2: 扩充严格公共契约与安全映射

**Files:**
- Modify: `desktop/rolling-skill/src/control-plane/contracts.cjs`
- Modify: `desktop/rolling-skill/src/control-plane/domain-services.cjs`

- [x] **Step 1: 增加受限的评分、评价、契约、模型和绑定 schema**

只允许 Renderer 展示需要的字段，并为字符串和数组设置上限。

- [x] **Step 2: 实现逐字段公共映射**

保留统一评分详情；明确不复制 response、trace、thread、executablePath 和 scoreContract evidence。

- [x] **Step 3: 运行聚焦测试并确认通过**

Run: `node --test --test-name-pattern='returns sanitized criterion-level Judge comments' test/control-plane.test.cjs`

Expected: PASS。

### Task 3: 回归与真实界面验证

**Files:**
- Modify if needed: `desktop/rolling-skill/test/control-plane-contracts.test.cjs`

- [x] **Step 1: 运行控制面、Renderer smoke 和桌面端全量测试**

Run: `node --test test/control-plane.test.cjs test/control-plane-contracts.test.cjs`

Run: `npm run smoke:renderer`

Run: `npm test`

Expected: 全部通过且 Renderer 无错误。

- [ ] **Step 2: 构建并在当前优化结束后安装 App**

Run: `bash desktop/rolling-skill/scripts/build-macos-app.sh`

安装时不得中断仍在运行的自动优化任务；任务结束后再替换 `/Applications/Rolling Skill.app`。

- [ ] **Step 3: 打开当前评测验证**

当前统一评测应显示“Judge 与评分明细”，模型为 GPT-5.6-Sol，且不再显示错误的 Skill 绑定诊断。

- [ ] **Step 4: 提交并推送**

仅暂存源码、测试与文档；不得暂存任何 `rolling-skill-dsh-plugin-*.tgz`。
