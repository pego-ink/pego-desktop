/** Width and height from the header of a PNG, JPEG or WebP file; null when it cannot tell. */
export const imageSize = (bytes: Uint8Array): { width: number; height: number } | null => {
  const at = (i: number) => bytes[i] ?? 0;
  const u16be = (i: number) => (at(i) << 8) | at(i + 1);
  const u16le = (i: number) => at(i) | (at(i + 1) << 8);
  const u24le = (i: number) => at(i) | (at(i + 1) << 8) | (at(i + 2) << 16);
  const u32be = (i: number) =>
    ((at(i) << 24) | (at(i + 1) << 16) | (at(i + 2) << 8) | at(i + 3)) >>> 0;
  const ascii = (i: number, n: number) => String.fromCharCode(...bytes.subarray(i, i + n));
  const sized = (width: number, height: number) =>
    width > 0 && height > 0 ? { width, height } : null;

  // PNG: signature, then the IHDR chunk.
  if (at(0) === 0x89 && ascii(1, 3) === "PNG") return sized(u32be(16), u32be(20));
  // JPEG: walk the segments to the first start-of-frame marker.
  if (at(0) === 0xff && at(1) === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (at(i) !== 0xff) return null;
      const marker = at(i + 1);
      if (marker === 0xff) {
        i += 1;
        continue;
      }
      const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isFrame) return sized(u16be(i + 7), u16be(i + 5));
      i += 2 + u16be(i + 2);
    }
    return null;
  }
  // WebP: lossy (VP8), lossless (VP8L) or extended (VP8X).
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const chunk = ascii(12, 4);
    if (chunk === "VP8X") return sized(u24le(24) + 1, u24le(27) + 1);
    if (chunk === "VP8L") {
      const b = (i: number) => at(21 + i);
      return sized(
        1 + (((b(1) & 0x3f) << 8) | b(0)),
        1 + (((b(3) & 0x0f) << 10) | (b(2) << 2) | ((b(1) & 0xc0) >> 6)),
      );
    }
    if (chunk === "VP8 ") return sized(u16le(26) & 0x3fff, u16le(28) & 0x3fff);
  }
  return null;
};
