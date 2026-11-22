# 144 Nginx 配置

`docs.ailink1.com.conf` 将文档服务代理到本机 `127.0.0.1:8090`。

144 的 `ai.ailink1.com` 还需要在响应 CSP 的 `frame-src` 中加入：

```text
https://docs.ailink1.com
```

部署脚本会更新 Nginx 配置并执行 `nginx -t` 与 reload；不会重启或修改 Sub2API 容器。
