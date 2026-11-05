/** Restart the CSS entrance animation (.enter) once the page becomes visible behind an overlay. */
export function replayEntrance(): void {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.querySelectorAll<HTMLElement>('.enter').forEach((el) =>
    el.getAnimations().forEach((a) => {
      a.currentTime = 0;
      a.play();
    }),
  );
}
