import { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { TopNav } from "./TopNav";

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/20 flex flex-col md:flex-row">
      <Sidebar />
      <div className="flex-1 md:pl-64 flex flex-col min-h-screen relative">
        <TopNav />
        <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
          {children}
        </main>
      </div>
    </div>
  );
}
