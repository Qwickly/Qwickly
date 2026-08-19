import { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { SidebarProvider, useSidebar } from "../ui/sidebar";
import { TopNav } from "./TopNav";
import { PageChromeProvider } from "./page-chrome";

/**
 * The desktop sidebar floats: inset 0.75rem from the left edge, 15rem wide
 * expanded and 3.5rem collapsed, with the same 0.75rem of air on its right. The
 * content's offset is that sum, and it has to be a literal — Tailwind scans for
 * complete class names, so a computed `md:pl-[${x}rem]` never reaches the
 * stylesheet.
 */
const CONTENT_OFFSET = {
  expanded: "md:pl-[16.5rem]",
  collapsed: "md:pl-[5rem]",
} as const;

/**
 * Reads the cookie `SidebarProvider` writes, so a collapsed rail survives a
 * reload.
 *
 * The provider persists the state but seeds itself from `defaultOpen`, which it
 * expects a server render to supply. There is no server render here, so without
 * this the panel springs back open on every page load and the cookie is written
 * but never read.
 */
function storedSidebarOpen() {
  if (typeof document === "undefined") return true;
  return !/(?:^|;\s*)sidebar_state=false(?:;|$)/.test(document.cookie);
}

/** Split out because the offset needs `useSidebar`, which the provider above it owns. */
function AppShell({ children }: { children: ReactNode }) {
  const { open } = useSidebar();

  return (
    // `--brand-backdrop` rather than `bg-background`, and it does real work:
    // `--card` and `--background` are the same colour in both themes, so on a
    // flat page every card depended on its border alone to say where it ended.
    // See the note on the token in index.css.
    <div
      className="flex h-screen w-full flex-col overflow-hidden text-foreground md:flex-row"
      style={{ background: "var(--brand-backdrop)" }}
    >
      <Sidebar />
      <div
        className={`relative flex h-screen flex-1 flex-col transition-[padding] duration-200 ${
          open ? CONTENT_OFFSET.expanded : CONTENT_OFFSET.collapsed
        }`}
      >
        <TopNav />
        <main className="w-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-6">
          {children}
        </main>
      </div>
    </div>
  );
}

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider defaultOpen={storedSidebarOpen()}>
      <PageChromeProvider>
        <AppShell>{children}</AppShell>
      </PageChromeProvider>
    </SidebarProvider>
  );
}
