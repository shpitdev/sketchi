import { inflateSync } from "node:zlib";

import { Schema } from "effect";

import { MAX_DECOMPRESSED_BYTES } from "./share-protocol.js";

const InflatedPng = Schema.Struct({
  buffer: Schema.Uint8Array,
  engine: Schema.Struct({ bytesWritten: Schema.Number }),
});

/** Metadata reads check framing only; consumption validates chunks and pixels. */
export function hasPngStructure(bytes: Uint8Array): boolean {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  const end = bytes.byteLength - 12;
  return (
    bytes.byteLength >= 45 &&
    signature.every((byte, index) => bytes[index] === byte) &&
    readUint32(bytes, 8) === 13 &&
    String.fromCharCode(...bytes.subarray(12, 16)) === "IHDR" &&
    readUint32(bytes, 16) > 0 &&
    readUint32(bytes, 20) > 0 &&
    crc32(bytes.subarray(12, 29)) === readUint32(bytes, 29) &&
    readUint32(bytes, end) === 0 &&
    String.fromCharCode(...bytes.subarray(end + 4, end + 8)) === "IEND" &&
    crc32(bytes.subarray(end + 4, end + 8)) === readUint32(bytes, end + 8)
  );
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  );
}

function concatenateBytes(chunks: ReadonlyArray<Uint8Array>): Uint8Array {
  const byteLength = chunks.reduce(
    (total, chunk) => total + chunk.byteLength,
    0,
  );
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

const ADAM7_PASSES: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
];

function passExtent(size: number, start: number, step: number): number {
  return size <= start ? 0 : Math.ceil((size - start) / step);
}

function pngScanlines(
  width: number,
  height: number,
  bitsPerPixel: number,
  interlace: number,
): ReadonlyArray<{ readonly rows: number; readonly rowBytes: number }> | null {
  const passes: ReadonlyArray<readonly [number, number, number, number]> =
    interlace === 0 ? [[0, 0, 1, 1]] : ADAM7_PASSES;
  const scanlines: Array<{ readonly rows: number; readonly rowBytes: number }> =
    [];
  let totalBytes = 0;
  for (const [xStart, yStart, xStep, yStep] of passes) {
    const passWidth = passExtent(width, xStart, xStep);
    const rows = passExtent(height, yStart, yStep);
    if (passWidth === 0 || rows === 0) continue;
    const rowBytes = Math.ceil((passWidth * bitsPerPixel) / 8) + 1;
    if (
      rowBytes > MAX_DECOMPRESSED_BYTES - totalBytes ||
      rows > Math.floor((MAX_DECOMPRESSED_BYTES - totalBytes) / rowBytes)
    ) {
      return null;
    }
    totalBytes += rows * rowBytes;
    scanlines.push({ rows, rowBytes });
  }
  return scanlines;
}

function hasValidInflatedPngData(
  chunks: ReadonlyArray<Uint8Array>,
  width: number,
  height: number,
  bitDepth: number,
  colorType: number,
  interlace: number,
): boolean {
  const samplesPerPixel: Readonly<Record<number, number>> = {
    0: 1,
    2: 3,
    3: 1,
    4: 2,
    6: 4,
  };
  const samples = samplesPerPixel[colorType];
  if (samples === undefined) return false;
  const scanlines = pngScanlines(width, height, samples * bitDepth, interlace);
  if (scanlines === null) return false;
  const expectedLength = scanlines.reduce(
    (total, pass) => total + pass.rows * pass.rowBytes,
    0,
  );
  try {
    const compressed = concatenateBytes(chunks);
    const result = inflateSync(compressed, {
      info: true,
      maxOutputLength: MAX_DECOMPRESSED_BYTES,
    });
    const decoded = Schema.decodeUnknownSync(InflatedPng)(result);
    if (decoded.engine.bytesWritten !== compressed.byteLength) return false;
    const inflated = decoded.buffer;
    if (inflated.byteLength !== expectedLength) return false;
    let offset = 0;
    for (const pass of scanlines) {
      for (let row = 0; row < pass.rows; row += 1) {
        if ((inflated[offset] ?? 5) > 4) return false;
        offset += pass.rowBytes;
      }
    }
    return offset === inflated.byteLength;
  } catch {
    return false;
  }
}

