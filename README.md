# Qwen Image 2.1 Studio

在 Apple Silicon Mac 上本地运行 [Qwen-Image-2.1](https://huggingface.co/Qwen/Qwen-Image-2.1) 的图像生成工作室。支持预设和详细参数、实时进度与预览、参考图编辑，以及图库搜索、删除和重新生成。

![Qwen Image Studio 界面](docs/screenshot.png)

## 功能组成

- **Web 应用**（`web/`）：Next.js 16 + shadcn/ui，支持异步队列、SSE 实时进度、参考图编辑和图库管理。
- **ComfyUI + GGUF**：使用量化模型运行，Web 应用可以自动启动 ComfyUI。
- **mflux（MLX）**：使用 Apple MLX 运行 bf16 原始权重的备选路径。
- **GGUF 文本编码器**：包含用于加载 Qwen3-VL 视觉塔的补充模块。

## 环境要求

| 项目 | 要求 |
| --- | --- |
| 硬件 | Apple Silicon Mac，建议统一内存 32GB 以上；开发和测试使用 M4 Max 36GB |
| 磁盘 | ComfyUI 路径约 25GB，mflux 另需约 33GB |
| 软件 | [uv](https://docs.astral.sh/uv/)、git、Node.js 20 以上、macOS 14 以上 |

## 快速开始

```bash
git clone https://github.com/revfactory/qwen-image-studio.git
cd qwen-image-studio
./setup-comfyui.sh
./run-web.sh
```

打开 <http://127.0.0.1:3210>。第一次生成时 Web 应用会自动启动 ComfyUI，通常需要等待约一分钟。只使用终端时，可以先运行 `./run-comfyui.sh`，再运行 `./comfy-generate.py "提示词"`。

默认配置为 Q5_K_M Transformer + INT8 文本编码器 + BF16 VAE。24GB 设备建议从 640~768 像素草稿开始。

## 模型配置

| 项目 | 文件 |
| --- | --- |
| Transformer | `qwen-image-2.1-Q5_K_M.gguf`，约 5.4GB |
| 文本编码器 | `qwen3vl_8b_int8_convrot.safetensors`，约 9.4GB |
| VAE | `qwen_image_2.1_vae_bf16.safetensors`，约 0.7GB |
| 备选 Transformer | `Q8_0`（质量优先）或 `Q4_K_M`（显存/内存优先） |

`./setup-comfyui.sh` 会安装 ComfyUI、ComfyUI-GGUF、自定义补充模块、模型和 Web 依赖。使用 `./setup-comfyui.sh --q4` 额外下载 Q4_K_M 模型。

## mflux 命令行

安装 mflux 后，首次运行会下载 `Qwen/Qwen-Image-2.1` bf16 权重：

```bash
uv tool install --python 3.12 mflux
./generate.sh "雨夜中的霓虹商店招牌" outputs/neon.png --seed 42
./generate.sh "水墨风格的老虎" outputs/tiger.png --width 1280 --height 720
```

常用参数：`--steps` 设置采样步数（官方建议 40），`-q/--quantize` 设置 3/4/5/6/8 位量化，`--seed` 固定种子，`--width` 和 `--height` 设置尺寸，`--negative-prompt` 与 `--guidance` 设置负面提示词，`--low-ram` 降低内存占用。

## ComfyUI + GGUF

```bash
./run-comfyui.sh
./comfy-generate.py "提示词" -o outputs/result.png
./comfy-generate.py "提示词" --gguf Q4_K_M --steps 25 --seed 42 --width 1280 --height 720
```

浏览器打开 <http://127.0.0.1:8188> 可以使用 ComfyUI。官方模板为 `qwen21_t2i_template.json` 和 `qwen21_edit_template.json`。

`comfy-generate.py` 的主要参数：

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `--gguf` | `Q5_K_M` | `Q8_0` 质量更高，`Q4_K_M` 占用更少 |
| `--text-encoder` | `int8` | 也支持 `bf16` 和 `heretic` |
| `--steps` | 40 | 步数越高细节越多、速度越慢 |
| `--cfg` | 1.0 | 使用负面提示词时再提高 |
| `--seed/--width/--height` | 随机/1024/1024 | 尺寸建议使用 32 的倍数 |

建议先使用 640²、12~20 步进行草稿，再用 1024²、40 步生成最终图。一次只运行一个生成引擎，并关闭占用大量内存的其他应用。

## Web 应用

```bash
./run-web.sh          # 生产模式：http://127.0.0.1:3210
./run-web.sh dev      # 开发模式
./run-web.sh build    # 重新构建
```

Web UI 支持风格和质量预设、比例选择、ComfyUI/mflux 引擎、模型和文本编码器选择、步数、CFG、种子、任意尺寸、采样器、连续生成、参考图编辑、实时进度、预览、图库搜索、下载和删除。

生成图片保存到 `outputs/web/<任务 ID>.png`，任务记录保存到 `web/data/jobs.json`。参考图会转换为 PNG 后保存到 `web/data/uploads/`。

环境变量：`PORT`、`COMFY_URL`、`COMFY_AUTOSTART` 和 `QWEN_ROOT`。

## Heretic GGUF 文本编码器

运行以下脚本安装降低拒答的 Qwen3-VL GGUF 编码器：

```bash
./install-text-encoder-heretic.sh
./install-text-encoder-heretic.sh --text-only
./install-text-encoder-heretic.sh --check
./install-text-encoder-heretic.sh --force
```

完整安装包括语言模型 `qwen3vl_8b_heretic-Q4_K_M.gguf` 和参考图编辑需要的视觉塔 `mmproj-qwen3vl_8b_heretic-f16.gguf`。安装后可在 Web UI 的高级设置中选择 `Heretic Q4_K_M (GGUF)`，或运行：

```bash
./comfy-generate.py "提示词" --text-encoder heretic
```

## 目录结构

| 路径 | 作用 |
| --- | --- |
| `setup-comfyui.sh` | 配置 ComfyUI、虚拟环境、模型和 Web 依赖 |
| `run-web.sh` | 启动 Web 应用 |
| `run-comfyui.sh` | 启动 ComfyUI |
| `comfy-generate.py` | 调用 ComfyUI API 的命令行工具 |
| `generate.sh` | 使用 mflux 生成图像 |
| `install-text-encoder-heretic.sh` | 安装 Heretic GGUF 文本编码器 |
| `custom_nodes/qwen-studio-gguf-qwen3vl/` | 为 GGUF 编码器加载 Qwen3-VL 视觉塔 |
| `web/` | Next.js Web 应用 |

## 许可证

本仓库代码使用 MIT 许可证。ComfyUI、ComfyUI-GGUF、mflux 和模型权重分别遵循各自的许可证。
