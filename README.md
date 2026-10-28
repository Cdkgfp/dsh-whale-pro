# dsh-whale-compact

<p align="center">
  <img src="icon.png" width="96" height="96" alt="dsh-whale-compact icon">
</p>

<p align="center">
  DeepSeek Harness（DSH）桌面端右下角的<strong>小鲸鱼简洁版</strong>挂件：头顶常驻一条紧凑信息栏，保留自动提示泡泡，去掉手动点击大泡泡。
</p>

> 本仓库是 [DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget) 的简洁分支（fork），基于上游 0.4.2 改造。原始代码与素材版权归上游作者所有，详见 [LICENSE](LICENSE) 与 [PROVENANCE.md](PROVENANCE.md)。

## 特性

- **常驻信息栏**：在鲸鱼头顶显示余额、赠金、充值余额、今日已用。
- **峰谷进度条**：24 小时连续峰谷/谷时进度条，带当前时间线。
- **独立自动泡泡**：余额变化、提问、每轮消耗、授权、余额预警、今日预算；每种都有独立开关、内容编辑和预览。
- **移除手动点击泡泡**：点击鲸鱼不再打开旧的大泡泡；自动提示泡泡保留。
- **内联设置页**：外观 / 行为 / 音效 / 自动提示泡泡四类，横线分隔，胶囊开关，修改即时生效。
- **音效管理**：按压、任务结束、提问、授权四类音量与试听；音频片段导入、试听、删除；音效组选择。
- **图片管理**：角色图在「外观」中管理并可直接删除；泡泡图片库在「自动提示泡泡」中管理。
- **本地记账**：余额变化按观测累计今日已用；数据保存在本机 `$DSH_HOME`，插件不接管、不上传你的 API 密钥。

## 界面与操作

- 右下角鲸鱼头顶显示紧凑信息栏。
- 菜单按钮打开设置页；隐藏菜单按钮后，右键鲸鱼（移动端长按约 1.5 秒）唤出。
- 设置页分类：
  - **外观**：角色、大小、角色图管理。
  - **行为**：避让滚动条、隐藏菜单按钮、文字框显示开关。
  - **音效**：总开关、按压音效、任务结束音、提问提示音、授权提示音、音频资源。
  - **自动提示泡泡**：总开关、六种场景、泡泡图片库。
- 两处「总开关」关闭后，对应分组整体变灰且不可操作。
- 音量滑条范围 0–100，默认 100%。

## 前置条件

- 余额取数优先使用 DSH 凭据中的 `DEEPSEEK_API_KEY`；如果只登录了 DeepSeek 账号、没有配置 API key，较新的 DSH 会自动使用账号登录态。
- 未配置凭据时挂件仍会加载，但余额/今日已用等数据会显示为空或 `—`，不会影响 DSH 本身。
- 插件面向 DSH Desktop；Web 模式也可以安装，但桌面端请用宿主内置的 `plugin_manager`。

## 安装

### 官方桌面端（推荐）

桌面端读取的是 `desktop` profile。`dsh plugin` 命令**按设计拒绝**直接操作 `desktop` profile，所以不要在桌面端照搬下面的 `--profile web` 命令。

在桌面端会话里使用宿主内置的 `plugin_manager`：

```text
请使用当前桌面端内置的 plugin_manager 安装 dsh-whale-compact。
先核对当前 profile 与是否已有同名插件；已有安装时先报告来源和版本。
按该工具支持的操作完成后告诉我安装结果，以及是否需要完全退出客户端再重开。
```

也可以把本仓库克隆到固定目录后，用 plugin_manager 的本地链接安装方式指定该目录。首次安装后如果界面没有出现，请完全退出 DSH（含托盘）再重新打开。

### DSH Web

```powershell
dsh plugin --profile web add github:Cdkgfp/dsh-whale-compact
```

安装后重启 `dsh web`，再按 `Ctrl+F5` 刷新页面。

### 本地开发安装

```powershell
git clone https://github.com/Cdkgfp/dsh-whale-compact.git
cd dsh-whale-compact
dsh plugin --profile web add link:.
```

`link:` 是软链接安装，源码目录改动会立即读取；移动目录后需要重新安装。

> 桌面端请使用 `plugin_manager`，不要执行 `dsh plugin --profile desktop ...`，也不要手工修改桌面端托管的 profile 文件。

## 兼容性

- 开发与测试环境：DSH Desktop `0.2.1-rc.3`（Electron 桌面客户端）。
- 插件结构是标准 DSH bundle 包；宿主 API 变化时可能需要跟随适配。
- 前端 `assets/whale-widget.js` 由宿主按 mtime 热读取；修改前端后刷新页面即可，修改宿主 `lib/index.js` 需要重启 DSH。

## 目录结构

```text
dsh-whale-compact/
├── package.json              # DSH bundle 插件元数据
├── cordis.patch.yml          # 插件挂载声明
├── icon.png                  # 插件图标
├── lib/
│   ├── index.js              # 宿主侧：路由、记账、音效/图片/角色服务
│   └── accounting.mjs        # 记账内核
├── assets/
│   ├── whale-widget.js       # 前端挂件本体
│   ├── DSniang1.png          # 小鲸鱼本体
│   └── ...                   # 内置音效、动图、展示图
├── README.md
├── LICENSE
├── PROVENANCE.md             # 素材来源与许可范围
└── CONTRIBUTING.md
```

运行时数据默认位于 `$DSH_HOME`（通常是 `~/.dsh`）：

| 文件 | 用途 |
|---|---|
| `.dshw-size.json` | 外观、音量、音效组、吸附等设置 |
| `.dshw-usage.json` | 记账账本与用量设置 |
| `.dshw-bubble.json` | 自动提示泡泡配置与模块库 |
| `.dshw-turn.json` | 每轮消耗序号 |
| `whale-roles/` | 自定义角色图 |
| `whale-audio/` | 音频片段与音效组 |
| `whale-bubble-imgs/` | 泡泡图片库 |

这些是运行时数据，已加入 `.gitignore`，不会提交到仓库。

## 数据与隐私

- 插件通过 DSH 的凭据服务读取余额，不在自己的配置文件中保存 API 密钥。
- 记账、角色图、泡泡图、音频片段均保存在本机。
- 插件只请求余额/用量所需的接口；不会把本地账本、聊天内容或凭据上传到本仓库或第三方。
- 公开 issue 时请勿附带 API key、完整凭据、未脱敏日志或包含个人路径的截图。

## 开发

```powershell
# 语法检查（使用 DSH 自带 Node）
node --check lib/index.js
node --check assets/whale-widget.js

# 前端改动后刷新页面；宿主改动后重启 DSH
```

代码结构说明：

- `lib/index.js`：宿主路由（`/dsh-whale/*`）、记账、音效/图片/角色文件服务。
- `lib/accounting.mjs`：金额定点运算与余额观测/校正。
- `assets/whale-widget.js`：前端 UI、紧凑信息栏、设置页和自动泡泡引擎。

## 许可

- **代码**（`lib/`、`cordis.patch.yml`、`package.json`、文档等）：MIT，见 [LICENSE](LICENSE)。
- **美术素材与音频**（`assets/**`、`icon.png`）：不适用 MIT，按 [PROVENANCE.md](PROVENANCE.md) 的说明原样提供。
- 本仓库是上游项目的分支；上游代码与素材的版权归其原作者及贡献者所有，详见 README 与 [LICENSE](LICENSE)。

## 致谢

- 上游项目：[DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)，作者 **MeteorNOX / 月匠** 及所有贡献者。
- 本分支的紧凑信息栏、内联设置页与自动泡泡调整基于上游代码继续开发。
