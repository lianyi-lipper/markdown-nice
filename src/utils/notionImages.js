/* No proxy, image hosting, cookies, or Notion tokens are used for images. */
const {sanitizeNotionSvg} = require("./notionSvg");

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40000000;
const DATA_IMAGE = /^data:image\/[a-z0-9.+-]+;base64,/i;
const SUPPORTED_TYPE = /^image\/(bmp|x-ms-bmp|png|jpeg|jpg|gif|webp)(?:;|$)/i;
const SVG_TYPE = /^image\/svg\+xml(?:;|$)/i;

function imageUrl(value) {
  if (DATA_IMAGE.test(value)) return value;
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error("图片地址无效，请使用 HTTPS 图片或内嵌图片。");
  }
  const host = url.hostname.toLowerCase();
  const parts = host.split(".").map(Number);
  const ipv4 = parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255);
  const privateAddress =
    ipv4 &&
    (parts[0] === 0 ||
      parts[0] === 10 ||
      parts[0] === 127 ||
      parts[0] >= 224 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && (parts[1] === 0 || parts[1] === 168)) ||
      (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) ||
      (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127));
  const localHost =
    privateAddress ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    !host.includes(".") ||
    host.startsWith("[");
  if (url.protocol !== "https:" || url.username || url.password || url.port || localHost) {
    throw new Error("图片地址必须是公网 HTTPS 链接。");
  }
  return url.href;
}

function readBlob(blob, asText = false) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("无法读取图片文件。"));
    if (asText) reader.readAsText(blob);
    else reader.readAsDataURL(blob);
  });
}

async function readImageBytes(response) {
  if (Number(response.headers.get("content-length")) > MAX_IMAGE_BYTES) {
    throw new Error("单张图片不能超过 10 MB。");
  }
  if (!response.body || !response.body.getReader) {
    const blob = await response.blob();
    if (blob.size > MAX_IMAGE_BYTES) throw new Error("单张图片不能超过 10 MB。");
    return blob;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      // A streaming reader must consume chunks in order and enforce the size cap.
      // eslint-disable-next-line no-await-in-loop
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES) {
        // eslint-disable-next-line no-await-in-loop
        await reader.cancel();
        throw new Error("单张图片不能超过 10 MB。");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Blob(chunks, {type: response.headers.get("content-type") || "application/octet-stream"});
}

function decodeImage(dataUrl, preserve = false) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => {
      image.src = "";
      reject(new Error("图片解码超时。"));
    }, 15000);
    image.onerror = () => {
      clearTimeout(timer);
      reject(new Error("浏览器无法解码此图片，请先将其转换为 PNG、JPEG、BMP、GIF 或 WebP。"));
    };
    image.onload = () => {
      clearTimeout(timer);
      if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > MAX_IMAGE_PIXELS) {
        reject(new Error("图片尺寸过大或无效。"));
        return;
      }
      if (preserve) {
        resolve(dataUrl);
        return;
      }
      try {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext("2d").drawImage(image, 0, 0);
        const result = canvas.toDataURL("image/png");
        if (result.length * 0.75 > MAX_IMAGE_BYTES) throw new Error("转换后的图片不能超过 10 MB。");
        resolve(result);
      } catch (error) {
        reject(new Error("图片无法保存到浏览器，请检查图片格式与大小。"));
      }
    };
    image.src = dataUrl;
  });
}

async function convertSvg(blob) {
  const clean = sanitizeNotionSvg(await readBlob(blob, true));
  const sanitized = new Blob([clean], {type: "image/svg+xml"});
  if (sanitized.size > MAX_IMAGE_BYTES) throw new Error("SVG 图片不能超过 10 MB。");
  return decodeImage(await readBlob(sanitized));
}

async function normalizeImageBlob(blob) {
  if (blob.size > MAX_IMAGE_BYTES) throw new Error("单张图片不能超过 10 MB。");
  if (SVG_TYPE.test(blob.type)) return convertSvg(blob);
  if (!/^image\//i.test(blob.type)) throw new Error("请选择图片文件。");
  return decodeImage(await readBlob(blob), SUPPORTED_TYPE.test(blob.type));
}

async function normalizeImageFile(file) {
  const dataUrl = await normalizeImageBlob(file);
  const type = dataUrl.slice(5, dataUrl.indexOf(";"));
  const extension = type
    .split("/")[1]
    .replace("x-ms-bmp", "bmp")
    .replace("jpeg", "jpg");
  const stem = (file.name || "image").replace(/\.[^.]+$/, "");
  const bytes = Uint8Array.from(atob(dataUrl.split(",")[1]), (char) => char.charCodeAt(0));
  return new File([bytes], stem + "." + extension, {type, lastModified: file.lastModified});
}

async function loadNotionImage(value) {
  const src = imageUrl(value);
  if (src.startsWith("data:")) {
    const data = src.slice(src.indexOf(",") + 1);
    if (data.length * 0.75 > MAX_IMAGE_BYTES || !/^[a-z\d+/]*={0,2}$/i.test(data)) {
      throw new Error("内嵌图片无效或超过 10 MB。");
    }
    if (/^data:image\/svg\+xml;/i.test(src)) {
      const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
      return convertSvg(new Blob([bytes], {type: "image/svg+xml"}));
    }
    return decodeImage(src, SUPPORTED_TYPE.test(src.slice(5, src.indexOf(";"))));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(src, {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("图片读取失败。");
    const blob = await readImageBytes(response);
    return await normalizeImageBlob(blob);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {loadNotionImage, imageUrl, normalizeImageBlob, normalizeImageFile};
