const {loadNotionImage} = require("./notionImages");

// Work on the copied HTML only; retain the editor's original image sources.
async function compatibleImages(html) {
  const root = document.createElement("div");
  root.innerHTML = html;
  const cache = new Map();
  await Promise.all(
    Array.from(root.querySelectorAll("img[src]")).map(async (image) => {
      const src = image.getAttribute("src");
      if (!src) return;
      const supportedData = /^data:image\/(bmp|x-ms-bmp|png|jpeg|jpg|gif|webp);/i.test(src);
      const supportedUrl = /^https?:\/\//i.test(src) && /\.(bmp|png|jpeg|jpg|gif|webp)(?:[?#]|$)/i.test(src);
      if (!supportedData && !supportedUrl) {
        if (!cache.has(src)) cache.set(src, loadNotionImage(src));
        image.setAttribute("src", await cache.get(src));
      }
      image.removeAttribute("srcset");
      image.removeAttribute("sizes");
    }),
  );
  return root.innerHTML;
}

module.exports = {compatibleImages};
