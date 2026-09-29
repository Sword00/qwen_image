"""
为 Qwen-Image-2.1（Qwen3-VL）GGUF 文本编码器加载视觉塔（mmproj）的补充模块。

ComfyUI-GGUF 的 gguf_clip_loader 只会为 qwen2vl 架构自动读取同目录的 mmproj-*.gguf。
Qwen-Image-2.1 的 qwen3vl 文本编码器需要使用视觉塔处理参考图，缺少 model.visual.* 权重会导致编辑结果错误。本模块包装 ComfyUI-GGUF 加载器，在读取 qwen3vl 编码器时查找 mmproj，并转换为 ComfyUI 的 Qwen3-VL 键名。不添加新节点。

mmproj 文件必须与文本编码器位于同一目录（models/text_encoders/），文件名必须包含“mmproj”和编码器名称（不含量化后缀，例如 qwen3vl_8b_heretic）。
"""
import logging
import os
import re
import sys

import torch

LOG = logging.getLogger("qwen-studio-gguf-qwen3vl")

# （正则表达式、替换）llama.cpp mmproj 张量名称 → ComfyUI Qwen3-VL 视觉键
QWEN3VL_VISION_MAP = [
    (r"^v\.blk\.(\d+)\.attn_qkv\.", r"model.visual.blocks.\1.attn.qkv."),
    (r"^v\.blk\.(\d+)\.attn_out\.", r"model.visual.blocks.\1.attn.proj."),
    (r"^v\.blk\.(\d+)\.ffn_up\.", r"model.visual.blocks.\1.mlp.linear_fc1."),
    (r"^v\.blk\.(\d+)\.ffn_down\.", r"model.visual.blocks.\1.mlp.linear_fc2."),
    (r"^v\.blk\.(\d+)\.ln1\.", r"model.visual.blocks.\1.norm1."),
    (r"^v\.blk\.(\d+)\.ln2\.", r"model.visual.blocks.\1.norm2."),
    (r"^v\.post_ln\.", "model.visual.merger.norm."),
    (r"^v\.patch_embd\.", "model.visual.patch_embed.proj."),
    (r"^v\.position_embd\.", "model.visual.pos_embed."),
]


def _find_gguf_modules():
    """从 sys.modules 中查找 ComfyUI-GGUF 的 loader / nodes 模块。"""
    loader_mod = nodes_mod = None
    for name, mod in list(sys.modules.items()):
        if mod is None:
            continue
        if name.endswith(".loader") and hasattr(mod, "gguf_clip_loader") and hasattr(mod, "gguf_sd_loader"):
            loader_mod = mod
        if name.endswith(".nodes") and hasattr(mod, "CLIPLoaderGGUF") and hasattr(mod, "gguf_clip_loader"):
            nodes_mod = mod
    return loader_mod, nodes_mod


def _gguf_arch(path):
    try:
        import gguf

        reader = gguf.GGUFReader(path)
        field = reader.fields.get("general.architecture")
        if field is None:
            return None
        return bytes(field.parts[field.data[0]]).decode("utf-8")
    except Exception as err:  # noqa: BLE001
        LOG.warning("无法读取 GGUF 架构（%s）：%s", path, err)
        return None


def _find_mmproj(path, loader_mod):
    stem = os.path.splitext(os.path.basename(path))[0].lower()
    stem = loader_mod.strip_quant_suffix(stem)
    root = os.path.dirname(path)
    hits = []
    for fname in os.listdir(root):
        name, ext = os.path.splitext(fname)
        if ext.lower() != ".gguf" or "mmproj" not in name.lower():
            continue
        if stem in name.lower():
            hits.append(fname)
    if not hits:
        LOG.error("找不到与“%s”匹配的 mmproj 文件（文件名需包含“%s”和“mmproj”）。参考图编辑将无法正常工作。", os.path.basename(path), stem)
        return None
    if len(hits) > 1:
        LOG.warning("mmproj 候选文件不止一个：%s。将使用第一个。", hits)
    return os.path.join(root, sorted(hits)[0])


