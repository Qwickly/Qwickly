import { useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { supabase } from "@/lib/supabase";
import { fetchMyStaffMembership } from "@/lib/staff-portal";
import { useToast } from "@/hooks/use-toast";
import { Calendar, CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react";

export default function StaffLoginPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      setIsLoading(false);
      toast({
        title: "Sign in failed",
        description: error?.message ?? "Please check your email and password.",
        variant: "destructive",
      });
      return;
    }

    try {
      const membership = await fetchMyStaffMembership(data.session.user.id);
      if (!membership) {
        await supabase.auth.signOut();
        toast({
          title: "This account isn't set up as staff",
          description: "Contact your business owner to be added as a staff member.",
          variant: "destructive",
        });
        return;
      }

      const mustChangePassword = Boolean(data.session.user.user_metadata?.must_change_password);
      setLocation(mustChangePassword ? "/staff/set-password" : "/staff/bookings");
    } catch (err) {
      toast({
        title: "Could not sign in",
        description: err instanceof Error ? err.message : "Please try again",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthLayout
      panelTitle="Your schedule, wherever you are"
      panelDescription="Log in to see the bookings assigned to you and keep your day up to date."
      panelHighlights={[
        {
          title: "Your Bookings",
          description: "See every appointment assigned to you.",
          icon: <Calendar className="w-5 h-5" />,
        },
        {
          title: "Mark Complete",
          description: "Update a booking once you've finished it.",
          icon: <CheckCircle2 className="w-5 h-5" />,
        },
      ]}
    >
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Staff sign in</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in with the email and password you were sent.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-5">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email address</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@business.com"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>

          <Button
            type="submit"
            className="w-full h-11 text-base font-semibold shadow-md shadow-primary/20"
            disabled={isLoading}
          >
            {isLoading ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : null}
            Sign in
          </Button>
        </form>

        <p className="mt-8 text-center text-sm text-muted-foreground">
          Not a staff member?{" "}
          <a href="/login" className="font-semibold text-primary hover:text-primary/80 transition-colors">
            Business owner sign in
          </a>
        </p>
      </motion.div>
    </AuthLayout>
  );
}
