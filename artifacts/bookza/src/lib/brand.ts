/**
 * The marketing site's nav palette, reproduced for the app.
 *
 * `mountApp()` in index.html detaches `assets/qwickly-site.css` before React
 * boots, so none of the marketing classes exist here — these are copies, not
 * shares. Kept as named constants so a diff against the source rules is
 * possible by eye; if the nav is restyled, these are the things to re-copy.
 */

/**
 * The nav bar's gradient, re-laid along a vertical axis for the sidebar.
 *
 * The value lives in index.css as `--brand-nav-vertical` rather than as a
 * literal here, because the panel scopes itself `dark` and the token has to be
 * resolvable from CSS either way. See the note there for why the marketing
 * percentages could not simply be reused on end.
 */
export const NAV_SURFACE_VERTICAL = "var(--brand-nav-vertical)";

/** The same rule's shadow: a soft drop, plus the highlight along its top edge. */
export const NAV_SHADOW = "var(--brand-nav-shadow)";

/**
 * Class sets for a surface wearing {@link NAV_SURFACE_VERTICAL}.
 *
 * The marketing nav has no current page to mark, so `linkActive` is the one
 * thing here without a rule to copy.
 */
export const brandNav = {
  /**
   * Geometry only. The blur that used to be here went with the glass: the
   * surface is an opaque gradient now, and a backdrop-filter under an opaque
   * fill costs a compositing layer to produce nothing visible.
   */
  surface: "rounded-3xl",

  /*
   * Resting → hover → active runs in one direction: dimmer to brighter, always
   * lighter text on a slightly stronger fill. Nothing inverts.
   *
   * The old sidebar ended on a solid `bg-primary` pill with white text, so
   * selecting an item ran light → lighter → suddenly saturated, and moving the
   * pointer off a selected item flipped it back. Tinting the fill instead of
   * filling it keeps the brand colour marking the current page while leaving
   * the label the same white throughout.
   *
   * `inset-ring` rather than `ring`: an outset ring on a pill grows the shape
   * by a pixel on all four sides, which at this scale is visible as the active
   * item sitting slightly proud of its neighbours.
   */
  link: "font-medium text-foreground/70 transition-colors hover:bg-foreground/10 hover:text-foreground",
  linkActive:
    "bg-primary/25 font-semibold text-foreground inset-ring-1 inset-ring-primary/40 hover:bg-primary/30 hover:text-foreground",

  /*
   * Tooltips portal to the body, outside the panel's `dark` scope, so they
   * resolve the page's tokens rather than the sidebar's. That is what we want —
   * a label floating on the page should be dressed like the page.
   */
  tooltip: "bg-primary font-semibold text-primary-foreground",
} as const;
