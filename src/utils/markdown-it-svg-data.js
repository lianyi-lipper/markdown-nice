// markdown-it's default image data-URL list excludes SVG. Imported SVG is
// sanitized before storage, then rendered as an inert <img> rather than inline DOM.
module.exports = function svgDataImages(md) {
  const {validateLink} = md;
  md.validateLink = (url) => /^data:image\/svg\+xml;base64,[a-z\d+/]+={0,2}$/i.test(url) || validateLink(url);
};
