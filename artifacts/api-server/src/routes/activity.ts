import { Router } from "express";
import { requireUser, type AuthenticatedRequest } from "../middleware/require-user";
import { getSupabaseAdmin, isSupabaseAdminConfigured } from "../lib/supabase";
import {
  countUnreadActivityEvents,
  listRecentActivityEvents,
  markActivityEventsRead,
} from "../lib/activity";

const router = Router();

async function getBusinessIdForUser(userId: string): Promise<string | null> {
  if (!isSupabaseAdminConfigured()) return null;

  const { data, error } = await getSupabaseAdmin()
    .from("businesses")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.id ?? null;
}

router.get("/activity/events", requireUser, async (req, res) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const businessId = await getBusinessIdForUser(user.id);
    if (!businessId) {
      return res.json({ events: [], unreadCount: 0 });
    }

    const requestedLimit = Number(req.query["limit"]);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 100)
      : 25;

    const [events, unreadCount] = await Promise.all([
      listRecentActivityEvents(businessId, limit),
      countUnreadActivityEvents(businessId),
    ]);

    return res.json({ events, unreadCount });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Could not load activity events" });
  }
});

router.post("/activity/events/read", requireUser, async (req, res) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const businessId = await getBusinessIdForUser(user.id);
    if (!businessId) {
      return res.status(204).send();
    }

    await markActivityEventsRead(businessId);
    return res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Could not mark activity as read" });
  }
});

export default router;
