# 模型与动作资源（R2）

已上传到 Cloudflare R2：

- Account: `3b8121f92099336587cf87837240c3be`
- Bucket: `gakuen`
- Keys: `idols/<id>/...`、`motions/...`（与 `library.json` 的 `r2Prefix` 一致）
- 对象数约 1960

注意：初星育成的 `https://pub-cfdeb8f85de84d8193695eca002e7880.r2.dev` **不是** `gakuen` 桶。
请在 R2 → `gakuen` → Settings 开启 **Public access / R2.dev subdomain**，把生成的 `https://pub-xxxx.r2.dev` 填进 `library.json` 的 `r2.baseUrl`，再把 `source` 改为 `r2`。

仓库内历史提交可能仍含 `library/file` 大文件；新改动请继续忽略该目录，以 R2 为准。
