import { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { SidebarProvider } from "../ui/sidebar";
import { TopNav } from "./TopNav";

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <div className="w-full h-screen bg-muted/20 flex flex-col md:flex-row overflow-hidden">
        <Sidebar />
        <div className="flex-1 md:pl-64 flex flex-col h-screen relative">
          <TopNav />
          <main className="flex-1 p-6 w-full overflow-y-auto">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}
