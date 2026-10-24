/* eslint-env jest */
const {imageUrl, loadNotionImage, normalizeImageFile} = require("./notionImages");
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFzQAAAAASUVORK5CYII=";
const originalFetch = global.fetch;
const originalImage = global.Image;
const originalAbortController = global.AbortController;

beforeEach(() => {
  global.fetch = jest.fn();
  global.AbortController = class {
    constructor() {
      this.signal = {aborted: false};
    }
    abort() {
      this.signal.aborted = true;
    }
  };
  global.Image = class {
    constructor() {
      this.naturalWidth = 1;
      this.naturalHeight = 1;
    }
    set src(value) {
      if (value) this.onload();
    }
  };
  jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ({drawImage: jest.fn()}));
  jest.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(PNG);
});
afterEach(() => {
  jest.restoreAllMocks();
  global.fetch = originalFetch;
  global.Image = originalImage;
  global.AbortController = originalAbortController;
});

test("limits image sources to data images and public HTTPS URLs", () => {
  expect(imageUrl(PNG)).toBe(PNG);
  expect(imageUrl("https://example.com/image.png")).toBe("https://example.com/image.png");
  for (const url of [
    "javascript:alert(1)",
    "data:image/svg+xml,<svg/>",
    "http://example.com/a.png",
    "https://localhost/a.png",
    "https://127.0.0.1/a.png",
    "https://10.2.3.4/a.png",
    "https://192.168.1.1/a.png",
    "https://172.16.0.1/a.png",
    "https://[::1]/a.png",
    "https://example.com:123/a.png",
    "https://a:b@example.com/a.png",
  ]) {
    expect(() => imageUrl(url)).toThrow();
  }
});

test("decodes an embedded image locally without network requests", async () => {
  await expect(loadNotionImage(PNG)).resolves.toBe(PNG);
  expect(global.fetch).not.toHaveBeenCalled();
  await expect(loadNotionImage("data:image/png;base64,%%bad%%")).rejects.toThrow("内嵌图片无效");
});

test("fetches remote images without credentials and converts them in the browser", async () => {
  global.fetch.mockResolvedValue({
    ok: true,
    headers: {get: () => null},
    body: null,
    blob: async () => new Blob([Uint8Array.from(atob(PNG.split(",")[1]), (c) => c.charCodeAt(0))], {type: "image/png"}),
  });
  await expect(loadNotionImage("https://example.com/image.png")).resolves.toBe(PNG);
  expect(global.fetch.mock.calls[0][1]).toMatchObject({
    mode: "cors",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    redirect: "error",
  });
  expect(global.fetch.mock.calls[0][1].headers).toBeUndefined();
});

test("rejects oversized downloads before decoding and propagates CORS failures", async () => {
  global.fetch.mockResolvedValue({ok: true, headers: {get: () => String(11 * 1024 * 1024)}});
  await expect(loadNotionImage("https://example.com/image.png")).rejects.toThrow("10 MB");
  global.fetch.mockRejectedValue(new TypeError("CORS"));
  await expect(loadNotionImage("https://example.com/image.png")).rejects.toThrow("CORS");
});

test("downloads SVG and converts it to PNG", async () => {
  const source =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20"><text>半圆</text><path d="M0 0L30 20"/></svg>';
  global.fetch.mockResolvedValue({
    ok: true,
    headers: {get: () => null},
    body: null,
    blob: async () => new Blob([source], {type: "image/svg+xml;charset=utf-8"}),
  });
  const result = await loadNotionImage("https://example.com/diagram.svg");
  expect(result).toBe(PNG);
  expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledWith("image/png");
});

test("accepts embedded SVG, sanitizes it and validates its display dimensions", async () => {
  const source =
    '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="20" onload="alert(1)"><text>中文</text></svg>';
  const input = "data:image/svg+xml;base64," + Buffer.from(source).toString("base64");
  const result = await loadNotionImage(input);
  expect(result).toBe(PNG);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledWith("image/png");
  global.Image = class {
    constructor() {
      this.naturalWidth = 100000;
      this.naturalHeight = 100000;
    }
    set src(value) {
      if (value) this.onload();
    }
  };
  await expect(loadNotionImage(input)).rejects.toThrow("尺寸过大");
});

test("preserves every supported format without flattening animated images", async () => {
  for (const type of ["bmp", "png", "jpeg", "jpg", "gif", "webp"]) {
    const input = "data:image/" + type + ";base64,YWJj";
    // eslint-disable-next-line no-await-in-loop
    expect(await loadNotionImage(input)).toBe(input);
  }
  expect(HTMLCanvasElement.prototype.toDataURL).not.toHaveBeenCalled();
});

test("converts other decodable formats with matching PNG filename and MIME", async () => {
  const file = await normalizeImageFile(new File(["avif"], "diagram.avif", {type: "image/avif"}));
  expect(file.name).toBe("diagram.png");
  expect(file.type).toBe("image/png");
});

test("rejects undecodable images instead of passing the original through", async () => {
  global.Image = class {
    set src(value) {
      if (value) this.onerror();
    }
  };
  await expect(normalizeImageFile(new File(["bad"], "diagram.heic", {type: "image/heic"}))).rejects.toThrow("无法解码");
});
