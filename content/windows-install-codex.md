在 Windows 上安装 Codex 并连接 AiLink，完成桌面端、配置文件和 VS Code 插件设置。

## 如需技术支持，请添加技术微信，我们将及时响应。

::: support 微信技术支持

![技术支持二维码](/uploads/2026/07/2ed7a6b6-27b8-414b-a83b-f41a151df589.jpg)
:::

<!-- anchors: linkapi网站地址 | 技术联系方式 | 安装-codex | 方式一codex-客户端 | 3-打开-codex | 开始前准备 | 2-安装-codex | 桌面客户端 | 打开配置目录并备份 | 修改后如何恢复 -->

## 1. 准备AiLink账号与密钥

### 注册并开通订阅

打开 [AiLink 控制台](https://ai.ailink1.com)，使用邮箱注册并登录。

![AiLink 注册页面](/uploads/2026/07/9460a5ae-6967-41d6-a5af-8e6976a048f4.png)

有兑换码：进入 **兑换** 页面提交，再到 **我的订阅** 确认生效。已开通订阅可跳过兑换。

![兑换码与我的订阅](/uploads/2026/07/1ac77e33-d056-47fe-99ee-cabff36e8ad6.png)

### 创建并复制密钥

打开 [API 密钥](https://ai.ailink1.com/keys)，点击 **创建密钥**。

![AiLink 密钥页面](/uploads/2026/07/c8116ed5-721a-4939-8c05-bed8b3757ac4.png)

选择订阅对应的 **Codex 分组**，保存后复制完整密钥。

![创建密钥](/uploads/2026/11/1f1e9344-c800-41ca-a3b9-4036578c5f73.png)

点击密钥右侧的 **使用密钥**，查看 Codex 配置。

![打开使用密钥窗口](/uploads/2026/07/46fff324-4e1b-4f5f-8ebf-a43733f7c040.png)

<!-- anchors: 配置-codex | 1-打开配置目录 -->

## 2. 安装 Codex 桌面客户端

打开 [Codex 官方页面](https://openai.com/zh-Hans-CN/codex/) 或 [Microsoft Store](https://apps.microsoft.com/detail/9plm9xgg6vks?hl=zh-CN&gl=CN)，下载并安装 Windows 版本。

![Codex Windows 下载入口](/uploads/2026/07/b836c8e1-c829-4ea1-b954-c5aafdbf8102.png)


## 3. 写入配置文件

### 打开配置目录

按 `Win + E`，在地址栏输入 `%USERPROFILE%\.codex`。目录不存在时，先创建 `.codex` 文件夹。

![Windows 的 .codex 配置目录](/uploads/2026/07/c74c2ecd-e68d-48db-b6a6-0ca19dd95e50.png)

开启 **查看 → 显示 → 文件扩展名**。已有 `config.toml` 或 `auth.json` 时先备份。

<!-- anchors: 2-创建-configtoml -->

### 创建 config.toml

在 `.codex` 中创建 `config.toml`，用记事本打开，粘贴以下内容并保存：

```toml
model_provider = "OpenAI"
model = "gpt-6.1-sol"
review_model = "gpt-6.1-sol"
model_reasoning_effort = "xhigh"
disable_response_storage = true
network_access = "enabled"
windows_wsl_setup_acknowledged = true
model_context_window = 400000
model_auto_compact_token_limit = 260000
conversationDetailMode = "STEPS_COMMANDS"

[model_providers.OpenAI]
name = "AiLink"
base_url = "https://ai.ailink1.com"
wire_api = "responses"
requires_openai_auth = true

[features]
goals = true
```

另存为时选择 **所有文件**、**UTF-8**，文件名不能带 `.txt`。

![Codex config.toml 配置参考](/uploads/2026/07/73eb8a04-a304-4edb-a633-2c31b1c8f72d.png)

*配置内容以代码为准。*

<!-- anchors: 3-创建-authjson -->

### 创建 auth.json

在同一目录创建 `auth.json`。将 `把这里替换成你的key` 替换为完整 API Key，粘贴并保存：

```json
{
  "OPENAI_API_KEY": "把这里替换成你的key"
}
```

![Codex auth.json 配置示例](/uploads/2026/07/06fa74fd-b31f-4c46-967f-4c009373dbe1.png)

<!-- anchors: 检查并开始使用 | 1-检查两个文件 | 2-重启并验证 | 4-验证并开始使用 -->

## 4. 重启并验证

重启 Codex，发送一条消息。收到回答即配置完成。

<!-- anchors: 方式二vs-code-插件 | 在-vs-code-中使用 | 1-安装-vs-code | 2-安装官方-codex-插件 | vs-code-插件 -->

## 5. 在 VS Code 中使用

从 [VS Code 官网](https://code.visualstudio.com/) 安装编辑器。在扩展商店搜索 **Codex**，确认发布者为 **OpenAI** 后安装。

![安装 OpenAI Codex 插件](/uploads/2026/07/de118cae-0467-49a5-98d0-7b47308be787.png)

完成上面的配置后，重启 VS Code，点击 Codex 图标并新建对话。

![VS Code 中的 Codex 面板](/uploads/2026/07/3ce06a3c-aec8-4296-82e9-f65cc50aca25.png)

<!-- anchors: 仍然提示登录或找不到密钥 | 对话压缩失败或长对话报错 -->

## 常见问题

### 配置没有生效

检查文件路径、`.txt` 后缀和英文标点；保存后重启客户端。WSL 或远程开发时，配置应放在实际运行 Codex 的环境中。

### 提示 401、403 或模型不可用

检查密钥是否完整、分组是否正确、订阅是否有效，以及模型是否在当前分组内。

### 长对话报错

新建对话重试；仍报错时，将错误信息和发生时间发给技术支持。
