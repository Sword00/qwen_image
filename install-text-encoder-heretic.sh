#!/usr/bin/env zsh
# Qwen-Image-2.1 Heretic（降低拒答）文本编码器 GGUF 安装脚本
#
# 来源：https://huggingface.co/pottokao/Qwen-Image-2.1-Text-Encoder-Heretic-GGUF
#   qwen3vl_8b_heretic-Q4_K_M.gguf       5.0GB  语言模型（量化），文生图需要
#   mmproj-qwen3vl_8b_heretic-f16.gguf   1.2GB  视觉塔（f16），参考图编辑需要
#
# 用法：
#   ./install-text-encoder-heretic.sh              安装两个文件
#   ./install-text-encoder-heretic.sh --text-only  仅安装语言模型
#   ./install-text-encoder-heretic.sh --force      即使文件存在也重新下载
#   ./install-text-encoder-heretic.sh --check      仅检查安装状态和校验和
#
# 安装位置：ComfyUI/models/text_encoders/（ComfyUI-GGUF 的 CLIPLoader (GGUF) 节点读取此目录）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="pottokao/Qwen-Image-2.1-Text-Encoder-Heretic-GGUF"
DEST="$ROOT/ComfyUI/models/text_encoders"
MAIN="qwen3vl_8b_heretic-Q4_K_M.gguf"
MMPROJ="mmproj-qwen3vl_8b_heretic-f16.gguf"

typeset -a FILES
FILES=("$MAIN" "$MMPROJ")
FORCE=0
CHECK_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --text-only) FILES=("$MAIN") ;;
    --force) FORCE=1 ;;
    --check) CHECK_ONLY=1 ;;
    -h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) print "未知选项：$arg（--text-only | --force | --check）" >&2; exit 1 ;;
  esac
done

info() { print -P "%F{blue}▸%f $*"; }
ok()   { print -P "%F{green}✓%f $*"; }
warn() { print -P "%F{yellow}!%f $*"; }
fail() { print -P "%F{red}✗%f $*" >&2; exit 1; }

[[ -d "$ROOT/ComfyUI" ]] || fail "找不到 ComfyUI 目录：$ROOT/ComfyUI（请先完成 README 中的 ComfyUI 安装步骤）"
[[ -d "$ROOT/ComfyUI/custom_nodes/ComfyUI-GGUF" ]] || fail "找不到 ComfyUI-GGUF 自定义节点：$ROOT/ComfyUI/custom_nodes/ComfyUI-GGUF"
command -v uvx >/dev/null 2>&1 || fail "需要 uv：brew install uv"
command -v python3 >/dev/null 2>&1 || fail "需要 python3"
mkdir -p "$DEST"

# ---- 从 Hugging Face 获取文件大小和 SHA256 ----
info "正在获取 Hugging Face 文件信息：$REPO"
META="$(curl -sfL "https://huggingface.co/api/models/$REPO/tree/main?recursive=true")" || fail "无法访问 Hugging Face API。"

meta_field() { # $1=文件名  $2=size|oid
  print -r -- "$META" | python3 -c '
import sys, json
name, field = sys.argv[1], sys.argv[2]
for f in json.load(sys.stdin):
    if f.get("path") == name:
        lfs = f.get("lfs") or {}
        print(lfs.get("oid", "") if field == "oid" else (lfs.get("size") or f.get("size") or 0))
        break
' "$1" "$2"
}

verify() { # $1=文件名；大小和 SHA256 正确时返回 0
  local f="$DEST/$1"
  [[ -f "$f" ]] || { warn "$1 不存在"; return 1; }
  local expect_size expect_sha actual_size actual_sha
  expect_size="$(meta_field "$1" size)"
  expect_sha="$(meta_field "$1" oid)"
  actual_size="$(stat -f%z "$f")"
  [[ "$actual_size" == "$expect_size" ]] || { warn "$1 大小不匹配（$actual_size ≠ $expect_size）"; return 1; }
  if [[ -n "$expect_sha" ]]; then
    info "正在检查 SHA256：$1"
    actual_sha="$(shasum -a 256 "$f" | cut -d' ' -f1)"
    [[ "$actual_sha" == "$expect_sha" ]] || { warn "$1 SHA256 不匹配"; return 1; }
  fi
  return 0
}

if (( CHECK_ONLY )); then
  check_failed=0
  for f in "${FILES[@]}"; do
    if verify "$f"; then ok "$f 正常"; else check_failed=1; fi
  done
  exit $check_failed
fi

# ---- 确定需要下载的文件 ----
typeset -a TODO
TODO=()
need=0
for f in "${FILES[@]}"; do
  if (( ! FORCE )) && [[ -f "$DEST/$f" ]] && [[ "$(stat -f%z "$DEST/$f")" == "$(meta_field "$f" size)" ]]; then
    ok "$f 已存在（跳过）"
  else
    TODO+=("$f")
    need=$(( need + $(meta_field "$f" size) ))
  fi
done

if (( ${#TODO} > 0 )); then
  avail=$(( $(df -k "$DEST" | awk 'NR==2{print $4}') * 1024 ))
  (( avail > need + 1024 * 1024 * 1024 )) || fail "磁盘空间不足：需要 $(( need / 1024 / 1024 / 1024 ))GB，可用 $(( avail / 1024 / 1024 / 1024 ))GB"
  info "正在下载（约 $(( need / 1024 / 1024 / 1024 + 1 ))GB）：${TODO[*]}"
  info "保存位置：$DEST"
  typeset -a EXTRA
  EXTRA=()
  (( FORCE )) && EXTRA=(--force-download)
  uvx --from "huggingface_hub[hf_xet]" hf download "$REPO" "${TODO[@]}" --local-dir "$DEST" "${EXTRA[@]}"
  rm -rf "$DEST/.cache"
fi

for f in "${FILES[@]}"; do
  verify "$f" && ok "$f 校验完成" || fail "$f 校验失败，请使用 --force 重新下载。"
done

print
ok "安装完成：$DEST"
cat <<GUIDE

使用方法
  Web 应用   在高级设置 → 文本编码器中选择“Heretic Q4_K_M (GGUF)”。
            ComfyUI 已运行时列表会在 15 秒内刷新；如果没有显示，请刷新页面。
  终端      ./comfy-generate.py "提示词" --text-encoder heretic
  ComfyUI   放置“CLIPLoader (GGUF)”节点，选择 $MAIN，并将 type 设为 qwen_image。

说明
  · 编辑（参考图）需要同时安装视觉塔 $MMPROJ。
  · 此编码器是降低原始 Qwen3-VL-8B 拒答反应的衍生模型，按 Apache-2.0 发布。
GUIDE
