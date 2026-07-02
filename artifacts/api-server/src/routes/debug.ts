import { Router } from "express";

const router = Router();

router.get("/debug/auth-headers", (req, res) => {
  const auth = req.headers.authorization ?? null;
  // Mask the token for safety when logging/returning
  const masked = typeof auth === "string" ? auth.replace(/Bearer\s+(.*)/i, (_, t) => `Bearer ${t ? t.slice(0, 6) + '…' : ''}`) : null;
  res.json({ authorizationPresent: Boolean(auth), authorization: masked });
});

export default router;
