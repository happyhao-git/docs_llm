使用一卡通或对应余额分组，接入 Grok、Claude、Kimi、GLM、DeepSeek 等模型。

::: support 微信技术支持

![技术支持二维码](/uploads/2026/07/2ed7a6b6-27b8-414b-a83b-f41a151df589.jpg?v=ailink1)
:::

<!-- anchors: grok-cluade-kimiglmdeepseek | 一获取密钥 | 开始前准备 | 1-获取密钥与模型名称 | 3-验证第一次请求 | 返回-401-或-403 | 返回-404-或请求路径错误 | 模型不存在或模型列表没变化 -->

## 1. 获取密钥

打开 [AiLink 密钥](https://ai.ailink1.com/keys)，创建密钥并选择 **一卡通** 或对应平台的余额分组，保存后复制密钥。

## 2. 接入 OpenAI 兼容工具

在支持自定义服务商的工具中，填写：

| 字段 | 内容 |
| --- | --- |
| API Base URL | `https://ai.ailink1.com/v1` |
| API Key | 你的完整 API Key |
| Model | 控制台中的精确模型名称 |
| 完整请求地址 | `https://ai.ailink1.com/v1/chat/completions` |

工具要求 **基础地址** 时填到 `/v1`；要求 **完整请求地址** 时填最后一行，避免重复拼接路径。保存后发送一条简单消息验证。

<!-- anchors: 安装claude-code-插件 | 二打开-claude-code-配置文件 | 三写入配置 | 四重启-vs-code | 六使用-claude-code-客户端 | 可选通过-claude-code-使用 | 配置基础连接 -->

## 3. VS Code / CLI：配置 Claude Code

本节的 `settings.json` 用于 **Claude Code 插件或 CLI**。Claude 桌面客户端请查看 [Windows 教程](/docs/windows-install-claude) 或 [Mac 教程](/docs/mac-install-claude) 中的网关配置。

### 安装插件并打开配置文件

在 VS Code 扩展商店搜索并安装 Anthropic 发布的 **Claude Code**。已有 CLI 可直接配置。

- Windows：在文件资源管理器地址栏输入 `%USERPROFILE%\.claude`，打开或创建 `settings.json`。
- Mac / Linux：配置文件为 `~/.claude/settings.json`。

已有文件先备份；Windows 文件名不能带 `.txt`。

### 写入完整配置

将 `在此粘贴你的密钥` 替换为完整 API Key，粘贴以下配置并保存：

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "在此粘贴你的密钥",
    "ANTHROPIC_BASE_URL": "https://ai.ailink1.com"
  },
  "effortLevel": "xhigh",
  "modelPicker": {
    "replaceBuiltInOptions": true,
    "options": [
      {
        "model": "grok-4.7"
      },
      {
        "model": "grok-4.6"
      },
      {
        "model": "grok-4.5"
      },
      {
        "model": "kimi-k3"
      },
      {
        "model": "glm-5.3"
      },
      {
        "model": "deepseek-v4.1-flash"
      },
      {
        "model": "deepseek-v4-pro"
      },
      {
        "model": "claude-fable-5"
      },
      {
        "model": "claude-opus-5-5"
      },
      {
        "model": "claude-opus-5"
      },
      {
        "model": "claude-opus-4-8"
      },
      {
        "model": "claude-opus-4-7"
      },
      {
        "model": "claude-opus-4-6"
      },
      {
        "model": "claude-sonnet-5"
      },
      {
        "model": "claude-sonnet-4-7"
      },
      {
        "model": "claude-sonnet-4-6"
      }
    ]
  }
}
```

### 重启并选择模型

完全退出并重新打开 VS Code，启动 Claude Code，在模型选择器中选择当前分组支持的模型，例如 `grok-4.6`，发送一条消息验证。

<!-- anchors: 五添加其他模型 -->

## 4. 添加模型与 CLI 配置

在 `modelPicker.options` 数组中增加 `{ "model": "精确模型名称" }`，对象之间用逗号分隔。模型名称须与控制台一致。

CLI 可通过 `cc-switch` 配置模型映射，保存后重启 Claude Code CLI。

<!-- anchors: 修改配置后模型没有生效 | 能聊天但工具调用或图片输入失败 -->

## 常见问题

### 返回 401、403 或模型不可用

检查密钥、账户分组、余额或订阅状态，以及模型名称。

### 返回 404

检查基础地址和完整接口地址是否填反，排除重复的 `/v1` 或 `/chat/completions`。

### 修改配置没有生效

确认已保存 `settings.json` 并重启；检查 JSON 标点、文件路径和模型权限。模型列表仍未变化时，提供客户端版本和错误信息联系技术支持。
