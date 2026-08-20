import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { InternalPageNavItem } from "@/components/layout/internal-page-nav";

export type PageChromeInternalNav = {
  items: InternalPageNavItem[];
  active: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
};

export type PageChromeBreadcrumb = {
  label: string;
  href?: string;
  /**
   * For a crumb whose parent is the SAME route in a different state — the
   * WhatsApp inbox with no chat open, say. An href there would be a link to the
   * page you are already on, which navigates and changes nothing.
   */
  onClick?: () => void;
};

export type PageChromeState = {
  breadcrumbs?: PageChromeBreadcrumb[];
  internalNav?: PageChromeInternalNav;
};

type PageChromeContextValue = {
  chrome: PageChromeState;
  setChrome: Dispatch<SetStateAction<PageChromeState>>;
};

const PageChromeContext = createContext<PageChromeContextValue | null>(null);

export function PageChromeProvider({ children }: { children: ReactNode }) {
  const [chrome, setChrome] = useState<PageChromeState>({});
  const value = useMemo(() => ({ chrome, setChrome }), [chrome]);

  return (
    <PageChromeContext.Provider value={value}>
      {children}
    </PageChromeContext.Provider>
  );
}

export function usePageChromeContext() {
  const context = useContext(PageChromeContext);
  if (!context) {
    throw new Error("usePageChromeContext must be used within PageChromeProvider");
  }
  return context;
}

export function usePageChrome(config: PageChromeState) {
  const { setChrome } = usePageChromeContext();

  useEffect(() => {
    setChrome((current) => ({ ...current, ...config }));
    return () =>
      setChrome((current) => {
        const next = { ...current };
        if (config.breadcrumbs) delete next.breadcrumbs;
        if (config.internalNav) delete next.internalNav;
        return next;
      });
  }, [config, setChrome]);
}
