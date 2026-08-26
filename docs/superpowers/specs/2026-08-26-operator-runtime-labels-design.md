# Operator Runtime 完整标签设计

## 问题

自操作表单的 Operator Runtime 下拉已经显示 `displayName + version`，但“允许操作的目标 Runtime”和 Judge Runtime 只显示 `displayName`。当本机同时发现两个 Codex 版本时，两项都显示为 `Codex`，用户无法判断自己勾选的是哪一个。

## 方案

在 `renderer/operator-workbench.js` 中提供一个纯函数 `runtimeDisplayLabel(runtime, catalog)`，作为 Operator 工作台所有 Runtime 选择控件的唯一标签规则：

1. 基础名称按 `displayName`、`providerId`、`runtimeId` 的顺序回退。
2. Runtime 有 `version` 且名称尚未包含该版本时，显示 `名称 + 版本`，例如 `Codex 0.149.0-alpha.4.3`。
3. 若完整的 `名称 + 版本` 在当前目录中仍重复，则追加 `executablePath`；没有路径时回退到 `source` 或 `runtimeId`。

主 Runtime、目标 Runtime 和 Judge Runtime 都调用该函数。Runtime 的 `value` 仍是原有 `runtimeId`，不修改发现、选择、权限或执行逻辑。

## 界面

目标 Runtime 卡片给标签增加专用 class，允许必要时换行，避免路径被强制压成不可辨认的单行。常见的不同版本只显示简洁的 `名称 + 版本`，不会默认展示路径。

## 测试

在 `test/operator-workbench.test.cjs` 直接测试纯函数：

- 两个不同版本分别得到不同的 `Codex <version>` 标签。
- 同名称同版本时追加各自路径。
- 名称已包含版本时不重复追加。

只运行 Operator 工作台聚焦测试，再离线更新仓库根目录 App，并在本机自操作页检查一次实际目标 Runtime 标签。
