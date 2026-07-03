import type { NextFunction, Request, Response } from "express";
import type { User } from "@supabase/supabase-js";
import { getUserFromAccessToken } from "../lib/supabase";

export type AuthenticatedRequest = Request & {
  user: User;
};

function readAccessToken(req: Request): string | null {
  const authorization = req.headers.authorization;
  if (!authorization) return null;

  const [scheme, token] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}

export async function requireUser(req: Request, res: Response, next: NextFunction) {
  try {
    const accessToken = readAccessToken(req);
    if (!accessToken) {
      req.log?.warn?.("Authorization header missing on request", { path: req.path });
      return res.status(401).json({ error: "Missing authorization token" });
    }

    const user = await getUserFromAccessToken(accessToken);
    (req as AuthenticatedRequest).user = user;
    next();
  } catch {
    req.log?.warn?.("Authorization failed or invalid token", { path: req.path });
    res.status(401).json({ error: "Unauthorized" });
  }
}