def _load_qwen3vl_mmproj(path, loader_mod):
    target = _find_mmproj(path, loader_mod)
    if target is None:
        return {}
    LOG.info("正在读取 Qwen3-VL 视觉塔：%s", os.path.basename(target))
    vsd, _ = loader_mod.gguf_sd_loader(target, is_text_model=True)

    # llama.cpp 将补丁嵌入的两个时间轴保存为独立张量，这里合并为 [out, in, 2, 16, 16]。
    if "v.patch_embd.weight.1" in vsd:
        w1 = loader_mod.dequantize_tensor(vsd.pop("v.patch_embd.weight"), dtype=torch.float32)
        w2 = loader_mod.dequantize_tensor(vsd.pop("v.patch_embd.weight.1"), dtype=torch.float32)
        vsd["v.patch_embd.weight"] = torch.stack([w1, w2], dim=2)

    # 合并器线性层：按 mm.<i> 索引顺序映射到 linear_fc1、linear_fc2。
    mm_indices = sorted({int(m.group(1)) for k in vsd for m in [re.match(r"^mm\.(\d+)\.", k)] if m})
    mm_map = {}
    if len(mm_indices) >= 2:
        mm_map = {mm_indices[0]: "model.visual.merger.linear_fc1.", mm_indices[-1]: "model.visual.merger.linear_fc2."}
    elif mm_indices:
        LOG.warning("mm 投影层张量只有 %d 个：%s", len(mm_indices), mm_indices)

    # DeepStack 合并器：llama.cpp 使用视觉层编号（例如 8、16、24），ComfyUI 使用 0、1、2 的顺序编号。
    # ComfyUI 需要 deepstack_merger_list.0 键才能识别 Qwen3-VL，因此必须重新编号。
    ds_indices = sorted({int(m.group(1)) for k in vsd for m in [re.match(r"^v\.deepstack\.(\d+)\.", k)] if m})
    ds_rank = {idx: rank for rank, idx in enumerate(ds_indices)}
    if ds_indices:
        LOG.info("DeepStack 合并器编号 %s → %s", ds_indices, list(range(len(ds_indices))))

    out = {}
    unmapped = []
    for key, value in vsd.items():
        new_key = None
        m = re.match(r"^mm\.(\d+)\.(.+)$", key)
        ds = re.match(r"^v\.deepstack\.(\d+)\.(fc1|fc2|norm)\.(.+)$", key)
        if m and int(m.group(1)) in mm_map:
            new_key = mm_map[int(m.group(1))] + m.group(2)
        elif ds:
            part = {"fc1": "linear_fc1", "fc2": "linear_fc2", "norm": "norm"}[ds.group(2)]
            new_key = f"model.visual.deepstack_merger_list.{ds_rank[int(ds.group(1))]}.{part}.{ds.group(3)}"
        else:
            for pattern, repl in QWEN3VL_VISION_MAP:
                if re.match(pattern, key):
                    new_key = re.sub(pattern, repl, key)
                    break
        if new_key is None:
            unmapped.append(key)
            continue
        out[new_key] = value
    if unmapped:
        LOG.warning("有 %d 个 mmproj 张量没有对应项（已忽略）：%s", len(unmapped), unmapped[:8])
    LOG.info("已加载 Qwen3-VL 视觉塔的 %d 个张量。", len(out))
    return out


def _install():
    loader_mod, nodes_mod = _find_gguf_modules()
    if loader_mod is None or nodes_mod is None:
        LOG.error("找不到 ComfyUI-GGUF 模块。请先加载 ComfyUI-GGUF。")
        return False
    original = nodes_mod.gguf_clip_loader
    if getattr(original, "_qwen3vl_patched", False):
        return True

    def gguf_clip_loader_with_qwen3vl_vision(path):
        sd = original(path)
        try:
            has_vision = any(k.startswith("model.visual.") for k in sd)
            if not has_vision and _gguf_arch(path) == "qwen3vl":
                sd.update(_load_qwen3vl_mmproj(path, loader_mod))
        except Exception as err:  # noqa: BLE001
            LOG.error("无法加载 Qwen3-VL 视觉塔：%s", err)
        return sd

    gguf_clip_loader_with_qwen3vl_vision._qwen3vl_patched = True
    nodes_mod.gguf_clip_loader = gguf_clip_loader_with_qwen3vl_vision
    loader_mod.gguf_clip_loader = gguf_clip_loader_with_qwen3vl_vision
    LOG.info("已为 ComfyUI-GGUF 文本编码器加载器添加 Qwen3-VL mmproj 支持。")
    return True


if not _install():
    # 如果自定义节点加载顺序导致 ComfyUI-GGUF 尚未就绪，则在第一次提示词执行前重试。
    try:
        import server

        def _install_before_prompt(json_data):
            _install()
            return json_data

        server.PromptServer.instance.add_on_prompt_handler(_install_before_prompt)
        LOG.info("ComfyUI-GGUF 尚未加载，将在第一次提示词执行前重试。")
    except Exception as err:  # noqa: BLE001
        LOG.error("注册延迟安装失败：%s", err)

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
