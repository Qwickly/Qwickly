import { useEffect, useState } from "react";
import { Redirect } from "wouter";
import { Loader2 } from "lucide-react";
import { resolvePostLoginPath } from "@/lib/onboarding";

export function AuthenticatedRedirect() {
  const [path, setPath] = useState<string | null>(null);

  useEffect(() => {
    resolvePostLoginPath()
      .then(({ path }) => setPath(path))
      .catch(() => setPath("/dashboard"));
  }, []);

  if (!path) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return <Redirect to={path} />;
}
