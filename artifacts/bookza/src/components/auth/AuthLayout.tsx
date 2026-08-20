import { motion } from "framer-motion";
import type { ReactNode } from "react";
import logo from "@/assets/Watermark-1.svg";
import { NAV_SHADOW, NAV_SURFACE_VERTICAL, brandNav } from "@/lib/brand";

/**
 * The field height for sign in and sign up.
 *
 * Named once rather than written out at seven call sites, which is how the two
 * pages drifted apart in the first place. h-10 matches Button's `size="lg"`, so
 * the fields and the submit button below them line up on one rhythm.
 */
export const AUTH_FIELD = "h-10";

/**
 * The product shot's drop. The marketing hero's own shadow (`.product-shell` in
 * qwickly-site.css) re-mixed for a dark panel: same green-tinted second layer,
 * deeper blacks under it because there is no light page to lift it off.
 */
const SHOT_SHADOW =
  "0 48px 110px rgba(2, 12, 9, 0.55), 0 24px 58px rgba(36, 163, 116, 0.22)";

type AuthLayoutProps = {
  children: ReactNode;
};

/**
 * Sign in and sign up.
 *
 * One surface, not two. This was a 50/50 split -- a light form column butted up
 * against a dark showcase column -- and the seam down the middle was the whole
 * problem: it read as two pages sharing a screen. The page is now a single
 * panel wearing the app's own furniture: `--brand-nav-vertical` inset on a
 * `--brand-backdrop` ground, with the sidebar's radius and shadow. That is
 * exactly what AppLayout does with the rail, so signing in is the product's
 * chrome at full size rather than a landing page bolted to it.
 *
 * The columns are 42/58 rather than half each. A form wants about 340px and no
 * more; giving it half a wide monitor strands it in the middle of its own
 * column and starves the screenshot beside it.
 *
 * There is deliberately NO marketing copy on the panel. It used to carry a
 * headline, a paragraph and three feature cards, all of it restating what the
 * form's own heading already says two inches to the left. The product shot is
 * the argument -- the same asset the marketing hero showcases, bled off the
 * right edge so it reads as a window onto something larger rather than a
 * picture pasted on a wall.
 *
 * Scoped `dark` whatever the page theme is, like the sidebar: the gradient is
 * fixed, so everything on it has to resolve against near-black.
 */
export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div
      className="dark min-h-screen w-full p-2 text-foreground sm:p-3"
      style={{ background: "var(--brand-backdrop)" }}
    >
      <div
        className={`relative overflow-hidden ${brandNav.surface}`}
        style={{ background: NAV_SURFACE_VERTICAL, boxShadow: NAV_SHADOW }}
      >
        <div className="grid min-h-[calc(100vh-1rem)] sm:min-h-[calc(100vh-1.5rem)] lg:grid-cols-[42%_58%]">
          <div className="flex flex-col justify-center px-6 py-14 sm:px-10 lg:px-14 xl:px-16">
            <div className="mx-auto w-full max-w-[21rem]">
              {/* Plain <a> (full navigation) so the logo returns to the static
                  marketing homepage, not the SPA's internal landing route. */}
              <a href="/">
                <motion.div
                  className="mb-9 inline-block cursor-pointer"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <img src={logo} alt="Qwickly" className="h-9 w-auto" />
                </motion.div>
              </a>
              {children}
            </div>
          </div>

          <div className="relative hidden lg:block" aria-hidden="true">
            <motion.img
              initial={{ opacity: 0, x: 28 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15, duration: 0.6, ease: "easeOut" }}
              src="/images/dashboard/dashboardUiDesktop.png"
              alt=""
              loading="lazy"
              decoding="async"
              // Between the two extremes it has been: 132% ran nearly edge to
              // edge and became the page rather than the thing the page is
              // showing you; 104% left it looking tentative. This keeps a band
              // of the gradient above and below while giving the shot enough
              // size to actually read, and still breaks the right edge.
              className="absolute top-1/2 left-8 w-[120%] max-w-none -translate-y-1/2 rounded-2xl border border-white/10 xl:left-10"
              style={{ boxShadow: SHOT_SHADOW }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
