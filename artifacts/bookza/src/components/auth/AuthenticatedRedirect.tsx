import { useEffect, useState } from "react";
import { Redirect } from "wouter";
import { AppBootLoader } from "@/components/layout/AppBootLoader";
import { resolvePostAuthPath } from "@/lib/onboarding";

export function AuthenticatedRedirect() {
  const [path, setPath] = useState<string | null>(null);

  useEffect(() => {
    resolvePostAuthPath()
      .then(({ path }) => setPath(path))
      .catch(() => setPath("/dashboard"));
  }, []);

  if (!path) {
    return <AppBootLoader label="Taking you to your dashboard" />;
  }

  return <Redirect to={path} />;
}
