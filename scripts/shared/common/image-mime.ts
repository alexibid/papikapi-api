const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
};

export class ImageMime {
  /** The image type read from the file's first bytes; JPEG when they match no known signature. */
  public static of(bytes: Buffer): string {
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes.subarray(1, 4).toString() === 'PNG') return 'image/png';
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    const isWebp = bytes.length >= 12 && bytes.subarray(0, 4).toString() === 'RIFF'
      && bytes.subarray(8, 12).toString() === 'WEBP';
    return isWebp ? 'image/webp' : 'image/jpeg';
  }

  public static extension(mime: string): string {
    return EXTENSIONS[mime] ?? 'jpeg';
  }
}
