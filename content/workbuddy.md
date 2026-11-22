在 WorkBuddy 桌面端接入 LinkAPI，配置自定义模型并完成首次对话。

<!-- anchors: 如需技术支持请添加技术微信我们将及时响应 -->

::: support 微信技术支持

扫码添加微信，咨询安装与接入问题。点击二维码可放大查看。

![LinkAPI 微信技术支持二维码](/uploads/2026/11/agent-wechat-2882b502fd.webp)

:::

[官方下载](https://www.workbuddy.cn/) · [创建 API Key](https://ai.ailink1.com/keys) · [查看可用模型](https://docs.ailink1.com/models)

<!-- anchors: 1-准备-linkapi-账号与密钥 -->

## 1. 准备 LinkAPI 密钥

准备好以下两项，再开始配置：

- **API Key**：在 [LinkAPI 控制台](https://ai.ailink1.com/keys)创建并复制密钥，确认对应订阅有效或余额充足。
- **模型 ID**：必须从[模型广场](https://docs.ailink1.com/models)按自己的订阅分组和账号池获取，步骤如下。

### 获取自己订阅的模型 ID

1. 打开 [LinkAPI 模型广场](https://docs.ailink1.com/models)，选择 **订阅**。
2. 在顶部的 **分组** 下拉框中，选择自己已开通、且与 API Key 对应的订阅分组；不要停留在 **全部分组**。不确定订阅名称时，先到 LinkAPI 控制台的 **我的订阅** 中确认。
3. 选择 **模型厂商**；出现 **账号池** 选项时，再选择准备使用的账号池。一卡通订阅也按这个顺序筛选。
4. 在筛选后的列表中找到目标模型，点击模型 ID 右侧的 **复制图标**。
5. 返回本教程的模型配置页面，将复制的完整内容粘贴到 **模型名称**，保留原有大小写和版本后缀。

**以自己订阅分组和账号池下的列表为准，截图中的模型仅作示例。**

余额用户将付费方式切换为 **余额**，选择 API Key 对应的分组后，同样复制模型 ID。

::: details 首次使用：开通订阅与创建密钥

1. 登录 [LinkAPI 控制台](https://ai.ailink1.com)，首次使用先注册账号。
2. 开通所需订阅或充值余额；如有兑换码，在 **兑换** 页面完成兑换，并在 **我的订阅** 中确认订阅状态。
3. 打开 **API 密钥**，点击 **创建密钥**，填写便于识别的名称，并选择包含目标模型的分组。
4. 保存后，点击密钥旁的复制按钮，复制完整 API Key。

![在 LinkAPI API 密钥列表中复制密钥](/uploads/2026/11/harness-linkapi-key-2b5fd1624f.webp)

*图中分组为示例，请选择自己已开通、且包含目标模型的分组。*

:::

<!-- anchors: 2-安装-workbuddy -->

## 2. 安装桌面端

打开 [WorkBuddy 官方下载页](https://www.workbuddy.cn/)，选择与你的操作系统匹配的桌面版本，安装后启动应用。

![WorkBuddy 官方下载页与系统选择](/uploads/2026/11/workbuddy-download-a8e1e44600.webp)

*在下载菜单中选择与你的电脑匹配的版本。*

<!-- anchors: 3-在-workbuddy-添加模型 -->

## 3. 配置自定义模型

### 打开模型配置

点击 **新建任务**，再点击输入框右下角的模型名称，选择 **配置自定义模型**。在配置界面添加一个模型；已有模型可直接编辑。

::: details 查看自定义模型的入口

![WorkBuddy 模型选择器中的配置自定义模型入口](/uploads/2026/11/workbuddy-model-menu-beb06cd4e4.webp)

:::

### 填写连接信息

按下表填写供应商、密钥和模型名称：

| 配置项 | 填写内容 |
| --- | --- |
| 供应商 | **自定义 / Custom** |
| API Key | LinkAPI API Key |
| 模型名称 | 从[模型广场](https://docs.ailink1.com/models)按自己的订阅分组和账号池复制的完整模型 ID |

**接口地址**填写以下完整地址，可直接复制：

```text
https://ai.ailink1.com/v1/chat/completions
```

![WorkBuddy 自定义模型的接口地址、API Key 与模型名称](/uploads/2026/11/workbuddy-model-form-b47d2d59e2.webp)

*图中模型仅作填写示例。实际模型名称须与密钥对应分组中的 ID 完全一致。*

## 4. 核对模型参数

展开 **高级配置**，按所选模型的实际能力设置：

- **工具调用**：需要模型执行任务、调用工具时，确认模型支持工具调用并开启此项。
- **图片输入**：仅为支持图片的模型开启。
- **思考模式与思考强度**：仅启用模型支持的模式和档位；不确定时先保留默认设置。
- **输入 / 输出**：填写模型支持的上下文与最大输出上限，单位为 token。
- **自定义协议**：使用本教程的标准接口地址时，保持关闭。

![WorkBuddy 的工具调用、图片输入、思考模式及输入输出参数](/uploads/2026/11/workbuddy-model-options-9a7ff893bb.webp)

*图中能力开关、思考档位与容量数值仅作界面示例，请按所选模型填写。*

::: tip 先验证，再调整

先用一个模型完成连接测试和纯文本对话，再调整思考强度、输入输出上限等高级参数。切换模型时，需要重新核对这些设置。

:::

<!-- anchors: 5-modelsjson-配置示例 -->

::: details 高级：models.json 配置示例

日常使用优先通过界面配置。需要检查本地配置时，Windows 路径为 `%USERPROFILE%\.workbuddy\models.json`。

以下沿用 `gpt-6-astra` 的字段示例。使用前替换 `apiKey`；使用其他模型时，同步修改 `id`、`name`、能力开关、思考档位和输入输出上限。已有配置文件请先备份，并保留其他模型条目。

```json
[
  {
    "id": "gpt-6-astra",
    "name": "gpt-6-astra",
    "vendor": "Custom",
    "url": "https://ai.ailink1.com/v1/chat/completions",
    "apiKey": "YOUR_LINKAPI_API_KEY",
    "supportsToolCall": true,
    "supportsImages": true,
    "supportsReasoning": true,
    "useCustomProtocol": false,
    "reasoning": { "supportedEfforts": ["low", "medium", "high", "max"] },
    "maxInputTokens": 262144,
    "maxOutputTokens": 65536
  }
]
```

:::

## 5. 验证连接

1. 在模型配置中点击 **测试连接**。
2. 显示 **连接成功** 后，点击 **保存**。
3. 回到任务页，在输入框右下角选择刚添加的自定义模型。
4. 发送以下测试消息：

```text
你好，请只回复：连接成功。
```

收到正常回复，且没有鉴权、模型或参数错误，即表示接入完成。

::: details 查看“测试连接”成功的提示

![WorkBuddy 测试连接成功后保存模型设置](/uploads/2026/11/workbuddy-connection-test-f5d5b3379d.webp)

:::

![在 WorkBuddy 任务中使用已配置模型并收到正常回复](/uploads/2026/11/workbuddy-chat-aae52ac8f4.webp)

*更换模型或调整参数后，建议新建任务再测试。*

<!-- anchors: 4-连接失败时 -->

## 常见问题

::: details 测试连接失败，或提示 401、无效密钥

核对接口地址为 `https://ai.ailink1.com/v1/chat/completions`，重新复制完整 API Key，检查密钥是否已被停用，以及粘贴时是否带入多余空格。

:::

::: details 提示模型不存在、不可用或无权限

在[模型广场](https://docs.ailink1.com/models)选择自己的订阅分组和账号池，重新复制模型 ID，确认密钥所选分组包含该模型。订阅用户检查订阅和额度；余额用户检查账户余额。

:::

::: details 模型在选择器中置灰，无法选中

进入该模型的配置页面，补全接口地址和 API Key 后保存，再回到任务页选择模型。

:::

::: details 连接测试通过，但发送消息时报参数错误

检查输入输出上限、思考模式和思考强度是否受模型支持。先关闭自行添加的可选设置，用纯文本消息重新测试；仍失败时，保留具体错误提示并联系技术支持。

:::

::: details 普通对话正常，但无法处理图片或执行工具

确认模型本身支持相应能力，再检查 **高级配置** 中的 **图片输入** 或 **工具调用** 是否开启。涉及本地文件的任务，同时检查是否已选择正确的工作目录并授予所需权限。

:::

需要技术支持时，请使用页面开头的微信二维码，并提供系统版本、WorkBuddy 版本、模型 ID 和错误截图。截图前请遮住完整 API Key。

更多模型设置可参阅 [WorkBuddy 官方模型配置说明](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Model)。
