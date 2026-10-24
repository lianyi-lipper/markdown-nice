const COVER_DRAFT_KEY = "nice-cover-draft-v1";
const COVER_HEIGHT = 400;
const COVER_WIDTHS = {wide: 940, square: 400};
const COVER_PIXEL_RATIO = 2;

function createCoverDraft(text = "") {
  const common = {text, lineHeight: 1.5, padding: 28, align: "left", vertical: "center", imageWidth: 100};
  return {
    version: 1,
    wide: {...common, fontSize: 32},
    square: {...common, fontSize: 24},
    images: {},
  };
}

function bounded(value, fallback, min, max) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function normalizeCoverDraft(source) {
  const result = createCoverDraft();
  if (!source || source.version !== 1) return result;
  ["wide", "square"].forEach((key) => {
    const panel = source[key] || {};
    const defaults = result[key];
    result[key] = {
      text: typeof panel.text === "string" ? panel.text.slice(0, 2000000) : "",
      fontSize: bounded(panel.fontSize, defaults.fontSize, 12, 72),
      lineHeight: bounded(panel.lineHeight, defaults.lineHeight, 1, 2.5),
      padding: bounded(panel.padding, defaults.padding, 0, 80),
      imageWidth: bounded(panel.imageWidth, defaults.imageWidth, 10, 100),
      align: ["left", "center", "right"].includes(panel.align) ? panel.align : defaults.align,
      vertical: ["top", "center", "bottom"].includes(panel.vertical) ? panel.vertical : defaults.vertical,
    };
  });
  const text = result.wide.text + "\n" + result.square.text;
  Object.keys(source.images || {}).forEach((id) => {
    const data = source.images[id];
    if (/^[a-z\d-]+$/i.test(id) && text.includes(`cover-image://${id}`) && typeof data === "string") {
      result.images[id] = data;
    }
  });
  return result;
}

function resolveCoverImages(text, images) {
  return text.replace(/cover-image:\/\/([a-z\d-]+)/gi, (url, id) => {
    if (!images[id]) throw new Error("题目图片已丢失，请重新粘贴或插入图片。");
    return images[id];
  });
}

module.exports = {
  COVER_DRAFT_KEY,
  COVER_HEIGHT,
  COVER_WIDTHS,
  COVER_PIXEL_RATIO,
  createCoverDraft,
  normalizeCoverDraft,
  resolveCoverImages,
};
