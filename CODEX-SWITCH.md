# Paper Chat — Codex Switch 本地代理版

基于 [syt2/paper-chat-for-zotero](https://github.com/syt2/paper-chat-for-zotero)
3.7.0 二次开发，保留原项目的 AGPL-3.0-or-later 许可与作者署名。

## 安装及使用

1. 下载本仓库发布的 XPI，在 Zotero 的「工具 → 插件 → 齿轮 → 从文件安装」安装。
2. 打开「设置 → Paper Chat」，选择新增的 **Codex Switch** 提供商。
3. 地址填写 `http://127.0.0.1:15722/v1`，保持 Codex Switch 本地代理运行。
4. 同机访问可留空 API Key；跨电脑访问填写你在 Switch 中创建的局域网 Key。
5. 点击「刷新」，从真实返回的列表选择模型，例如 `gpt-6.1-sol`。不要手写显示名称。
6. 点击「测试连接」。测试会获取模型并实际生成一条简短回答。
7. 将页面底部「当前使用的提供商」切换为 **Codex Switch**。
8. 打开 PDF，在 Paper Chat 中提问；选中文本后使用划词翻译。

已有自定义提供商也可以将「接口协议」切换为 **Codex Switch**。
普通 OpenAI 兼容服务保留 Chat Completions，支持 Responses 的普通服务可选 OpenAI Responses。
「客户端版本」用于模型列表请求，默认 `0.159.1`，遇到服务端版本要求时可在设置中修改。

未单独指定代理账号时，请在 Switch 的「账户管理 → 官方账户 → 当前账户」选择有额度的账号。
聊天窗口里的「GUI 账户」是独立选择，切换它不一定会切换本地代理使用的账号。

此版本沿用原插件 ID 与偏好设置，因此安装后替换原版、保留聊天数据及服务商配置。
升级不会自动切换当前提供商。回退时重新安装原版 XPI 即可。
保留 Zotero 必填的更新地址，指向本 fork 的 updates.json；原版插件内的自行更新已关闭，后续更新由本 fork 提供。

## 语音输入（3.7.8）

3.7.8 同样为原生听写 app-server 提供错误输出管道，修复普通桌面启动 Zotero
后转写阶段的 `File closed`。语音错误现在保留 Firefox 工作线程返回的消息和
错误码，避免显示 `[object Object]`；升级后请正常重启 Zotero。

3.7.7 修复 Windows 图形界面启动 Zotero 时录音组件提前退出的问题。
PowerShell 的错误输出现在通过独立管道接收，并关闭 Windows Runtime 初始化的进度输出。
不再把组件启动失败笼统提示成设备被占用；升级后请正常重启 Zotero。

3.7.6 修复了 3.7.5 在 Zotero 插件脚本环境中初始化语音失败，导致模型选择和发送事件未绑定的问题。
语音所需的 Web API 构造器从 Zotero 窗口获取；语音初始化异常也不会中断文字聊天。
从 3.7.5 升级后请正常重启 Zotero，让已经加载的旧插件代码退出。

「设置 → Paper Chat → 语音输入」默认选择 **Codex 原生听写（复用登录账号）**。
保持 Switch 默认 Codex Home 的 ChatGPT 登录有效；不需要额外 API Key，也不需要本地识别模型。
点击输入框旁的麦克风开始录音，再点击停止并转写。结果仅填入草稿，由用户编辑后发送。
录音最长 2 分钟；也可选择本地 Whisper 服务或自定义远程语音 API。

Windows 使用随插件提供的轻量系统录音组件，解决 Zotero 10 的
`getUserMedia` 设备初始化失败。组件仅在点击麦克风后启动，检查 Windows
原生麦克风许可，不改变系统权限；停止或关闭面板后退出并清理临时录音。
无需安装录音软件或下载识别模型。其他平台仍使用运行环境的 MediaRecorder。

原生听写使用官方桌面端的账号认证与 `/backend-api/transcribe` 路径。
插件临时启动已安装的 app-server，通过 `getAuthStatus` 取认证并通过 `account/read` 取得工作区路由；
访问令牌仅在内存中使用，退出后关闭子进程。网络设置沿用 Switch，并只应用到听写请求。
Switch 数据目录通常自动检测，安装目录自定义时可在语音设置中指定。
此模式使用 Switch 默认 Codex Home 的登录，GUI 会话独立选择的账号不改变这个登录。
桌面端内部路由可能随官方版本变化，需要随版本维护。

## 文字兼容实现

- `/models?client_version=...`：适配 Codex 的 `models[].slug`，也兼容标准 `data[].id`。
- `/responses`：将插件现有对话、图片和工具调用转换为 Responses 协议。
- 使用 `stream: true`、`store: false`；非流式调用者也从 SSE 汇总结果。
- 不发送上游不支持的温度及输出 token 上限，因此这些设置在 Codex 模式中禁用。
- 保留逐项完成事件中的工具 ID、message phase 和加密 reasoning，支持工具后续调用。
- 对话状态按提供商、地址、模型、会话隔离；划词翻译使用独立上下文。
- 测试连接展示实际错误，而不只显示「连接失败」。

请求使用 **Codex Switch 当前账号的额度**；本插件不会让上游调用免费或绕过额度。
如果出现 `usage_limit_reached` / `workspace_member_credits_depleted` / 429，
请在 Switch 更换有额度的账号或等待重置。502 通常需要排查 Switch 到上游的网络连接。
本地代理的账号和路由规则仍由 Switch 管理。

## 开发及验证

推荐 Node.js 22.8+：

```sh
npm ci
npm run typecheck
npm run test:codex
npm run build
```

Windows 发布构建：

```powershell
$env:NODE_ENV = 'production'
npx zotero-plugin build
npm run typecheck
```

真实本地代理测试（会消耗少量当前账号额度，仅发送合成测试文本）：

```sh
npm run test:codex:live
```

可使用 `CODEX_LOCAL_BASE_URL`、`CODEX_LOCAL_MODEL`、`CODEX_LOCAL_KEY` 环境变量覆盖地址、模型和密钥。
脚本检查模型发现、真实生成、中文流式翻译、工具调用、工具结果回传及多轮上下文。
测试无需论文库数据，不会把密钥写入源码或 XPI。

原版某些功能有自己的服务要求（如 PPT），不在此次本地代理适配范围内。
