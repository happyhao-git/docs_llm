在 OpenCode 中接入 AiLink，添加自定义模型并完成首次对话。

::: support 微信技术支持

扫码添加微信，咨询安装与接入问题。点击二维码可放大查看。

![AiLink 微信技术支持二维码](/uploads/2026/11/agent-wechat-2882b502fd.webp)

:::

[官方下载](https://opencode.ai/download) · [创建 API Key](https://ai.ailink1.com/keys) · [查看可用模型](https://docs.ailink1.com/models)

## 1. 准备密钥与模型 ID

在 [AiLink 控制台](https://ai.ailink1.com/keys)创建并复制 API Key，确认对应订阅有效或余额充足。

### 获取自己订阅的模型 ID

1. 打开[模型广场](https://docs.ailink1.com/models)，选择 **订阅**。
2. 选择自己已开通、且与 API Key 对应的 **分组**，不要停留在 **全部分组**。不确定时，到控制台的 **我的订阅** 中确认。
3. 选择 **模型厂商**；出现 **账号池** 时，再选择准备使用的账号池。一卡通订阅也按此顺序筛选。
4. 点击模型 ID 右侧的 **复制图标**，将完整内容填入下文配置的 **`id`**，保留大小写和版本后缀。

**可用模型以自己的分组和账号池为准，本文模型仅作配置示例。** 余额用户选择 **余额** 和 API Key 对应的分组后，同样复制模型 ID。

## 2. 安装并打开配置文件

从 [OpenCode 官网](https://opencode.ai/download)下载适合自己系统的桌面端，安装后启动。

### Windows

按 **Win + R**，粘贴以下路径并回车：

```text
%USERPROFILE%\.config
```

在其中打开或新建 `opencode` 文件夹，再打开或新建 `opencode.json`。完整路径为：

```text
%USERPROFILE%\.config\opencode\opencode.json
```

使用记事本保存时，文件类型选 **所有文件**，编码选 **UTF-8**，确认没有多余的 `.txt` 后缀。

::: details macOS / Linux 或自定义配置目录

默认用户配置文件为：

```text
~/.config/opencode/opencode.json
```

macOS 可在 Finder 中按 **⌘ + Shift + G**，前往 `~/.config`，打开或新建 `opencode` 文件夹。

已安装命令行工具时，可用以下命令查看实际配置目录：

```bash
opencode debug paths
```

更多路径与覆盖规则见[官方配置说明](https://opencode.ai/docs/config/)。

:::

已有配置文件请先备份，添加 AiLink 时保留原有提供商、插件和 MCP 设置。

## 3. 添加 AiLink 模型

新建配置文件时，可复制下方完整内容。已有配置则合并相应字段，不要重复创建 `provider`。

| 配置项 | 填写内容 |
| --- | --- |
| `baseURL` | `https://ai.ailink1.com/v1` |
| `apiKey` | 替换为自己的 AiLink Key |
| `id` | 从[模型广场](https://docs.ailink1.com/models)按自己的分组和账号池复制 |
| `name` | 模型显示名称，建议与 `id` 一致 |

将 `YOUR_LINKAPI_API_KEY` 替换为自己的密钥，并核对两个模型的 `id`。本文统一使用 `provider`、`npm`、`options` 和 `id` 字段。

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "myapi/coder",
  "compaction": {
    "auto": true,
    "reserved": 140000
  },
  "provider": {
    "myapi": {
      "name": "AiLink",
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "https://ai.ailink1.com/v1",
        "apiKey": "YOUR_LINKAPI_API_KEY"
      },
      "models": {
        "coder": {
          "name": "gpt-6-astra",
          "id": "gpt-6-astra",
          "limit": { "context": 400000, "input": 400000, "output": 32000 }
        },
        "gpt-6.1-sol": {
          "name": "gpt-6.1-sol",
          "id": "gpt-6.1-sol",
          "limit": { "context": 400000, "input": 400000, "output": 32000 }
        }
      }
    }
  }
}
```

`myapi/coder` 对应默认模型 `gpt-6-astra`。其中 `coder` 是本地别名，**`id` 才是发送给 AiLink 的模型 ID**；更换模型时，同步修改对应条目的 `name` 和 `id`。

容量参数沿用示例设置：上下文和输入上限 **400,000 tokens**，输出上限 **32,000 tokens**。更换模型时，请按实际支持的容量调整。

保存文件后，完全退出并重新打开 OpenCode，再新建会话并选择模型。

## 4. 验证连接

1. 在桌面端的模型选择器中，选择 **AiLink** 下刚添加的模型。终端界面可输入 `/models` 选择。
2. 发送以下消息：

```text
请只回复：连接成功。
```

收到正常回复，即可开始使用。需要让 OpenCode 处理项目文件时，打开一个测试项目，再验证工具调用：

```text
请列出当前项目根目录的文件，只读取，不修改任何文件。
```

::: details 使用命令行测试

已安装命令行工具时，可在终端运行：

```bash
opencode run --model myapi/coder "请只回复：连接成功。"
```

测试第二款模型时，将 `myapi/coder` 换为 `myapi/gpt-6.1-sol`。每次运行都会发送一次模型请求。

:::

## 按需调整

::: details 切换默认模型或添加更多模型

示例默认使用 `myapi/coder`。如需默认使用第二款模型，将根级别的 `model` 改为：

```json
{
  "model": "myapi/gpt-6.1-sol"
}
```

添加模型时，在 `provider.myapi.models` 中复制一个模型条目，使用不同的条目名称，并填写对应的 `name`、`id` 和容量限制。

默认模型格式为 **提供商标识 / 模型条目名称**，需要与配置中的名称对应。已有会话保留原来的选择，请在模型选择器中手动切换；详见[官方模型设置](https://opencode.ai/docs/models/)。

:::

::: details 上下文容量与自动压缩

`compaction.auto` 开启自动压缩，`reserved` 设置预留 token 数。本示例的输入预算为 `400000`，预留 `140000`，对应约 **260,000 tokens** 的压缩阈值：

```text
400,000 − 140,000 = 260,000 tokens
```

- `reserved` 是预留空间，不是触发压缩的阈值；请填写整数 token 数。
- 自动压缩会将较早的对话整理为摘要，触发时机以实际 token 用量为准。
- `limit.output: 32000` 是输出上限，与上下文容量分别设置。

更换容量不同的模型时，需一并核对 `limit` 与 `reserved`。客户端配置不能扩大模型实际支持的容量。

:::

## 常见问题

::: details 配置保存后，列表中没有 AiLink 模型

确认文件位于正确的配置目录，名称为 `opencode.json`，API Key 已填写。JSON 必须使用英文双引号，检查逗号和括号是否完整。

若只有某个项目不生效，检查项目中的 `opencode.json`、`opencode.jsonc` 或 `.opencode` 配置是否覆盖了用户配置。

核对字段与本文示例一致：`provider`、`npm`、`options`、模型 `id` 及 `compaction.reserved`。保存后完全退出并重新打开 OpenCode。

:::

::: details 提示 401、无效密钥或无权限

重新复制完整 API Key，检查是否有多余空格、密钥是否停用，以及对应订阅或余额是否可用。

:::

::: details 提示模型不存在或不可用

返回[模型广场](https://docs.ailink1.com/models)，选择自己的分组、厂商和账号池，重新复制模型 ID 到 `id`。确认 API Key 对应分组包含该模型。

若 OpenCode 提示 `Model unavailable: myapi/…`，还需检查斜杠后的名称是否与 `models` 中的条目名称一致，例如 `coder`。

:::

::: details 接口报错，或提示不支持当前协议

确认 `baseURL` 为 `https://ai.ailink1.com/v1`，不要追加 `/chat/completions`。

核对 `npm` 为 `@ai-sdk/openai-compatible`，接口地址和密钥填写在 `options` 中。若仍提示协议不支持，请提供模型 ID 和完整错误截图联系技术支持。

:::

::: details 能聊天，但无法读取文件或提示上下文超限

- **无法读取文件**：确认模型支持工具调用，已打开正确的项目目录，并允许所需读取操作。
- **上下文超限**：按模型的实际限制调整 `limit` 与 `reserved`，必要时新建会话。

:::

需要帮助时，请使用页面开头的微信二维码，提供系统版本、OpenCode 版本、模型 ID 和错误截图，并遮住完整 API Key。
