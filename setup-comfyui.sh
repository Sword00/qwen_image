#!/usr/bin/env zsh
# 配置 Qwen Image Studio 运行环境（Apple Silicon）
#
# 执行内容（已完成的步骤会跳过）：
#   1. 克隆 ComfyUI 和 leejet/ComfyUI-GGUF 自定义节点
#   2. 创建 Python 3.12 虚拟环境并安装依赖（包括 PyTorch MPS）
#   3. 链接 GGUF 编码器补充模块
#   4. 下载 Qwen-Image-2.1 GGUF、文本编码器和 VAE
#   5. 安装 Web 应用（web/）依赖
#
# 用法：
#   ./setup-comfyui.sh                 # 默认：Q5_K_M GGUF + int8 编码器 + VAE（约 16GB）
#   ./setup-comfyui.sh --q4            # 同时下载 Q4_K_M GGUF（额外约 4.2GB）
#   ./setup-comfyui.sh --skip-models   # 只配置代码和环境，不下载模型
#   ./setup-comfyui.sh --skip-web      # 跳过 Web 依赖安装
#
# 要求：macOS（Apple Silicon）、git、uv（brew install uv）、Node.js 20 以上，至少 25GB 磁盘空间
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
COMFY="$ROOT/ComfyUI"
PY_VERSION="3.12"
WITH_Q4=0
SKIP_MODELS=0
SKIP_WEB=0
for arg in "$@"; do
  case "$arg" in
    --q4) WITH_Q4=1 ;;
    --skip-models) SKIP_MODELS=1 ;;
    --skip-web) SKIP_WEB=1 ;;
    -h|--help) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) print "未知选项：$arg" >&2; exit 1 ;;
  esac
done

info() { print -P "%F{blue}▸%f $*"; }
ok()   { print -P "%F{green}✓%f $*"; }
fail() { print -P "%F{red}✗%f $*" >&2; exit 1; }

[[ "$(uname -s)" == "Darwin" && "$(uname -m)" == "arm64" ]] || print -P "%F{yellow}!%f 当前不是 Apple Silicon Mac，本脚本以 MPS 加速为前提。"
command -v git >/dev/null 2>&1 || fail "需要 git。"
UV_BIN="${UV_BIN:-$HOME/Library/Python/3.9/bin/uv}"
UVX_BIN="${UVX_BIN:-$HOME/Library/Python/3.9/bin/uvx}"
[[ -x "$UV_BIN" ]] || fail "需要 uv：brew install uv"

# ---- 1. 源码 ----
if [[ -d "$COMFY/.git" ]]; then
  ok "ComfyUI 已存在"
else
  info "正在克隆 ComfyUI"
  git clone --depth 1 https://github.com/comfyanonymous/ComfyUI "$COMFY"
fi
if [[ -d "$COMFY/custom_nodes/ComfyUI-GGUF/.git" ]]; then
  ok "ComfyUI-GGUF 已存在"
else
  info "正在克隆 ComfyUI-GGUF（leejet 分支，支持 Qwen-Image-2.1）"
  git clone --depth 1 https://github.com/leejet/ComfyUI-GGUF "$COMFY/custom_nodes/ComfyUI-GGUF"
fi

# ---- 2. Python 环境 ----
if [[ -x "$COMFY/.venv/bin/python" ]] && "$COMFY/.venv/bin/python" -c "import torch, gguf" >/dev/null 2>&1; then
  ok "虚拟环境和依赖已存在（$("$COMFY/.venv/bin/python" -c 'import torch; print("torch", torch.__version__)')）"
else
  info "创建虚拟环境（Python $PY_VERSION）并安装依赖"
  "$UV_BIN" venv --python "$PY_VERSION" "$COMFY/.venv"
  "$UV_BIN" pip install --python "$COMFY/.venv/bin/python" torch torchvision torchaudio \
    -r "$COMFY/requirements.txt" -r "$COMFY/custom_nodes/ComfyUI-GGUF/requirements.txt"
  "$COMFY/.venv/bin/python" -c "import torch; assert torch.backends.mps.is_available(), 'MPS 不可用'; print('torch', torch.__version__, 'MPS OK')"
fi

# ---- 3. 补充模块链接 ----
LINK="$COMFY/custom_nodes/qwen-studio-gguf-qwen3vl"
if [[ -L "$LINK" || -d "$LINK" ]]; then
  ok "补充模块链接已存在"
else
  ln -s ../../custom_nodes/qwen-studio-gguf-qwen3vl "$LINK"
  ok "已创建补充模块链接：custom_nodes/qwen-studio-gguf-qwen3vl"
fi

# ---- 4. 模型 ----
if (( SKIP_MODELS )); then
  info "跳过模型下载（--skip-models）"
else
  mkdir -p "$COMFY/models/diffusion_models" "$COMFY/models/text_encoders" "$COMFY/models/vae"
  if ! "$COMFY/.venv/bin/python" -c "import modelscope" >/dev/null 2>&1; then
    "$UV_BIN" pip install --python "$COMFY/.venv/bin/python" modelscope
  fi
  download() { # $1=仓库 $2=仓库内路径 $3=目标目录
    local repo="$1" path="$2" dest="$3" name="${2##*/}"
    if [[ -f "$dest/$name" ]]; then ok "$name 已存在"; return; fi
    info "正在下载：$repo/$path"
    # ModelScope is substantially faster and more reliable on this machine.
    "$COMFY/.venv/bin/modelscope" download --model "$repo" "$path" --local_dir "$dest"
    # --local-dir 会保留仓库中的子目录结构，因此将文件移动到目标目录
    if [[ "$path" == */* && -f "$dest/$path" ]]; then /bin/mv "$dest/$path" "$dest/$name"; /bin/rmdir "$dest/${path%/*}" 2>/dev/null || true; fi
    /bin/rm -rf "$dest/.cache"
  }
  download unsloth/Qwen-Image-2.1-GGUF qwen-image-2.1-Q5_K_M.gguf "$COMFY/models/diffusion_models"
  (( WITH_Q4 )) && download abenzerps/Qwen-Image-2.1-GGUF qwen-image-2.1-Q4_K_M.gguf "$COMFY/models/diffusion_models"
  download Comfy-Org/Qwen-Image-2.1 text_encoders/qwen3vl_8b_int8_convrot.safetensors "$COMFY/models/text_encoders"
  download Comfy-Org/Qwen-Image-2.1 vae/qwen_image_2.1_vae_bf16.safetensors "$COMFY/models/vae"
fi

# ---- 5. Web 应用 ----
if (( SKIP_WEB )); then
  info "跳过 Web 应用依赖安装（--skip-web）"
elif command -v npm >/dev/null 2>&1; then
  if [[ -d "$ROOT/web/node_modules" ]]; then ok "Web 应用依赖已存在"; else
    info "安装 Web 应用依赖"; ( cd "$ROOT/web" && npm install )
  fi
else
  print -P "%F{yellow}!%f 未找到 npm，跳过 Web 应用依赖。请安装 Node.js 20 以上，然后在 web/ 中运行 npm install。"
fi

print
ok "配置完成"
cat <<GUIDE

下一步
  ./run-web.sh                          启动 Web 应用 → http://127.0.0.1:3210（ComfyUI 会自动启动）
  ./run-comfyui.sh                      仅启动 ComfyUI → http://127.0.0.1:8188
  ./comfy-generate.py "提示词"          在终端生成（需要先启动 ComfyUI）
  ./install-text-encoder-heretic.sh     可选：安装降低拒答的 GGUF 文本编码器
GUIDE
