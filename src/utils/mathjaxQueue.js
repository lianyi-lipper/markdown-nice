// Both the article and cover editor use the same MathJax instance. MathJax 3
// requires asynchronous conversions/typesetting to run sequentially.
let pending = Promise.resolve();

const withMathjax = (task) => {
  const result = pending.then(async () => {
    const mathjax = window.MathJax;
    if (!mathjax || !mathjax.startup) throw new Error("公式渲染器尚未就绪，请稍后重试。");
    await mathjax.startup.promise;
    return task(mathjax);
  });
  pending = result.catch(() => {});
  return result;
};

export default withMathjax;
