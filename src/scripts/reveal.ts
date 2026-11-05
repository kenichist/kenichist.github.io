/**
 * One-shot section reveal. Elements already in view are marked revealed before
 * the hiding class is applied, so nothing flashes and nothing hides without JS.
 * Each element reveals once and is then unobserved — no replay on scroll-back.
 */
export function enhanceReveals(): void {
  if (!('IntersectionObserver' in window)) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const items = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
  if (!items.length) return;

  const vh = window.innerHeight;
  const pending: HTMLElement[] = [];
  for (const el of items) {
    const r = el.getBoundingClientRect();
    if (r.top < vh && r.bottom > 0) el.classList.add('is-revealed');
    else pending.push(el);
  }
  if (!pending.length) return;

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-revealed');
        io.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -10% 0px' },
  );
  pending.forEach((el) => io.observe(el));
  document.documentElement.classList.add('reveal-ready');
}
