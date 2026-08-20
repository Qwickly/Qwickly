import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";

/**
 * A small persistent way back to /help for anyone who arrived at this page from
 * a tutorial. Deliberately decoupled from TourOverlay's own state — it should
 * stay visible for the whole page visit even if the user hits Skip on the tour
 * itself, since most people won't think to find their way back through the
 * sidebar on their own.
 */
export function BackToHelpLink() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tour")) {
      setShow(true);
    }
  }, []);

  if (!show) return null;

  return (
    <Link
      href="/help"
      className="fixed bottom-5 left-5 z-[90] flex items-center gap-1.5 rounded-full border border-border/60 bg-popover px-3.5 py-2 text-xs font-semibold text-foreground shadow-lg transition-colors hover:bg-muted/60"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      Back to tutorials
    </Link>
  );
}
