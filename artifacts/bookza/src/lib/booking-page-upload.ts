import { ensureBusiness } from "@/lib/settings";
import { supabase } from "@/lib/supabase";

const BUCKET = "booking-page-assets";
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export type BookingPageImageKind = "cover" | "logo";

export function sameImageUrl(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.split("?")[0] === b.split("?")[0];
}

function extensionFor(file: File): string {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName && ["jpg", "jpeg", "png", "webp", "gif"].includes(fromName)) {
    return fromName === "jpeg" ? "jpg" : fromName;
  }
  if (file.type === "image/jpeg") return "jpg";
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/gif") return "gif";
  return "jpg";
}

export function validateBookingPageImage(file: File): string | null {
  if (!ALLOWED_TYPES.has(file.type)) {
    return "Please upload a JPG, PNG, WebP, or GIF image.";
  }
  if (file.size > MAX_BYTES) {
    return "Image must be 5 MB or smaller.";
  }
  return null;
}

export async function uploadBookingPageImage(
  file: File,
  kind: BookingPageImageKind,
): Promise<string> {
  const validationError = validateBookingPageImage(file);
  if (validationError) throw new Error(validationError);

  const businessId = await ensureBusiness();
  const ext = extensionFor(file);
  const path = `${businessId}/${kind}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: true,
    contentType: file.type,
    cacheControl: "3600",
  });

  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return `${data.publicUrl}?t=${Date.now()}`;
}

export async function uploadCampaignImage(file: File): Promise<string> {
  const validationError = validateBookingPageImage(file);
  if (validationError) throw new Error(validationError);

  const businessId = await ensureBusiness();
  const ext = extensionFor(file);
  const safeName = file.name
    .replace(/[^a-zA-Z0-9.-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  const path = `${businessId}/marketing/campaign-images/${Date.now()}-${safeName}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: true,
    contentType: file.type,
    cacheControl: "3600",
  });

  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return `${data.publicUrl}?t=${Date.now()}`;
}

export async function removeBookingPageImage(url: string | null): Promise<void> {
  if (!url) return;

  const businessId = await ensureBusiness();
  const marker = `/object/public/${BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return;

  const path = url.slice(idx + marker.length).split("?")[0];
  if (!path.startsWith(`${businessId}/`)) return;

  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw new Error(error.message);
}
