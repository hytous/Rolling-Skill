# Rolling Skill

Rolling Skill 现在以 DeepSeek Harness（DSH）原生插件为主要交付形态。它在 Harness Settings 中提供统一的中英文工作台，用于：

- 管理 Dataset、Good/Bad Case 与 Raw Case；
- 单个或批量更新因数据、工具变化而失效的 Case；
- 跨 Codex、CodeBuddy 和 DSH Runtime 运行 Skill 评测；
- 管理、发布并安装不可变 Skill 版本；
- 在受限能力、预算和审批下运行 Operator 与自动优化；
- 定时发现新对话中的完整问题，生成待审核 Raw Case，或通过全部安全闸门后自动沉淀 Case；
- 通过系统调度器在 Harness 关闭后继续执行自动沉淀；
- 只读复制并导入归档 Electron 版的数据。

插件不会捆绑、下载或升级任何 Runtime。Runtime 名称、版本和完整可执行路径都会作为独立身份显示，模型目录来自对应 Runtime 本身。

## 安装

在仓库根目录构建并生成 npm 兼容包：

```bash
npm install
npm run build --workspace @rolling-skill/dsh-plugin
mkdir -p packages/rolling-skill-dsh/dist
npm pack --workspace @rolling-skill/dsh-plugin --pack-destination packages/rolling-skill-dsh/dist
node packages/rolling-skill-dsh/scripts/inspect-package.mjs packages/rolling-skill-dsh/dist/rolling-skill-dsh-plugin-0.1.0.tgz
```

安装到现有 DSH `web` profile：

```bash
dsh plugin --profile web add ./packages/rolling-skill-dsh/dist/rolling-skill-dsh-plugin-0.1.0.tgz
dsh web --no-open
```

公共 npm、腾讯 npm 软件源、HTTPS `.tgz`、更新、卸载、数据保留与系统调度器说明见 [DSH 插件文档](packages/rolling-skill-dsh/README.md)。

## 数据

DSH 插件默认将数据保存在：

```text
~/.dsh/rolling-skill
```

普通更新或卸载插件不会删除数据。旧版 Electron 数据只能在设置页经过显式确认后 copy-only 导入；源目录不会被修改或删除。

## Electron 归档

Electron 版已停止继续开发，归档在：

- 分支：`archive/electron-before-dsh-plugin-20260826`
- 提交：`d9e6a27b60d957ded0b33765c0cc321b265175d5`

当前 `main` 只继续 DSH 插件与共享 Core。

## 开发命令

```bash
npm run test:dsh
npm run build:dsh
```

## License

见 [LICENSE](LICENSE)。
