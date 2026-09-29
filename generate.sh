#!/usr/bin/env zsh
# Qwen-Image-2.1 文生图脚本（mflux / Apple MLX）
#
# 用法：
#   ./generate.sh "提示词" [输出文件.png] [mflux 额外参数...]
#
# 示例：
#   ./generate.sh "雨夜中的霓虹招牌，写着 QWEN IMAGE 2.1" outputs/neon.png
#   ./generate.sh "猫" outputs/cat.png --seed 42 --width 1280 --height 720
#
# 用环境变量调整默认值：
#   QWEN_Q=8   Transformer 量化位数（3/4/5/6/8），内存不足时降到 6 或 4
#   STEPS=40   采样步数（官方建议 40）
#   WIDTH/HEIGHT=1024   尺寸（16 的倍数）
set -euo pipefail

PROMPT="${1:?请将提示词作为第一个参数传入}"
shift
OUT="${1:-outputs/$(date +%Y%m%d-%H%M%S).png}"
[[ $# -gt 0 ]] && shift
mkdir -p "$(dirname "$OUT")"

exec mflux-generate-qwen-2.1 \
  --model qwen-image-2.1 \
  --quantize "${QWEN_Q:-8}" \
  --low-ram \
  --steps "${STEPS:-40}" \
  --width "${WIDTH:-1024}" \
  --height "${HEIGHT:-1024}" \
  --prompt "$PROMPT" \
  --output "$OUT" \
  "$@"
