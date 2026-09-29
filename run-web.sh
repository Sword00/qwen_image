#!/usr/bin/env zsh
# 启动 Qwen Image 2.1 Studio Web 应用
#
# 用法：
#   ./run-web.sh          # 生产模式；没有构建结果时先构建
#   ./run-web.sh dev      # 开发模式（代码修改立即生效）
#   ./run-web.sh build    # 仅重新构建
#
# 环境变量：
#   PORT=3210             Web 应用端口
#   COMFY_URL=http://127.0.0.1:8188   ComfyUI 服务地址
#   COMFY_AUTOSTART=1     ComfyUI 未运行时自动执行 run-comfyui.sh（0 为关闭）
set -euo pipefail
cd "$(dirname "$0")/web"
export PORT="${PORT:-3210}"
MODE="${1:-start}"

case "$MODE" in
  dev)   exec npm run dev -- --port "$PORT" ;;
  build) exec npm run build ;;
  start)
    [[ -d .next ]] || npm run build
    exec npm run start -- --port "$PORT"
    ;;
  *) echo "未知模式：$MODE（dev | build | start）"; exit 1 ;;
esac
