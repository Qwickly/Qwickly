// Reveals the "operating system" section mockup with a staggered entry
// animation the first time it scrolls into view. Base state is the finished
// look, so the mock still reads fine if this never runs.
(() => {
  const mocks = document.querySelectorAll("[data-os-mock]");
  if (!mocks.length) return;

  if (!("IntersectionObserver" in window)) {
    mocks.forEach((m) => m.classList.add("is-inview"));
    return;
  }

  const io = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-inview");
        obs.unobserve(entry.target);
      });
    },
    { threshold: 0.3, rootMargin: "0px 0px -10% 0px" },
  );

  mocks.forEach((m) => io.observe(m));
})();
