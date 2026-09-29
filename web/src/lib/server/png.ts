import fs from "node:fs";

/** 从 PNG 头部（IHDR）读取宽高；如果不是 PNG 则返回 0。 */
export function readPngSize(file: string): { width: number; height: number } {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(24);
    fs.readSync(fd, buf, 0, 24, 0);
    const isPng = buf.readUInt32BE(0) === 0x89504e47;
    if (!isPng) return { width: 0, height: 0 };
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } finally {
    fs.closeSync(fd);
  }
}
