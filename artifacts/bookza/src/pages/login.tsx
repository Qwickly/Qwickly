import { useState } from "react";
import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { GuestRoute } from "@/components/auth/GuestRoute";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { ONBOARDING_MIGRATION_FILE, resolvePostAuthPath } from "@/lib/onboarding";
import { ArrowRight, Calendar, Loader2, Lock, Mail, MessageCircle } from "lucide-react";

function LoginForm() {
  const [, setLocation] = useLocation();
  const { signIn, resetPassword } = useAuth();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    const { error } = await signIn(email, password);
    setIsLoading(false);

    if (error) {
      toast({
        title: "Sign in failed",
        description: error,
        variant: "destructive",
      });
      return;
    }

    try {
      const { path, migrationRequired } = await resolvePostAuthPath();
      if (migrationRequired) {
        toast({
          title: "Database migration required",
          description: `Run ${ONBOARDING_MIGRATION_FILE} in the Supabase SQL Editor to enable first-login setup.`,
          variant: "destructive",
        });
      }
      setLocation(path);
    } catch (err) {
      toast({
        title: "Could not continue after sign in",
        description: err instanceof Error ? err.message : "Please try again",
        variant: "destructive",
      });
    }
  };

  const onForgotPassword = async () => {
    if (!email) {
      toast({
        title: "Enter your email",
        description: "Type your email address first, then click forgot password.",
        variant: "destructive",
      });
      return;
    }

    const { error } = await resetPassword(email);
    if (error) {
      toast({ title: "Could not send reset email", description: error, variant: "destructive" });
      return;
    }

    toast({
      title: "Check your email",
      description: "We sent you a password reset link.",
    });
  };

  return (
    <AuthLayout
      panelTitle="Run your business from one place"
      panelDescription="Bookings, payments, WhatsApp reminders, and analytics — built for South African service businesses."
      panelHighlights={[
        {
          title: "WhatsApp Automation",
          description: "Cut no-shows with smart reminders.",
          icon: <MessageCircle className="w-5 h-5" />,
        },
        {
          title: "Smart Scheduling",
          description: "Calendar, staff, and services in sync.",
          icon: <Calendar className="w-5 h-5" />,
        },
      ]}
    >
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Welcome back</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in to your inCheck account
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-5">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email address</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="name@business.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10 h-11 bg-muted/40 border-border/60 focus-visible:ring-primary/30"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <button
                  type="button"
                  onClick={onForgotPassword}
                  className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 h-11 bg-muted/40 border-border/60 focus-visible:ring-primary/30"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center">
            <Checkbox id="remember-me" defaultChecked />
            <label htmlFor="remember-me" className="ml-2 text-sm text-muted-foreground">
              Remember me for 30 days
            </label>
          </div>

          <Button type="submit" className="w-full h-11 text-base font-semibold shadow-md shadow-primary/20" disabled={isLoading}>
            {isLoading ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : null}
            Sign in
          </Button>
        </form>

        <p className="mt-8 text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="font-semibold text-primary hover:text-primary/80 inline-flex items-center gap-1 transition-colors">
            Sign up <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </p>
      </motion.div>
    </AuthLayout>
  );
}

export default function LoginPage() {
  return (
    <GuestRoute>
      <LoginForm />
    </GuestRoute>
  );
}
