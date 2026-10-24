/* eslint-env jest */
const {
  createCoverDraft,
  normalizeCoverDraft,
  resolveCoverImages,
  COVER_WIDTHS,
  COVER_HEIGHT,
  COVER_PIXEL_RATIO,
} = require("./coverDraft");

test("cover frames keep exact ratios at the PNG resolution", () => {
  expect(COVER_WIDTHS.wide / COVER_HEIGHT).toBe(2.35);
  expect(COVER_WIDTHS.square / COVER_HEIGHT).toBe(1);
  expect((COVER_WIDTHS.wide + COVER_WIDTHS.square) * COVER_PIXEL_RATIO).toBe(2680);
  expect(COVER_HEIGHT * COVER_PIXEL_RATIO).toBe(800);
});

test("the two editable drafts do not share content or formatting state", () => {
  const draft = createCoverDraft("原题 $x^2$");
  draft.wide.text = "横版修改";
  draft.wide.fontSize = 40;
  expect(draft.square.text).toBe("原题 $x^2$");
  expect(draft.square.fontSize).toBe(24);
});

test("draft roundtrip preserves independent layouts and only referenced images", () => {
  const draft = createCoverDraft("![](cover-image://img-1)");
  draft.wide.padding = 50;
  draft.square.text = "方版 $a<b$";
  draft.square.align = "center";
  draft.images = {"img-1": "data:image/png;base64,aGVsbG8=", unused: "large unused image"};
  const restored = normalizeCoverDraft(JSON.parse(JSON.stringify(draft)));
  expect(restored.wide.padding).toBe(50);
  expect(restored.square.text).toBe("方版 $a<b$");
  expect(restored.square.align).toBe("center");
  expect(restored.images).toEqual({"img-1": draft.images["img-1"]});
});

test("invalid saved settings cannot create broken or unlimited-size canvases", () => {
  const draft = normalizeCoverDraft({
    version: 1,
    wide: {fontSize: 10000, padding: -20, lineHeight: null, align: "bad"},
    square: {text: 12},
  });
  expect(draft.wide.fontSize).toBe(72);
  expect(draft.wide.padding).toBe(0);
  expect(draft.wide.lineHeight).toBe(1.5);
  expect(draft.wide.align).toBe("left");
  expect(draft.square.text).toBe("");
  expect(normalizeCoverDraft({version: 999})).toEqual(createCoverDraft());
});

test("missing image references fail explicitly instead of exporting empty areas", () => {
  expect(() => resolveCoverImages("![](cover-image://lost)", {})).toThrow("图片已丢失");
  expect(resolveCoverImages("![](cover-image://img-1)", {"img-1": "data:image/png;base64,abc"})).toBe(
    "![](data:image/png;base64,abc)",
  );
});
