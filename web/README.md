# Qwen Image Studio Web 应用

这是使用 Next.js 16 + shadcn/ui 构建的 Qwen-Image-2.1 生成界面。安装、运行和结构说明请参阅仓库根目录的 [README](../README.md)。

```bash
npm install
npm run dev -- --port 3210   # 开发模式
npm run build && npm run start -- --port 3210
```

环境变量：`PORT`、`COMFY_URL`（默认 http://127.0.0.1:8188）、`COMFY_AUTOSTART`（0 关闭自动启动）、`QWEN_ROOT`（默认上级目录）。
