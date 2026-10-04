import { MAX_IMAGE_PIXELS } from "../../shared/local-images";

/** Header/structure validation is not a guarantee of decoder safety. */
export function imageFormat(bytes: Buffer): {
  mime: "image/png" | "image/jpeg";
  width: number;
  height: number;
} {
  const result = (
    mime: "image/png" | "image/jpeg",
    width: number,
    height: number
  ) => {
    if (!width || !height || width * height > MAX_IMAGE_PIXELS)
      throw Error("INVALID_IMAGE");
    return { mime, width, height };
  };
  if (
    bytes.length >= 33 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    if (
      bytes.readUInt32BE(8) !== 13 ||
      bytes.toString("ascii", 12, 16) !== "IHDR"
    )
      throw Error("INVALID_IMAGE");
    let cursor = 8,
      data = false,
      ended = false,
      afterData = false;
    while (cursor + 12 <= bytes.length) {
      const size = bytes.readUInt32BE(cursor),
        type = bytes.toString("ascii", cursor + 4, cursor + 8);
      if (size > bytes.length - cursor - 12) throw Error("INVALID_IMAGE");
      if (type === "IHDR" && cursor !== 8) throw Error("INVALID_IMAGE");
      if (type === "acTL" || type === "fcTL" || type === "fdAT")
        throw Error("INVALID_IMAGE");
      if (type === "IDAT") {
        if (afterData) throw Error("INVALID_IMAGE");
        data = true;
      } else if (data) afterData = true;
      if (type === "PLTE" && data) throw Error("INVALID_IMAGE");
      if (
        !["IHDR", "PLTE", "IDAT", "IEND"].includes(type) &&
        /^[A-Z]/.test(type)
      )
        throw Error("INVALID_IMAGE");
      cursor += size + 12;
      if (type === "IEND") {
        if (size !== 0 || cursor !== bytes.length) throw Error("INVALID_IMAGE");
        ended = true;
        break;
      }
    }
    if (!data || !ended) throw Error("INVALID_IMAGE");
    return result("image/png", bytes.readUInt32BE(16), bytes.readUInt32BE(20));
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[bytes.length - 2] === 255 &&
    bytes[bytes.length - 1] === 217
  ) {
    let cursor = 2,
      dimensions: ReturnType<typeof result> | undefined,
      scan = false;
    while (cursor + 2 <= bytes.length) {
      if (bytes[cursor++] !== 255) throw Error("INVALID_IMAGE");
      while (bytes[cursor] === 255) cursor++;
      const marker = bytes[cursor++];
      if (marker === 0xd9) {
        if (cursor !== bytes.length || !dimensions || !scan)
          throw Error("INVALID_IMAGE");
        return dimensions;
      }
      if (
        marker === 0xd8 ||
        marker === 0xdc ||
        marker === 0 ||
        marker === 1 ||
        (marker >= 0xd0 && marker <= 0xd7) ||
        cursor + 2 > bytes.length
      )
        throw Error("INVALID_IMAGE");
      const size = bytes.readUInt16BE(cursor);
      if (size < 2 || cursor + size > bytes.length)
        throw Error("INVALID_IMAGE");
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (
          dimensions ||
          scan ||
          size < 8 ||
          bytes[cursor + 2] !== 8 ||
          ![1, 3, 4].includes(bytes[cursor + 7]) ||
          size !== 8 + 3 * bytes[cursor + 7]
        )
          throw Error("INVALID_IMAGE");
        dimensions = result(
          "image/jpeg",
          bytes.readUInt16BE(cursor + 5),
          bytes.readUInt16BE(cursor + 3)
        );
      } else if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        ![0xc4, 0xc8, 0xcc].includes(marker)
      )
        throw Error("INVALID_IMAGE");
      cursor += size;
      if (marker === 0xda) {
        if (
          !dimensions ||
          size < 6 ||
          size !== 6 + 2 * bytes[cursor - size + 2]
        )
          throw Error("INVALID_IMAGE");
        scan = true;
        while (cursor < bytes.length) {
          if (bytes[cursor] !== 255) {
            cursor++;
            continue;
          }
          let next = cursor + 1;
          while (bytes[next] === 255) next++;
          if (
            bytes[next] === 0 ||
            (bytes[next] >= 0xd0 && bytes[next] <= 0xd7)
          ) {
            cursor = next + 1;
            continue;
          }
          break;
        }
      }
    }
  }
  throw Error("INVALID_IMAGE");
}
