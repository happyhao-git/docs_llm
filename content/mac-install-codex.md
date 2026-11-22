在 Mac 或 Linux 上安装 Codex 并连接 AiLink，完成配置文件、密钥和 VS Code 插件设置。

## 如需技术支持，请添加技术微信，我们将及时响应。

::: support 微信技术支持

![技术支持二维码](/uploads/2026/07/2ed7a6b6-27b8-414b-a83b-f41a151df589.jpg?v=ailink1)
:::

<!-- anchors: 1-注册平台账号 | 2-兑换订阅 | 获取-api-key | 1-打开密钥页面 | 2-选择订阅分组 | 3-复制密钥 | 1-准备账号与密钥 -->

## 1. 准备AiLink账号与密钥

### 注册并开通订阅

打开 [AiLink 控制台](https://ai.ailink1.com)，使用邮箱注册并登录。

![AiLink 注册页面](/uploads/2026/07/9460a5ae-6967-41d6-a5af-8e6976a048f4.png?v=ailink1)

有兑换码：进入 **兑换** 页面提交，再到 **我的订阅** 确认生效。已开通订阅可跳过兑换。

![兑换码与我的订阅](/uploads/2026/07/1ac77e33-d056-47fe-99ee-cabff36e8ad6.png?v=ailink1)

### 创建并复制密钥

打开 [API 密钥](https://ai.ailink1.com/keys)，点击 **创建密钥**。

![AiLink 密钥页面](/uploads/2026/07/c8116ed5-721a-4939-8c05-bed8b3757ac4.png?v=ailink1)

选择订阅对应的 **Codex 分组**，保存后复制完整密钥。

![创建密钥](/uploads/2026/11/1f1e9344-c800-41ca-a3b9-4036578c5f73.png?v=ailink1)


点击密钥旁的复制按钮，复制完整 API Key。

![复制 AiLink Key](/uploads/2026/07/65fc041f-ed8f-43a6-bba4-9ed72378e901.png?v=ailink1)

<!-- anchors: 配置-codexchatgpt | 1-打开终端 | 3-备份并写入配置 | 备份原文件 -->

<!-- anchors: linkapi网站地址 | 技术联系方式 | 安装-codex | 延伸阅读 | 开始前准备 | macos选择桌面客户端或-cli | 修改后如何恢复 -->

## 2. 安装 Codex

### Mac 桌面客户端

打开 [Codex 官方页面](https://openai.com/zh-Hans-CN/codex/)，下载并安装 macOS 版本。

<!-- anchors: linux-macos安装-cli -->

### Linux / macOS CLI

打开终端，执行 [官方 CLI 安装命令](https://developers.openai.com/codex/cli/)：

```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh
```

安装后运行 `codex --version`，看到版本号再继续。

## 3. 写入配置文件

### 打开终端

Mac：按 `Command + 空格`，搜索并打开 **终端**。Linux：打开系统终端。

默认目录为 `~/.codex`；设置过 `CODEX_HOME` 时，下面命令会使用该目录。已有配置请先备份。

<!-- anchors: 2-写入-configtoml -->

### 写入 config.toml

整段复制到终端，按回车执行：

```bash
codex_dir="${CODEX_HOME:-$HOME/.codex}"
mkdir -p "$codex_dir"
cat > "$codex_dir/config.toml" <<'EOF'
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
EOF
```

![Mac Codex config.toml 配置结果](/uploads/2026/07/98d8cf44-f450-43ae-b6b7-edbaf1eab968.png?v=ailink1)

![Codex 配置字段参考](/uploads/2026/07/73eb8a04-a304-4edb-a633-2c31b1c8f72d.png?v=ailink1)

*配置内容以代码为准。*

<!-- anchors: 3-写入-api-key | 在本机编辑-authjson -->

### 写入 auth.json

将 `把这里替换成你的key` 替换为完整 API Key，整段复制到终端，按回车执行：

```bash
codex_dir="${CODEX_HOME:-$HOME/.codex}"
mkdir -p "$codex_dir"
cat > "$codex_dir/auth.json" <<'EOF'
{
  "OPENAI_API_KEY": "把这里替换成你的key"
}
EOF
chmod 600 "$codex_dir/auth.json"
```

<!-- anchors: 检查并开始使用 | 1-检查配置 | 2-重启并验证 | 4-检查并发起第一次对话 -->

## 4. 检查并开始使用

在同一终端执行以下命令：

```bash
grep -E '^(model_provider|model|review_model|model_reasoning_effort)' "$codex_dir/config.toml"
test -s "$codex_dir/auth.json" && echo "auth.json 已写入"
```

确认 `model_provider` 为 `"OpenAI"`，并显示 `auth.json 已写入`。

重启 Codex 后发送一条简单消息；CLI 用户在项目目录运行 `codex`。收到回答即配置完成。

<!-- anchors: 对话压缩失败 | 仍然无法对话 | 仍然提示登录或找不到密钥 | 对话压缩失败或长对话报错 -->

## 常见问题

### 配置没有生效

确认两个文件在同一配置目录，密钥已替换，保存后已重启。远程开发时，配置应放在实际运行 Codex 的环境中。

### 提示 401、403 或模型不可用

检查密钥、分组、订阅状态和模型名称。

### 长对话报错

新建对话重试；仍报错时，将错误信息和发生时间发给技术支持。

### 恢复原配置

退出 Codex，将备份的 `config.toml` 和 `auth.json` 放回原目录，再重新打开。
