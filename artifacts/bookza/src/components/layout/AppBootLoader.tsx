/**
 * The boot loader, React side.
 *
 * Deliberately identical to the one index.html paints before the bundle
 * arrives — same markup, same class names, same rules (see the mirrored block
 * at the bottom of index.css). The HTML loader lives inside `#root`, so React's
 * first render replaces it; if what renders next looks like anything else, the
 * handoff reads as a glitch. It used to hand off to a spinner, and the jump
 * from three drifting dots to a spinning ring was the most visible moment in
 * the whole boot.
 *
 * The dots restart their wave when these elements mount, since they are new
 * nodes with a fresh animation. That is a half-beat of rhythm, not a change of
 * subject, and it is the one part of the seam that cannot be closed without
 * React adopting the existing DOM.
 */
export function AppBootLoader({
  /**
   * For a guard that runs INSIDE the app shell rather than in front of it.
   * The default is a fixed full-screen cover, which is right for the auth
   * guards — they render before there is any chrome to preserve — and wrong for
   * anything that would black out a sidebar the reader is already looking at.
   */
  inline = false,
  label = "Loading",
}: { inline?: boolean; label?: string } = {}) {
  return (
    <div
      className={inline ? "app-boot app-boot--inline" : "app-boot"}
      role="status"
      aria-label={label}
    >
      {/* Decoration: the accessible name is on the parent, and three
          indistinguishable spans have nothing to add to it. */}
      <div className="app-boot-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
