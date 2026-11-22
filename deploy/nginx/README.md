# docs.ailink1.com

144 上 Nginx 容器使用主机网络。`docs.ailink1.com.conf` 处理 HTTP 验证、HTTPS 入口和到 `127.0.0.1:8090` 的反向代理。HTTP 入口也直接代理应用，以兼容 Cloudflare Flexible 回源，避免重定向循环；证书签发完成后请将该主机切换到 Full (strict)。

首次安装时，在 `/opt/llm/data/nginx/certs/docs.ailink1.com/` 准备 `fullchain.pem` 和仅 ubuntu 可读的 `privkey.pem`。DNS 尚未开通时可以用仅覆盖该域名的临时自签证书启动。将 `docs.ailink1.com.conf` 和 `ailink-console-csp.conf` 安装到 `/opt/llm/data/nginx/conf.d/`，将 `ailink-console-csp.inc` 安装到其中的 `snippets/`。仅在控制台 `ai.ailink1.com` 的反向代理 location 内加入以下一行。

```nginx
include /etc/nginx/conf.d/snippets/ailink-console-csp.inc;
```

修改配置后运行 `docker exec nginx nginx -t && docker exec nginx nginx -s reload`。控制台保留上游每次响应生成的 CSP，只给 `frame-src` 增加文档域名。文档端通过 `FRAME_ANCESTORS=https://ai.ailink1.com` 允许控制台嵌入。

将 `docs-ailink1-cert.cron` 安装到 `/etc/cron.d/docs-ailink1-cert`（root 所有，0644）。它每五分钟检查公网能否读取 HTTP 验证文件，域名就绪后调用 ubuntu 的 acme.sh 签发并安装 Let's Encrypt 证书。签发后由服务器原有的 acme.sh 任务续期并平滑加载 Nginx。可用 `journalctl -t docs-ailink1-acme` 查看首次签发日志。

在 Cloudflare 为 `docs` 新建指向 `144.217.183.138` 的 A 记录，先选“仅 DNS”。浏览器直接访问 `https://docs.ailink1.com/healthz` 时证书有效、返回 `{"status":"ok"}` 后，可为该主机名单独设置 Full (strict) 并开启代理。已有站点沿用原有 SSL 设置。
