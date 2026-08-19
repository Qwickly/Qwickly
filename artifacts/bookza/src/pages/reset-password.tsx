import { useState } from "react";
import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Calendar,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import {
  ONBOARDING_MIGRATION_FILE,
  resolvePostLoginPath,
} from "@/lib/onboarding";

function ResetPasswordForm() {
  const [, setLocation] = useLocation();
  const { session, loading } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updated, setUpdated] = useState(false);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (password.length < 8) {
      toast.error("Password too short", { description: "Use at least 8 characters." });
      return;
    }

    if (password !== confirmPassword) {
      toast.error("Passwords don't match");
      return;
    }

    setIsUpdating(true);
    const { error } = await supabase.auth.updateUser({
      password,
      data: { must_change_password: false },
    });
    setIsUpdating(false);

    if (error) {
      toast.error("Could not update password", { description: error.message });
      return;
    }

    setUpdated(true);
    toast("Password updated", { description: "You're signed in with your new password." });

    try {
      const { path, migrationRequired } = await resolvePostLoginPath();
      if (migrationRequired) {
        toast.error("Database migration required", { description: `Run ${ONBOARDING_MIGRATION_FILE} in the Supabase SQL Editor to enable first-login setup.` });
      }
      setLocation(path);
    } catch (err) {
      toast.error("Could not continue", { description: err instanceof Error ? err.message : "Please sign in again" });
      setLocation("/login");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <AuthLayout
      panelTitle="Secure access for your business"
      panelDescription="Update your password and get straight back to managing bookings, payments, and reminders."
      panelHighlights={[
        {
          title: "Protected Account",
          description: "Your reset link opens a secure recovery session.",
          icon: <ShieldCheck className="w-5 h-5" />,
        },
        {
          title: "One Login",
          description: "The same account keeps your team and calendar in sync.",
          icon: <Calendar className="w-5 h-5" />,
        },
        {
          title: "Fresh Password",
          description: "Choose a new password before returning to Qwickly.",
          icon: <KeyRound className="w-5 h-5" />,
        },
      ]}
    >
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        {session ? (
          <>
            <div className="mb-8">
              <h1 className="text-3xl font-bold tracking-tight">
                Reset password
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Create a new password for your Qwickly account.
              </p>
            </div>

            <form onSubmit={onSubmit} className="space-y-5">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password">New password</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      required
                      minLength={8}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="h-11 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    At least 8 characters
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm new password</Label>
                  <Input
                    id="confirmPassword"
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={8}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    className="h-11"
                  />
                </div>
              </div>

              <Button
                type="submit"
                className="w-full h-11 text-base font-semibold shadow-md shadow-primary/20"
                disabled={isUpdating || updated}
              >
                {isUpdating ? (
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                ) : updated ? (
                  <CheckCircle2 className="w-5 h-5 mr-2" />
                ) : null}
                {updated ? "Password updated" : "Update password"}
              </Button>
            </form>
          </>
        ) : (
          <>
            <div className="mb-8">
              <h1 className="text-3xl font-bold tracking-tight">
                Reset link expired
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Request a new password reset email and open the latest link.
              </p>
            </div>

            <Button asChild className="w-full h-11 text-base font-semibold">
              <Link href="/login">
                Back to sign in <ArrowRight className="w-4 h-4 ml-2" />
              </Link>
            </Button>
          </>
        )}
      </motion.div>
    </AuthLayout>
  );
}

export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
