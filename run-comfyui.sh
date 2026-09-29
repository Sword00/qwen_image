#!/usr/bin/env zsh
# 启动 ComfyUI 服务器（Apple Silicon / MPS）
#
# 用法：
#   ./run-comfyui.sh            # 在 http://127.0.0.1:8188 运行
#   ./run-comfyui.sh --lowvram  # 内存不足时传入额外选项
#
# 退出：Ctrl+C
set -euo pipefail
cd "$(dirname "$0")/ComfyUI"

# MPS 不支持的运算自动回退到 CPU
export PYTORCH_ENABLE_MPS_FALLBACK=1

exec .venv/bin/python main.py \
  --listen 127.0.0.1 --port 8188 \
  --preview-method auto \
  --output-directory "$(dirname "$PWD")/outputs" \
  "$@"
