import { NextResponse } from "next/server";
import { MAX_UPLOAD_BYTES } from "@/lib/presets";
import { saveUpload } from "@/lib/server/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif", "image/heic", "image/heif"]);

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "请求不是 multipart/form-data 格式。" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "缺少 file 字段。" }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: `图像大小不能超过 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB。` }, { status: 413 });
  }
  if (file.type && !ALLOWED.has(file.type)) {
    return NextResponse.json({ error: `不支持的格式：${file.type}` }, { status: 415 });
  }
  try {
    const info = await saveUpload(Buffer.from(await file.arrayBuffer()));
    return NextResponse.json(info, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: `无法处理图像：${err instanceof Error ? err.message : String(err)}` }, { status: 422 });
  }
}
