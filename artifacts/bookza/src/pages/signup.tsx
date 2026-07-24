import { useState } from "react";
import { Link, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { GuestRoute } from "@/components/auth/GuestRoute";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ONBOARDING_MIGRATION_FILE,
  resolvePostAuthPath,
} from "@/lib/onboarding";
import {
  ArrowRight,
  Building2,
  CreditCard,
  Loader2,
  Lock,
  Mail,
  Phone,
  User,
} from "lucide-react";

function SignupForm() {
  const [, setLocation] = useLocation();
  const { signUp } = useAuth();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [step, setStep] = useState(1);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Early-access gate (disabled for production launch — kept for future re-enable):
  // const [accessKey, setAccessKey] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [phone, setPhone] = useState("");

  const onNext = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast({
        title: "Password too short",
        description: "Use at least 8 characters.",
        variant: "destructive",
      });
      return;
    }
    // Early-access gate (disabled for production launch — kept for future re-enable):
    // if (accessKey !== "Qwickly2026@") {
    //   toast({
    //     title: "Access denied",
    //     description: "Invalid access key. Contact administrator for access.",
    //     variant: "destructive",
    //   });
    //   return;
    // }
    setStep(2);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessType) {
      toast({
        title: "Select a business type",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    const { error, needsEmailConfirmation } = await signUp(email, password, {
      firstName,
      lastName,
      businessName,
      businessType,
      phone,
    });
    setIsLoading(false);

    if (error) {
      toast({
        title: "Sign up failed",
        description: error,
        variant: "destructive",
      });
      return;
    }

    if (needsEmailConfirmation) {
      toast({
        title: "Confirm your email",
        description:
          "We sent you a confirmation link. Check your inbox, then log in.",
      });
      setLocation("/login");
      return;
    }

    toast({
      title: "Welcome to Qwickly!",
      description: "Let's set up your business.",
    });
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
        title: "Could not continue after sign up",
        description: err instanceof Error ? err.message : "Please try again",
        variant: "destructive",
      });
    }
  };

  return (
    <AuthLayout
      panelTitle="Built for South African entrepreneurs"
      panelDescription="Start your 14-day free trial. Card required — no charge until day 14, cancel anytime."
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
      ]}
    >
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight">Create account</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Step {step} of 2 — {step === 1 ? "Your details" : "Your business"}
          </p>
        </div>

        <div className="flex gap-2 mb-8">
          <div
            className={`h-1 flex-1 rounded-full transition-colors ${step >= 1 ? "bg-primary" : "bg-muted"}`}
          />
          <div
            className={`h-1 flex-1 rounded-full transition-colors ${step >= 2 ? "bg-primary" : "bg-muted"}`}
          />
        </div>

        <AnimatePresence mode="wait">
          {step === 1 ? (
            <motion.form
              key="step1"
              onSubmit={onNext}
              className="space-y-5"
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 12 }}
              transition={{ duration: 0.25 }}
            >
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="firstName">First name</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="firstName"
                        required
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        className="h-11 pl-10"
                      />
                    </div>
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
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="h-11 pl-10"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="password"
                      type="password"
                      required
                      minLength={8}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-11 pl-10"
                    />
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

              <Button
                type="submit"
                className="w-full h-11 text-base font-semibold shadow-md shadow-primary/20"
                size="lg"
              >
                Continue <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </motion.form>
          ) : (
            <motion.form
              key="step2"
              onSubmit={onSubmit}
              className="space-y-5"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.25 }}
            >
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="businessName">Business name</Label>
                  <div className="relative">
                    <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="businessName"
                      required
                      placeholder="e.g. Cuts & Fades"
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                      className="h-11 pl-10"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="businessType">Business type</Label>
                  <Select
                    value={businessType}
                    onValueChange={setBusinessType}
                    required
                  >
                    <SelectTrigger className="h-11">
                      <SelectValue placeholder="Select business type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="barbershop">Barbershop</SelectItem>
                      <SelectItem value="salon">Hair Salon</SelectItem>
                      <SelectItem value="tutor">Tutor / Education</SelectItem>
                      <SelectItem value="mechanic">Mechanic</SelectItem>
                      <SelectItem value="consultant">Consultant</SelectItem>
                      <SelectItem value="beauty">Beauty & Spa</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone">Business phone</Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="phone"
                      type="tel"
                      required
                      placeholder="+27 XX XXX XXXX"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="h-11 pl-10"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-start">
                <Checkbox id="terms" required className="mt-1" />
                <label
                  htmlFor="terms"
                  className="ml-2 text-sm text-muted-foreground leading-relaxed"
                >
                  I agree to the{" "}
                  <a
                    href="#"
                    className="font-medium text-primary hover:underline"
                  >
                    Terms
                  </a>{" "}
                  and{" "}
                  <a
                    href="#"
                    className="font-medium text-primary hover:underline"
                  >
                    Privacy Policy
                  </a>
                </label>
              </div>

              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="h-11 px-6"
                  onClick={() => setStep(1)}
                >
                  Back
                </Button>
                <Button
                  type="submit"
                  className="flex-1 h-11 text-base font-semibold shadow-md shadow-primary/20"
                  size="lg"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  ) : null}
                  Create account
                </Button>
              </div>
            </motion.form>
          )}
        </AnimatePresence>

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
