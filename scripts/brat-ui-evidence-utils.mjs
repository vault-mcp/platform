import { readFile, stat } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";

export const MIN_SCREENSHOT_SIZE_BYTES = 5_000;
export const MIN_SCREENSHOT_WIDTH = 300;
export const MIN_SCREENSHOT_HEIGHT = 180;

export async function inspectScreenshot(screenshotPath) {
  const extension = path.extname(screenshotPath).toLowerCase();
  const result = await stat(screenshotPath).catch(() => null);
  if (!result?.isFile()) {
    return {
      ok: false,
      path: screenshotPath,
      issues: [`missing screenshot: ${screenshotPath}`],
    };
  }

  const buffer = await readFile(screenshotPath);
  const dimensions = imageDimensions(buffer, extension);
  const issues = [];

  if (![".png", ".jpg", ".jpeg"].includes(extension)) {
    issues.push(`must be PNG or JPEG: ${screenshotPath}`);
  }
  if (buffer.length < MIN_SCREENSHOT_SIZE_BYTES) {
    issues.push(`too small to be useful: ${screenshotPath}`);
  }
  if (!dimensions) {
    issues.push(`could not read image dimensions: ${screenshotPath}`);
  } else {
    if (dimensions.width < MIN_SCREENSHOT_WIDTH) {
      issues.push(`image is too narrow (${dimensions.width}px): ${screenshotPath}`);
    }
    if (dimensions.height < MIN_SCREENSHOT_HEIGHT) {
      issues.push(`image is too short (${dimensions.height}px): ${screenshotPath}`);
    }
  }

  return {
    ok: issues.length === 0,
    path: screenshotPath,
    size: buffer.length,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    dimensions,
    issues,
  };
}

export function duplicateScreenshotFailures(items) {
  const byHash = new Map();
  for (const item of items) {
    if (!item.ok || !item.sha256) {
      continue;
    }
    const current = byHash.get(item.sha256) ?? [];
    current.push(item.key);
    byHash.set(item.sha256, current);
  }

  return [...byHash.entries()]
    .filter(([, keys]) => keys.length > 1)
    .map(([hash, keys]) => `duplicate screenshot content for ${keys.join(", ")} (${hash.slice(0, 12)})`);
}

function imageDimensions(buffer, extension) {
  if (extension === ".png") {
    return pngDimensions(buffer);
  }
  if (extension === ".jpg" || extension === ".jpeg") {
    return jpegDimensions(buffer);
  }
  return null;
}

function pngDimensions(buffer) {
  const pngSignature = "89504e470d0a1a0a";
  if (buffer.length < 24 || buffer.subarray(0, 8).toString("hex") !== pngSignature) {
    return null;
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function jpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    offset += 2;

    if (marker === 0xd9 || marker === 0xda) {
      break;
    }
    if (offset + 2 > buffer.length) {
      return null;
    }

    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) {
      return null;
    }

    if (isStartOfFrame(marker)) {
      return {
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5),
      };
    }

    offset += length;
  }

  return null;
}

function isStartOfFrame(marker) {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}
