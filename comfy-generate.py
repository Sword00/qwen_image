#!/usr/bin/env python3
"""通过 ComfyUI 服务 API 生成 Qwen-Image-2.1 GGUF 图像的命令行工具。

用法：
  ./run-comfyui.sh   # 先在另一个终端启动服务
  ./comfy-generate.py "提示词" -o outputs/result.png [--gguf Q8_0|Q4_K_M] [--text-encoder int8|bf16|heretic] [--steps 40] [--seed 42]
"""
import argparse, json, shutil, sys, time, urllib.request, uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
GGUF_FILES = {
    "Q5_K_M": "qwen-image-2.1-Q5_K_M.gguf",
    "Q8_0": "qwen-image-2.1-Q8_0.gguf",
    "Q4_K_M": "qwen-image-2.1-Q4_K_M.gguf",
}
TEXT_ENCODERS = {
    "int8": "qwen3vl_8b_int8_convrot.safetensors",
    "bf16": "qwen3vl_8b_bf16.safetensors",
    # 由 ./install-text-encoder-heretic.sh 安装的降低拒答 GGUF 编码器
    "heretic": "qwen3vl_8b_heretic-Q4_K_M.gguf",
}
VAE = "qwen_image_2.1_vae_bf16.safetensors"


def clip_loader(clip_name):
    """GGUF 编码器由 ComfyUI-GGUF 的 CLIPLoaderGGUF 读取，safetensors 使用默认 CLIPLoader。"""
    if clip_name.lower().endswith(".gguf"):
        return {"class_type": "CLIPLoaderGGUF", "inputs": {"clip_name": clip_name, "type": "qwen_image"}}
    return {"class_type": "CLIPLoader",
            "inputs": {"clip_name": clip_name, "type": "qwen_image", "device": "default"}}


def build_workflow(a):
    return {
        "1": {"class_type": "UnetLoaderGGUF", "inputs": {"unet_name": GGUF_FILES[a.gguf]}},
        "2": clip_loader(TEXT_ENCODERS[a.text_encoder]),
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": VAE}},
        "4": {"class_type": "TextEncodeQwenImage21",
              "inputs": {"clip": ["2", 0], "prompt": a.prompt, "negative_prompt": a.negative_prompt,
                         "vae": ["3", 0], "resolution": 1024}},
        "5": {"class_type": "EmptyLatentImage",
              "inputs": {"width": a.width, "height": a.height, "batch_size": 1}},
        "6": {"class_type": "KSampler",
              "inputs": {"model": ["1", 0], "positive": ["4", 0], "negative": ["4", 1], "latent_image": ["5", 0],
                         "seed": a.seed, "steps": a.steps, "cfg": a.cfg,
                         "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0}},
        "7": {"class_type": "VAEDecode", "inputs": {"samples": ["6", 0], "vae": ["3", 0]}},
        "8": {"class_type": "SaveImage", "inputs": {"images": ["7", 0], "filename_prefix": "qwen21_gguf"}},
    }


def api(server, path, data=None):
    req = urllib.request.Request(f"{server}{path}",
                                 data=json.dumps(data).encode() if data is not None else None,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("prompt")
    p.add_argument("-o", "--output", default=None, help="保存路径（默认：outputs/qwen21_gguf_XXXXX.png）")
    p.add_argument("--negative-prompt", default="")
    p.add_argument("--gguf", choices=GGUF_FILES, default="Q5_K_M")
    p.add_argument("--text-encoder", choices=TEXT_ENCODERS, default="int8")
    p.add_argument("--steps", type=int, default=40)
    p.add_argument("--cfg", type=float, default=1.0, help="仅在使用负面提示词时设为大于 1")
    p.add_argument("--seed", type=int, default=int(time.time()) % 2_000_000_000)
    p.add_argument("--width", type=int, default=1024)
    p.add_argument("--height", type=int, default=1024)
    p.add_argument("--server", default="http://127.0.0.1:8188")
    a = p.parse_args()

    try:
        api(a.server, "/system_stats")
    except Exception as e:
        sys.exit(f"无法连接 ComfyUI 服务（{a.server}）：{e}\n请先运行 ./run-comfyui.sh。")

    client_id = str(uuid.uuid4())
    res = api(a.server, "/prompt", {"prompt": build_workflow(a), "client_id": client_id})
    if "prompt_id" not in res:
        sys.exit(f"工作流提交失败：{json.dumps(res, ensure_ascii=False, indent=2)}")
    pid = res["prompt_id"]
    print(f"已提交 prompt_id={pid} seed={a.seed} gguf={a.gguf} te={a.text_encoder} {a.width}x{a.height} steps={a.steps}")

    t0 = time.time()
    while True:
        hist = api(a.server, f"/history/{pid}")
        if pid in hist:
            break
        q = api(a.server, "/queue")
        running = len(q.get("queue_running", [])); pending = len(q.get("queue_pending", []))
        print(f"\r生成中... {time.time() - t0:5.0f}s（运行 {running}，等待 {pending}）", end="", flush=True)
        time.sleep(2)
    print()
    entry = hist[pid]
    status = entry.get("status", {})
    if status.get("status_str") == "error":
        msgs = [m for m in status.get("messages", []) if m[0] == "execution_error"]
        sys.exit("执行错误：\n" + json.dumps(msgs, ensure_ascii=False, indent=2))

    images = [img for out in entry["outputs"].values() for img in out.get("images", [])]
    if not images:
        sys.exit("没有输出图像。")
    img = images[0]
    src = HERE / "outputs" / img.get("subfolder", "") / img["filename"]
    if a.output:
        dst = Path(a.output); dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(src, dst)
    else:
        dst = src
    print(f"完成（{time.time() - t0:.0f}s）：{dst}")


if __name__ == "__main__":
    main()