export function isValidPng(bytes: Uint8Array): boolean {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (
    bytes.byteLength < 33 ||
    signature.some((byte, index) => bytes[index] !== byte)
  ) {
    return false;
  }
  let offset = signature.length;
  let chunkIndex = 0;
  let width: number | undefined;
  let height: number | undefined;
  let colorType: number | undefined;
  let bitDepth: number | undefined;
  let interlace: number | undefined;
  let seenPalette = false;
  let seenImageData = false;
  let imageDataEnded = false;
  const imageDataChunks: Uint8Array[] = [];
  while (offset + 12 <= bytes.byteLength) {
    const length = readUint32(bytes, offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > bytes.byteLength) return false;
    const typeStart = offset + 4;
    const typeBytes = bytes.subarray(typeStart, typeStart + 4);
    const isAsciiLetter = (byte: number): boolean =>
      (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122);
    if (
      typeBytes.byteLength !== 4 ||
      !typeBytes.every(isAsciiLetter) ||
      (typeBytes[2]! & 0x20) !== 0
    ) {
      return false;
    }
    const type = String.fromCharCode(...typeBytes);
    if (chunkIndex === 0 && (type !== "IHDR" || length !== 13)) return false;
    if (type === "IHDR") {
      if (chunkIndex !== 0 || length !== 13) return false;
      width = readUint32(bytes, offset + 8);
      height = readUint32(bytes, offset + 12);
      bitDepth = bytes[offset + 16];
      colorType = bytes[offset + 17];
      interlace = bytes[offset + 20];
      const legalDepths: Readonly<Record<number, ReadonlyArray<number>>> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      };
      if (
        width === 0 ||
        height === 0 ||
        width > 0x7fffffff ||
        height > 0x7fffffff ||
        colorType === undefined ||
        bitDepth === undefined ||
        !legalDepths[colorType]?.includes(bitDepth) ||
        bytes[offset + 18] !== 0 ||
        bytes[offset + 19] !== 0 ||
        ![0, 1].includes(interlace ?? -1)
      ) {
        return false;
      }
    } else if (type === "PLTE") {
      if (
        seenPalette ||
        seenImageData ||
        length === 0 ||
        length % 3 !== 0 ||
        length > 768 ||
        colorType === 0 ||
        colorType === 4 ||
        (colorType === 3 &&
          bitDepth !== undefined &&
          length / 3 > 2 ** bitDepth)
      ) {
        return false;
      }
      seenPalette = true;
    } else if (type === "IDAT") {
      if (imageDataEnded || (colorType === 3 && !seenPalette)) return false;
      seenImageData = true;
      imageDataChunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    } else if (type === "IEND") {
      if (length !== 0 || !seenImageData || (colorType === 3 && !seenPalette)) {
        return false;
      }
    } else {
      if (seenImageData) imageDataEnded = true;
      const firstTypeByte = bytes[typeStart];
      if (firstTypeByte === undefined || (firstTypeByte & 0x20) === 0) {
        return false;
      }
    }
    const expectedCrc = readUint32(bytes, offset + 8 + length);
    if (crc32(bytes.subarray(typeStart, offset + 8 + length)) !== expectedCrc) {
      return false;
    }
    offset = chunkEnd;
    chunkIndex += 1;
    if (type === "IEND") {
      return (
        offset === bytes.byteLength &&
        width !== undefined &&
        height !== undefined &&
        bitDepth !== undefined &&
        colorType !== undefined &&
        interlace !== undefined &&
        hasValidInflatedPngData(
          imageDataChunks,
          width,
          height,
          bitDepth,
          colorType,
          interlace,
        )
      );
    }
  }
  return false;
}
