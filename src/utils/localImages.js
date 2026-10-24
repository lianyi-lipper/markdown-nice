import {LOCAL_IMAGES} from "./constant";

export const LOCAL_IMAGE_PROTOCOL = "mdnice-local-image";

const memoryImages = {};

const readImages = () => {
  try {
    return {
      ...(JSON.parse(window.localStorage.getItem(LOCAL_IMAGES)) || {}),
      ...memoryImages,
    };
  } catch (e) {
    return memoryImages;
  }
};

const writeImages = (images) => {
  try {
    window.localStorage.setItem(LOCAL_IMAGES, JSON.stringify(images));
  } catch (e) {
    // Large pasted images can exceed localStorage quota; keep them available in memory for the current session.
  }
};

export const createLocalImageId = () =>
  `img-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

export const localImageUrl = (id) => `${LOCAL_IMAGE_PROTOCOL}://${id}`;

export const saveLocalImage = ({id, dataUrl, filename = ""}) => {
  const images = readImages();
  const image = {
    dataUrl,
    filename,
    updatedAt: Date.now(),
  };
  memoryImages[id] = image;
  images[id] = image;
  writeImages(images);
};

export const getLocalImage = (id) => readImages()[id];

export const resolveLocalImages = (text = "") =>
  text.replace(new RegExp(`${LOCAL_IMAGE_PROTOCOL}://([A-Za-z0-9_-]+)`, "g"), (match, id) => {
    const image = getLocalImage(id);
    return image && image.dataUrl ? image.dataUrl : match;
  });
