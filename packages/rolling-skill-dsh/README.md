# Rolling Skill for DeepSeek Harness

Rolling Skill 是一个可安装到 DeepSeek Harness（DSH）的原生双语工作台，用于持续沉淀、更新和评测真实 Case。插件包含 Host、Client、一次性后台 Worker 和共享 Core，安装一个包即可使用。

## 要求

- DeepSeek Harness `0.1.1-rc.1` 或兼容版本；
- Node.js 22 或更高版本；
- 至少一个已安装、可被本机发现的 Codex、CodeBuddy 或 DSH Runtime。

界面跟随 Harness 的中文/英文设置和主题。插件不会安装、下载或升级 Runtime，也不会启动 Electron App 或额外打开浏览器网页。

## 安装与更新

包发布到实际软件源后，可以按包名安装（本地打包不代表已公开发布）：

```bash
dsh plugin --profile web add @rolling-skill/dsh-plugin
```

从本地或下载好的 `.tgz` 安装：

```bash
dsh plugin --profile web add ./rolling-skill-dsh-plugin-0.1.0.tgz
```

通过 HTTPS 分发时，先下载再安装同一个 npm 兼容包：

```bash
curl -fL -o rolling-skill-dsh-plugin-0.1.0.tgz https://example.com/rolling-skill-dsh-plugin-0.1.0.tgz
dsh plugin --profile web add ./rolling-skill-dsh-plugin-0.1.0.tgz
```

腾讯 npm 软件源也可以托管此包。发布到实际的软件源后，为 `@rolling-skill` scope 配置企业提供的 registry，再使用相同的 `dsh plugin --profile web add @rolling-skill/dsh-plugin` 命令安装。软件源地址和登录方式以所属腾讯 npm 服务的配置为准。

更新时重新执行对应的 `add` 命令即可。启动 Harness：

```bash
dsh web --no-open
```

安装后从 Harness 侧栏底部打开独立的 Rolling Skill Workbench。日常的 Draft 审阅、Dataset / Case / Raw Case、评分标准、Managed Skill、安装、评测、自动沉淀、Operator 和 Optimization 都在工作台中；Settings 只保留默认 Runtime 与 Curator/Rubric/Judge Profile、数据诊断和旧版导入。

每条已完成的 Assistant 回复旁会出现“沉淀 Case”入口，不需要先切到工作台。创建后，Draft 来源区间使用 warning 色，保存成 Case 后使用 success 色；刷新和重新打开会话后标记仍从持久化证据恢复。手工 Raw Case 没有完整 Episode 时，可以从工作台把原问题原样派发到新的 DSH 原生会话，成功入队后才标记为 dispatched。

当前会话的按钮和区间颜色共用一个刷新源，自动沉淀产生的变化也会同步显示。短暂断连会保留已有标记，不会把已保存的范围误显示为未沉淀。

Dataset 只绑定受管 Repository/Skill 的稳定 ID，不保存 Runtime 安装路径。操作使用已发布版本和已有的成功安装记录；不会在执行前重新读取或校验 Runtime 中的 Skill 内容，也不会额外强制加载 Skill 改变真实触发情况。

## 完全自动沉淀

业务模式包括关闭、定时提取和完全自动。来源会话 Runtime、Case 检测 Runtime 分别选择；检测模型与 Curator/Rubric/Judge 的保存配置互不覆盖。未完成且没有新增内容的会话只保留游标，不会每次运行都重新调用检测模型。

执行位置包括仅 Harness 运行时以及 Harness 关闭后仍运行。后者在自动沉淀页点击“启用后台定时运行”，创建当前用户的系统定时任务：

- macOS：LaunchAgent；
- Linux：systemd user timer；
- Windows：Task Scheduler。

固定调度标识为 `com.rolling-skill.dsh.capture`。Harness 打开时由 Host 调度，关闭时由一次性 Worker 接手。单写入者锁防止两者同时持有数据缓存并互相覆盖；Worker 会等本轮 Curator 保存完成或明确失败才退出，不会生成到一半就结束。启动 Harness 不会立即补跑历史计划；“立即运行一次”由用户显式触发。

Worker 启动 DSH Runtime 时使用 `--profile web --no-open --port 0`。该子 Host 仅提供受限的会话证据读取入口，不另建业务数据写入者。Worker 正在写入时打开 Harness，工作台会明确提示数据暂被后台任务使用，待后台完成后恢复。

自动任务持久化记录归属，重启后只恢复自动生成的 Draft，不会因为来源相同而自动保存手工审核中的 Draft。失败的 Raw Case 和 Draft 留在工作台供查看和处理。

## 自操作

启动前选择 Skill、数据集、允许使用的目标 Runtime、操作权限和预算。默认仅勾选读取能力；空资源范围不表示全部资源。执行、修改、发布等能力需显式选择，高风险操作仍经过确认。启动后的范围与预算固定，任务详情显示对话与产物。

## 数据与旧版导入

默认数据目录为 `~/.dsh/rolling-skill`。更新和普通卸载都会保留该目录；普通卸载会保留所有数据。

设置页可以显式导入归档 Electron 版的数据。导入采用 copy-only：先复制到 staging，校验已知 schema，再原子切换；不会修改或删除 Electron 源目录。导入成功后需要重启 Harness。

## 卸载

如果启用了后台定时运行，先在 Rolling Skill 的自动沉淀页选择“停止后台定时运行”，再卸载插件：

```bash
dsh plugin --profile web remove @rolling-skill/dsh-plugin
```

卸载不会删除 `~/.dsh/rolling-skill`。清除数据属于独立的破坏性操作，应在确认目录和备份后由用户自行执行。

## 开发打包

```bash
npm install
npm run build --workspace @rolling-skill/dsh-plugin
mkdir -p packages/rolling-skill-dsh/dist
npm pack --workspace @rolling-skill/dsh-plugin --pack-destination packages/rolling-skill-dsh/dist
node packages/rolling-skill-dsh/scripts/inspect-package.mjs packages/rolling-skill-dsh/dist/rolling-skill-dsh-plugin-0.1.0.tgz
```
