# 模型广场维护

公开页面为 `/models`，管理入口为 `/admin/models`。教程首页和文章地址不变。

## 数据与部署

模型目录由文档服务独立读取 Sub2API PostgreSQL 和本机价格文件。数据库连接设置 `default_transaction_read_only=on`，每次同步使用只读、可重复读事务，只选取模型映射字段，不读取上游密钥。同步不会调用模型或修改 Sub2API。

可通过 `SUB2API_DATABASE_URL` 配置独立只读账号；未设置时，从 `SUB2API_DEPLOY_ENV_PATH` 读取 PostgreSQL 连接参数。默认本机配置位置为 `/opt/llm/sub2api-deploy/.env`。价格文件由 `SUB2API_PRICING_PATH` 指定，默认 `/opt/llm/sub2api-deploy/data/model_pricing.json`。

Compose 已以只读方式挂载部署配置和价格目录。挂载目录而非单个价格文件，使上游原子替换文件后仍能读取新版本。路径可用 `SUB2API_DEPLOY_ENV_FILE`、`SUB2API_DATA_DIR` 调整。所有连接参数仅用于后端。

新增迁移 3 创建 `model_plaza_state`；原有教程表和发布版本不会被替换。服务启动加载最近成功快照，后台每五分钟同步一次。`MODEL_SYNC_ENABLED=false` 关闭自动同步，适用于隔离测试或运维；管理后台仍可手动同步。

公开 API 为 `GET /api/public/models`，支持 ETag。管理 API 为 `GET /api/admin/models`、`PUT /api/admin/models/settings`、`POST /api/admin/models/sync`，沿用管理员登录和 CSRF 校验。同步失败保留历史数据，公开页面标明旧数据；首次无快照返回 503。

## 公开范围

首次同步默认公开常规余额组和订阅组；测试、VIP、专属余额组隐藏。之后发现的新分组默认隐藏，需要在后台勾选公开。后台可修改展示名称、排序和优先选择。相同支持列表、计费及兑换规则的订阅档位合并；不同规则保留独立选择。

目录来自生效且可调度账号的明确模型映射，结合分组白名单、渠道限制及路由；忽略内部占位模型。目录反映配置支持范围，不是实时健康状态。基础价格表不能生成额外的支持模型。

## 价格口径

`人民币成本 = 计费基准 × 生效扣费倍率 × 每额度人民币成本`。

- 余额默认每额度 ¥0.20（¥1 / 5 额度）。
- OpenAI 独立订阅默认每额度 ¥0.02（¥2 / 100 额度）。
- 其他订阅及一卡通默认每额度 ¥0.03（¥3 / 100 额度）。

独立 OpenAI 的 `4 × 0.02 = 0.08` 与一卡通的 `2.667 × 0.03 = 0.08001` 在展示精度下接近，计算始终使用完整十进制数。系数表示计费基准数值到人民币的折算关系，不表示同币种的折扣。订阅按额度充分使用估算。

官方参考值与生效计费基准分开存储。渠道自定义价格、平台覆盖倍率、图片独立倍率及按张开关分别处理。默认展示标准模式，展开后查看来源中明确提供的长上下文与服务档价格；图片、视频和音频按各自单位显示。长上下文在自定义基础价上应用目录倍率，缓存读写跟随输入倍率；显式渠道区间优先于目录阶梯。服务档和长上下文可能叠加，明细中的服务档价格以基础上下文为准。公开参考价来自 Sub2API 文件，不承诺与官网实时一致。

价格文件没有的模型、无法可靠识别的内置回退价、多个冲突规则及尚未适配的特殊路由不会猜价，而是显示待确认；管理后台列出缺价提示。修改 Sub2API 的计费逻辑或升级其数据结构后，应使用实际账单核对适配器。

## 验证与回滚

运行 `npm run typecheck`、`npm test`、`npm run build`。数据库集成测试必须使用 `DB_NAME=docs_test`、`DB_PORT=13367` 的隔离库；Playwright 默认只访问 `127.0.0.1:8091`。模型端到端测试使用真实只读目录，覆盖价格、筛选、手机抽屉、深色模式、失败恢复和管理权限。

回滚应用镜像即可恢复旧文档版本；保留新增快照表不影响旧服务，不需要删除模型数据或恢复教程内容。

本次上线保留了 `linkapi-docs:before-models-20261104` 回滚镜像。当前 Compose 项目名为 `docs_llm`，需要回滚时执行：

```sh
docker tag linkapi-docs:before-models-20261104 docs_llm-docs-llm:latest
docker compose up -d --no-deps docs-llm
```

重新上线当前代码使用 `docker compose build docs-llm` 后再执行上述 `compose up`，无需操作 Sub2API 容器。
