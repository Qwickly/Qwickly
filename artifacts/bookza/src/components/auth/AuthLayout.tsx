import { Link } from "wouter";
import { motion } from "framer-motion";
import type { ReactNode } from "react";
import logo from "@/assets/inCheck-logomark.svg";

type AuthLayoutProps = {
  children: ReactNode;
  panelTitle: string;
  panelDescription: string;
  panelHighlights?: { title: string; description: string; icon: ReactNode }[];
};

export function AuthLayout({
  children,
  panelTitle,
  panelDescription,
  panelHighlights,
}: AuthLayoutProps) {
  return (
    <div className="min-h-screen w-full flex bg-background">
      <div className="flex-1 flex flex-col justify-center px-6 sm:px-10 lg:flex-none lg:w-[480px] xl:w-[520px] lg:px-16">
        <div className="mx-auto w-full max-w-sm">
          <Link href="/">
            <motion.div
              className="mb-8 cursor-pointer inline-block"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.98 }}
            >
              <img src={logo} alt="inCheck" className="h-7 w-auto" />
            </motion.div>
          </Link>
          {children}
        </div>
      </div>

      <div className="hidden lg:flex flex-1 relative overflow-hidden bg-muted">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-emerald-500/5 to-teal-600/20" />
        <motion.div
          className="absolute -top-24 -right-24 w-[28rem] h-[28rem] rounded-full bg-primary/30 blur-3xl"
          animate={{ scale: [1, 1.08, 1], opacity: [0.4, 0.55, 0.4] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute bottom-0 left-1/4 w-80 h-80 rounded-full bg-emerald-400/20 blur-3xl"
          animate={{ scale: [1, 1.12, 1], opacity: [0.3, 0.45, 0.3] }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 1 }}
        />

        <div className="relative w-full h-full flex flex-col items-center justify-center p-16">
          <div className="max-w-lg space-y-10">
            <div className="space-y-4">
              <h3 className="text-4xl font-bold tracking-tight text-foreground leading-tight">
                {panelTitle}
              </h3>
              <p className="text-lg text-muted-foreground leading-relaxed">
                {panelDescription}
              </p>
            </div>

            {panelHighlights && panelHighlights.length > 0 && (
              <div className="grid gap-4">
                {panelHighlights.map((item, i) => (
                  <motion.div
                    key={item.title}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.2 + i * 0.1 }}
                    className="bg-card/80 backdrop-blur-sm p-5 rounded-2xl flex items-center gap-4 text-left shadow-lg border border-border/50"
                  >
                    <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
                      {item.icon}
                    </div>
                    <div>
                      <h4 className="font-semibold text-foreground">{item.title}</h4>
                      <p className="text-sm text-muted-foreground mt-0.5">{item.description}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}

            <div className="rounded-2xl border border-border/50 bg-card/60 backdrop-blur-md p-6 shadow-2xl">
              <div className="h-3 w-24 bg-muted rounded-full mb-4" />
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="h-20 rounded-xl bg-primary/15" />
                <div className="h-20 rounded-xl bg-emerald-500/10" />
                <div className="h-20 rounded-xl bg-teal-500/10" />
              </div>
              <div className="h-32 rounded-xl bg-muted/50 border border-border/30" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
