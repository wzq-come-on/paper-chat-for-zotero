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

## 兼容实现

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
