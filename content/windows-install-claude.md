在 Windows 上安装 Claude 桌面客户端并连接 AiLink，同时配置 VS Code 插件与 Claude Code CLI。

## 如需技术支持，请添加技术微信，我们将及时响应。

::: support 微信技术支持

![技术支持二维码](/uploads/2026/07/2ed7a6b6-27b8-414b-a83b-f41a151df589.jpg?v=ailink1)
:::

## 1. 准备AiLink账号与密钥

### 注册并开通订阅

打开 [AiLink 控制台](https://ai.ailink1.com)，使用邮箱注册并登录。

![AiLink 注册页面](/uploads/2026/07/9460a5ae-6967-41d6-a5af-8e6976a048f4.png?v=ailink1)

有兑换码：进入 **兑换** 页面提交，再到 **我的订阅** 确认生效。已开通订阅可跳过兑换。

![兑换码与我的订阅](/uploads/2026/07/1ac77e33-d056-47fe-99ee-cabff36e8ad6.png?v=ailink1)

### 创建并复制密钥

打开 [API 密钥](https://ai.ailink1.com/keys)，点击 **创建密钥**。

![AiLink 密钥页面](/uploads/2026/07/c8116ed5-721a-4939-8c05-bed8b3757ac4.png?v=ailink1)

选择订阅对应的 **Claude 分组**，保存后复制完整密钥。

![选择 Claude 密钥分组](/uploads/2026/07/f9f7cd68-802a-4ad1-b8aa-beb9221ab6db.png?v=ailink1)

<!-- anchors: 开始前准备 | 需要帮助时 | 下载并安装-claude | 提示-401403-或模型不可用 -->

## 2. 安装 Claude 桌面客户端

打开 [Claude 官网](https://claude.com/)，点击 **Download desktop app**。选择 Windows 安装包，下载后按安装向导操作。

![Claude 桌面客户端下载入口](/uploads/2026/07/af369d45-1824-4d00-b937-155d9ecf38a2.png?v=ailink1)

<!-- anchors: 1-注册平台账号 | 2-兑换订阅 | 获取-api-key | 1-打开密钥页面 | 2-选择订阅分组 | 1-准备账号与密钥 -->


<!-- anchors: 配置-claude-客户端 | 可选配置桌面客户端 -->

## 3. 配置 Claude 桌面客户端

<!-- anchors: 1-启用开发者模式 | 启用开发者菜单 -->

### 启用开发者模式

启动 Claude，暂时不要登录。点击客户端左上角的三条横线：

`Help → Troubleshooting → Enable Developer Mode`

![启用 Claude 开发者模式](/uploads/2026/07/4485f6d5-8c41-4fc4-9620-d3ebaac0d7b9.png?v=ailink1)

<!-- anchors: 2-打开第三方推理配置 -->

### 打开第三方推理配置

启用后，打开：

`Developer → Configure Third-Party Inference`

![打开第三方推理配置](/uploads/2026/07/9b58598e-0d9f-4f6a-bda0-035adf3e7139.png?v=ailink1)

<!-- anchors: 3-填写连接信息 -->

### 填写网关信息

在 **Connection** 页面按下表填写：

| 字段 | 内容 |
| --- | --- |
| Connection | `Gateway` |
| Credential kind | `Static API key` |
| Gateway base URL | `https://ai.ailink1.com` |
| Gateway API key | 你的完整 API Key |
| Gateway auth scheme | `bearer` |

![Claude 桌面端网关配置](/uploads/2026/07/b0793545-7d9b-4613-9ad1-90bb5dafa293.png?v=ailink1)

<!-- anchors: 4-检查并开始使用 | 4-验证连接与选择模型 -->

### 测试连接

点击 **Test connection**，通过后保存。返回聊天页面，发送一条简单消息；收到回答即配置完成。

![Claude 桌面客户端对话页面](/uploads/2026/07/91950017-e89a-40ae-8430-5df7ebdc35d0.png?v=ailink1)

**只使用桌面客户端，到这里即可。**

<!-- anchors: 在-vs-code-中使用时 | 配置-vs-code-claude-code | 1-打开-windows-配置参考 | 2-打开-claude-文件夹 | 2-安装-claude-code -->

## 4. VS Code / CLI：配置 settings.json

**`settings.json` 用于 VS Code 中的 Claude Code 插件或 Claude Code CLI。**

### 安装 VS Code 插件

从 [VS Code 官网](https://code.visualstudio.com/) 安装编辑器。在扩展商店搜索 **Claude Code**，确认发布者为 **Anthropic** 后安装。CLI 用户跳过插件安装。

![安装 Claude Code 官方插件](/uploads/2026/07/9c430636-a626-4cad-9631-1fb5ba826db9.png?v=ailink1)

### 打开配置参考

在 AiLink 的 **API 密钥** 页面点击 **使用密钥**，选择 **Claude Code → Windows CMD**。

![Claude Code 的 Windows 配置窗口](/uploads/2026/07/dd03e04d-2162-4a25-b18e-5575e66db0d9.png?v=ailink1)

<!-- anchors: 3-创建-settingsjson | 3-配置-settingsjson | 打开配置目录并备份 | 填入连接信息 -->

### 创建 settings.json

1. 按 `Win + E`，在地址栏输入 `%USERPROFILE%\.claude`。目录不存在时，先创建 `.claude` 文件夹。
2. 在 **查看 → 显示** 中开启 **文件扩展名**。
3. 创建 `settings.json`，用记事本打开。已有文件先备份。

![Windows 的 .claude 配置目录](/uploads/2026/07/f6b4b900-a8f8-41c1-8541-dcf9f4a5f44d.png?v=ailink1)

将 `输入自己的密钥` 替换为完整 API Key，粘贴以下内容并保存：

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://ai.ailink1.com",
    "ANTHROPIC_AUTH_TOKEN": "输入自己的密钥",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    "CLAUDE_CODE_ATTRIBUTION_HEADER": "0"
  }
}
```

另存为时选择 **所有文件**、**UTF-8**，文件名为 `settings.json`，不能带 `.txt`。

### 重启并验证

重启 VS Code，打开 Claude Code 面板并发送一条消息。CLI 用户退出后重新运行 `claude`，再发送消息。

<!-- anchors: 使用-claude-与切换模型 -->

## 5. Claude Code 切换模型

VS Code 插件中，打开命令菜单并选择 **Switch model**。图示入口为 `/switch`：

![Claude Code 的 Switch model 入口](/uploads/2026/07/108445fe-e32c-4bfc-b75c-b0e6152a67c0.png?v=ailink1)

选择当前订阅支持的模型：

![Claude Code 模型选择列表](/uploads/2026/07/95c44718-2e9f-402d-aa30-91e1c8d46196.png?v=ailink1)

CLI 输入 `/model` 切换模型。

<!-- anchors: vs-code-配置没有生效 | 可以打开但无法正常对话 | 配置文件没有生效 | test-connection-失败或没有-developer-菜单 | 可以打开界面却没有正常回答 -->

## 常见问题

### 看不到 Developer 菜单

先启用 **Help → Troubleshooting → Enable Developer Mode**，再重启客户端。仍无入口时，提供客户端版本和菜单截图联系技术支持。

### Test connection 失败

检查订阅状态、Claude 分组、完整密钥、网址 `https://ai.ailink1.com` 和认证方式 `bearer`。

### settings.json 没有生效

确认路径为 `%USERPROFILE%\.claude\settings.json`，且文件名不带 `.txt`。检查英文双引号和逗号，保存后重启 VS Code 或 CLI。
