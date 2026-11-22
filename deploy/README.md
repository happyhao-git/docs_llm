# 144 部署说明

应用代码通过 Git 同步，`.env`、教程 MySQL、模型快照、Sub2API 数据和上传文件留在各服务器本地。

144 首次部署需要：

1. 在 `/opt/llm/docs_llm/.env` 配置 ailink1 域名、独立 MySQL 和 Sub2API 数据源。
2. 启动 `docs-llm`，让应用完成数据库迁移和管理员初始化。
3. 执行 `npm run seed:content`，只初始化一次教程草稿与发布版本。
4. 安装 `deploy/nginx/docs.ailink1.com.conf` 并 reload Nginx。
5. 在 `ai.ailink1.com` 的 CSP `frame-src` 中放行 `https://docs.ailink1.com`。

后续更新只需在 144 执行 Git pull、构建并重启 `docs-llm`；不要复制 `.env`、数据库或上传目录。
