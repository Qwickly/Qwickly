import { Router } from "express";
import { requireUser, type AuthenticatedRequest } from "../middleware/require-user";
import { getSupabaseAdmin, isSupabaseAdminConfigured } from "../lib/supabase";
import { sendEmail, isEmailConfigured } from "../lib/email-sender";
import { generateTempPassword } from "../lib/password";

/**
 * Team-member invite: creates (or resets) a Supabase Auth login for a
 * team_members row (Admin/User/Viewer) and emails a one-time temp password.
 * Deliberately near-identical to routes/staff.ts — the difference is the
 * login link (plain /login, since team members use the main app, not the
 * bookable-staff portal) and that only the literal business owner may call
 * this (team roster management is owner-only, enforced the same way
 * getBusinessForUser already restricts staff.ts to the owner).
 */

const router = Router();

async function getBusinessForUser(userId: string): Promise<{ id: string; name: string | null }> {
  const { data, error } = await getSupabaseAdmin()
    .from("businesses")
    .select("id, business_name")
    .eq("user_id", userId)
    .single();
  if (error || !data) {
    throw new Error(error?.message || "Business not found");
  }
  return { id: data.id as string, name: (data.business_name as string) || null };
}

function loginUrl(): string {
  const base = (process.env["APP_BASE_URL"] || "").replace(/\/$/, "");
  return `${base}/login`;
}

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  user: "User",
  viewer: "Viewer",
};

router.post("/team/:id/invite", requireUser, async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).json({ error: "Supabase is not configured" });
    }
    const user = (req as AuthenticatedRequest).user;
    const business = await getBusinessForUser(user.id);
    const admin = getSupabaseAdmin();

    const teamMemberId = req.params.id;
    const { data: memberRow, error: memberError } = await admin
      .from("team_members")
      .select("id, business_id, name, email, role")
      .eq("id", teamMemberId)
      .single();

    if (memberError || !memberRow) {
      return res.status(404).json({ error: "Team member not found" });
    }
    if (memberRow.business_id !== business.id) {
      return res.status(403).json({ error: "Not permitted" });
    }
    if (memberRow.role === "owner") {
      return res.status(400).json({ error: "The owner doesn't need an invite" });
    }
    const email = (memberRow.email as string | null)?.trim();
    if (!email) {
      return res.status(400).json({ error: "This team member needs an email address before they can be invited" });
    }

    const tempPassword = generateTempPassword();

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        role: memberRow.role,
        team_member_id: memberRow.id,
        must_change_password: true,
      },
    });

    let memberUserId: string;
    if (createError) {
      const alreadyExists = /already.*registered|already.*exists|email_exists/i.test(createError.message);
      if (!alreadyExists) {
        throw new Error(createError.message);
      }
      const { data: list, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (listError) throw new Error(listError.message);
      const existingUser = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
      if (!existingUser) throw new Error("Could not resolve existing account for this email");

      const { error: updateError } = await admin.auth.admin.updateUserById(existingUser.id, {
        password: tempPassword,
        user_metadata: {
          ...existingUser.user_metadata,
          role: memberRow.role,
          team_member_id: memberRow.id,
          must_change_password: true,
        },
      });
      if (updateError) throw new Error(updateError.message);
      memberUserId = existingUser.id;
    } else {
      memberUserId = created.user.id;
    }

    const { error: linkError } = await admin
      .from("team_members")
      .update({ user_id: memberUserId, invite_status: "invited" })
      .eq("id", memberRow.id);
    if (linkError) throw new Error(linkError.message);

    if (isEmailConfigured()) {
      const roleLabel = ROLE_LABELS[memberRow.role as string] ?? memberRow.role;
      await sendEmail({
        to: email,
        subject: "You've been added to the team",
        text: `Hi ${memberRow.name},\n\n${business.name ?? "Your business"} has added you as a ${roleLabel} on Qwickly. You can now log in.\n\nLogin: ${loginUrl()}\nEmail: ${email}\nTemporary password: ${tempPassword}\n\nYou'll be asked to set your own password the first time you log in.`,
        fromName: business.name ?? undefined,
      });
    } else {
      req.log.warn("[team invite] Email provider not configured — temp password not delivered");
    }

    return res.json({ ok: true });
  } catch (err) {
    req.log.error(err);
    const message = err instanceof Error ? err.message : "Could not invite team member";
    return res.status(500).json({ error: message });
  }
});

export default router;
