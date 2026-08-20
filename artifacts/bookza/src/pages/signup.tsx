import { useState } from "react";
import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { GuestRoute } from "@/components/auth/GuestRoute";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  ONBOARDING_MIGRATION_FILE,
  resolvePostAuthPath,
} from "@/lib/onboarding";
import {
  Building2,
  CreditCard,
  Eye,
  EyeOff,
  Loader2,
  MessageCircle,
} from "lucide-react";

function SignupForm() {
  const [, setLocation] = useLocation();
  const { signUp } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  // Early-access gate (disabled for production launch — kept for future re-enable):
  // const [accessKey, setAccessKey] = useState("");
  const [legalDoc, setLegalDoc] = useState<"terms" | "privacy" | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Password too short", { description: "Use at least 8 characters." });
      return;
    }

    setIsLoading(true);
    const { error, needsEmailConfirmation } = await signUp(email, password, {
      firstName,
      lastName,
    });
    setIsLoading(false);

    if (error) {
      toast.error("Sign up failed", { description: error });
      return;
    }

    if (needsEmailConfirmation) {
      toast("Confirm your email", { description: "We sent you a confirmation link. Check your inbox, then log in." });
      setLocation("/login");
      return;
    }

    toast("Welcome to Qwickly!", { description: "Let's set up your business." });
    try {
      const { path, migrationRequired } = await resolvePostAuthPath();
      if (migrationRequired) {
        toast.error("Database migration required", { description: `Run ${ONBOARDING_MIGRATION_FILE} in the Supabase SQL Editor to enable first-login setup.` });
      }
      setLocation(path);
    } catch (err) {
      toast.error("Could not continue after sign up", { description: err instanceof Error ? err.message : "Please try again" });
    }
  };

  return (
    <AuthLayout
      panelTitle="Built for South African entrepreneurs"
      panelDescription="Start your 14-day free trial. No card required — we only ask for payment details if you decide to stay."
      panelHighlights={[
        {
          title: "Local Payments",
          description: "PayFast, Yoco, cash, and EFT built in.",
          icon: <CreditCard className="w-5 h-5" />,
        },
        {
          title: "Your Brand, Online",
          description: "A booking page your clients will love.",
          icon: <Building2 className="w-5 h-5" />,
        },
        {
          title: "WhatsApp Reminders",
          description: "Automatic reminders that cut no-shows.",
          icon: <MessageCircle className="w-5 h-5" />,
        },
      ]}
    >
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Create account</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Free for 14 days. We&apos;ll set your business up next.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-5">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="firstName">First name</Label>
                    <Input
                      id="firstName"
                      required
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="h-11"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lastName">Last name</Label>
                    <Input
                      id="lastName"
                      required
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className="h-11"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Email address</Label>
                  <Input
                    id="email"
                    type="email"
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
                      placeholder="Create a password"
                      required
                      minLength={8}
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

                {/* Early-access gate (disabled for production launch — kept for future re-enable):
                <div className="space-y-2">
                  <Label htmlFor="accessKey">Access Key</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="accessKey"
                      type="password"
                      required
                      placeholder="Enter access key"
                      value={accessKey}
                      onChange={(e) => setAccessKey(e.target.value)}
                      className="h-11 pl-10"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Required for early access
                  </p>
                </div>
                */}
              </div>

              <div className="flex items-start gap-3">
                <Checkbox
                  id="terms"
                  required
                  className="mt-0.5 h-5 w-5 border-2 border-primary bg-primary/5 ring-2 ring-primary/20 data-[state=checked]:bg-primary data-[state=checked]:border-primary data-[state=checked]:text-white"
                />
                <label
                  htmlFor="terms"
                  className="cursor-pointer text-sm font-medium leading-relaxed text-foreground"
                >
                  I agree to the{" "}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setLegalDoc("terms");
                    }}
                    className="font-semibold text-primary hover:underline"
                  >
                    Terms of Service
                  </button>{" "}
                  and{" "}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setLegalDoc("privacy");
                    }}
                    className="font-semibold text-primary hover:underline"
                  >
                    Privacy Policy
                  </button>
                </label>
              </div>

              <Button
                type="submit"
                className="h-11 w-full text-base font-semibold shadow-md shadow-primary/20"
                size="lg"
                disabled={isLoading}
              >
                {isLoading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : null}
                Create account
              </Button>
        </form>

        <p className="mt-8 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-semibold text-primary hover:text-primary/80 transition-colors"
          >
            Log in
          </Link>
        </p>
      </motion.div>

      {/* Terms / Privacy shown as an in-flow overlay (iframe of the real
          static legal page) so the user never leaves the signup screen. */}
      <Dialog
        open={legalDoc !== null}
        onOpenChange={(open) => !open && setLegalDoc(null)}
      >
        <DialogContent className="max-w-3xl h-[85vh] p-0 gap-0 overflow-hidden flex flex-col">
          <DialogHeader className="px-6 py-4 border-b">
            <DialogTitle>
              {legalDoc === "privacy" ? "Privacy Policy" : "Terms of Service"}
            </DialogTitle>
          </DialogHeader>
          {legalDoc && (
            <iframe
              key={legalDoc}
              src={`/${legalDoc}.html?embed=1`}
              title={legalDoc === "privacy" ? "Privacy Policy" : "Terms of Service"}
              className="w-full flex-1 border-0"
            />
          )}
        </DialogContent>
      </Dialog>
    </AuthLayout>
  );
}

export default function SignupPage() {
  return (
    <GuestRoute>
      <SignupForm />
    </GuestRoute>
  );
}
