/* eslint-env jest */
const {compatibleImages} = require("./compatibleImages");
const {loadNotionImage} = require("./notionImages");

jest.mock("./notionImages", () => ({loadNotionImage: jest.fn()}));

beforeEach(() => loadNotionImage.mockReset());

test("converts existing SVG once and preserves image layout", async () => {
  loadNotionImage.mockResolvedValue("data:image/png;base64,YQ==");
  const src = "https://example.com/diagram.svg";
  const result = await compatibleImages(
    `<img src="${src}" width="300" alt="图" srcset="other.svg 2x"><img src="${src}">`,
  );
  expect(loadNotionImage).toHaveBeenCalledTimes(1);
  expect(result).not.toContain(".svg");
  expect(result).not.toContain("srcset");
  expect(result).toContain('width="300"');
  expect(result).toContain('alt="图"');
});

test("keeps supported images including GIF untouched", async () => {
  const html = '<img src="https://example.com/a.GIF?version=2"><img src="data:image/bmp;base64,YQ==">';
  expect(await compatibleImages(html)).toBe(html);
  expect(loadNotionImage).not.toHaveBeenCalled();
});

test("fails the copy when conversion fails", async () => {
  loadNotionImage.mockRejectedValue(new Error("CORS"));
  await expect(compatibleImages('<img src="https://example.com/a.svg">')).rejects.toThrow("CORS");
});
