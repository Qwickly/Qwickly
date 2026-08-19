import { Link } from "wouter";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import logo from "@/assets/Watermark-1.svg";

export default function LandingPage() {
  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-background">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-background to-emerald-500/5" />
      <motion.div
        className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[32rem] h-[32rem] rounded-full bg-primary/10 blur-3xl"
        animate={{ scale: [1, 1.06, 1], opacity: [0.5, 0.7, 0.5] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
      />

      <motion.div
        className="relative z-10 flex flex-col items-center gap-14"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <img src={logo} alt="Qwickly" className="h-20 w-auto drop-shadow-xl" />

        <div className="flex flex-col sm:flex-row gap-4 w-64 sm:w-auto">
          <Link href="/login" className="w-full sm:w-44">
            <Button
              size="lg"
              className="w-full h-12 text-base font-semibold shadow-lg shadow-primary/20"
            >
              Log in
            </Button>
          </Link>
          <Link href="/signup" className="w-full sm:w-44">
            <Button
              size="lg"
              variant="outline"
              className="w-full h-12 text-base font-semibold bg-card border-border/80 hover:bg-card"
            >
              Sign up
            </Button>
          </Link>
        </div>
      </motion.div>
    </div>
  );
}
