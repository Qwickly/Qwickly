import { useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { KeyRound, Loader2 } from "lucide-react";

export default function StaffSetPasswordPage() {
  const [, setLocation] = useLocation();
  const [isLoading, setIsLoading] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password.length < 8) {
      toast.error("Password too short", { description: "Use at least 8 characters." });
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Passwords don't match");
      return;
    }

    setIsLoading(true);
    const { error } = await supabase.auth.updateUser({
      password,
      data: { must_change_password: false },
    });
    setIsLoading(false);

    if (error) {
      toast.error("Could not set password", { description: error.message });
      return;
    }

    toast("Password set", { description: "You're all set." });
    setLocation("/staff/bookings");
  };

  return (
    <AuthLayout
      panelTitle="One more step"
      panelDescription="Set your own password to finish securing your account."
      panelHighlights={[
        {
          title: "Keep it private",
          description: "Choose a password only you know.",
          icon: <KeyRound className="w-5 h-5" />,
        },
      ]}
    >
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Set your password</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You signed in with a temporary password — choose a new one to continue.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="password">New password</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm password</Label>
            <Input
              id="confirmPassword"
              type="password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="h-11"
            />
          </div>

          <Button
            type="submit"
            className="w-full h-11 text-base font-semibold shadow-md shadow-primary/20"
            disabled={isLoading}
          >
            {isLoading ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : null}
            Continue
          </Button>
        </form>
      </motion.div>
    </AuthLayout>
  );
}
