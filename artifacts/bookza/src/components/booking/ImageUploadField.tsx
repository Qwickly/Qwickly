import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  removeBookingPageImage,
  uploadBookingPageImage,
  type BookingPageImageKind,
} from "@/lib/booking-page-upload";
import { cn } from "@/lib/utils";
import { ImagePlus, Loader2, Trash2, Upload } from "lucide-react";

type Props = {
  label: string;
  hint?: string;
  kind: BookingPageImageKind;
  value: string | null;
  onChange: (url: string | null) => void;
  onUploaded?: (url: string) => void;
  onRemoved?: () => void;
  fallbackPreviewUrl?: string | null;
  fallbackLabel?: string;
  previewClassName?: string;
  aspect?: "cover" | "square";
};

export function ImageUploadField({
  label,
  hint,
  kind,
  value,
  onChange,
  onUploaded,
  onRemoved,
  fallbackPreviewUrl,
  fallbackLabel = "Using cover image as logo",
  previewClassName,
  aspect = kind === "cover" ? "cover" : "square",
}: Props) {
  const displayUrl = value ?? fallbackPreviewUrl ?? null;
  const usingFallback = !value && Boolean(fallbackPreviewUrl);
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadBookingPageImage(file, kind);
      onChange(url);
      onUploaded?.(url);
      toast({ title: "Image uploaded", description: `${label} updated.` });
    } catch (err) {
      toast({
        title: "Upload failed",
        description: err instanceof Error ? err.message : "Please try again",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    try {
      await removeBookingPageImage(value);
      onChange(null);
      onRemoved?.();
      toast({ title: "Image removed" });
    } catch (err) {
      toast({
        title: "Could not remove image",
        description: err instanceof Error ? err.message : "Please try again",
        variant: "destructive",
      });
    } finally {
      setRemoving(false);
    }
  };

  const busy = uploading || removing;

  return (
    <div className="space-y-2">
      <div>
        <Label>{label}</Label>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
      </div>

      {displayUrl ? (
        <div className="space-y-3">
          <div
            className={cn(
              "relative overflow-hidden rounded-lg border bg-muted/30",
              aspect === "cover" ? "h-32 w-full" : "h-24 w-24",
              previewClassName,
            )}
          >
            <img src={displayUrl} alt="" className="h-full w-full object-cover" />
            {usingFallback && (
              <span className="absolute bottom-2 left-2 right-2 rounded bg-black/65 px-2 py-1 text-center text-[10px] text-white">
                {fallbackLabel}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
              Replace
            </Button>
            {!usingFallback && (
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={handleRemove}>
                {removing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
                Remove
              </Button>
            )}
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "w-full border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-2",
            "bg-muted/50 hover:bg-muted transition-colors text-muted-foreground",
            aspect === "cover" ? "h-32" : "h-24",
            busy && "opacity-60 pointer-events-none",
          )}
        >
          {uploading ? (
            <Loader2 className="w-6 h-6 animate-spin" />
          ) : (
            <>
              <ImagePlus className="w-6 h-6" />
              <span className="text-sm">Upload image</span>
              <span className="text-xs">JPG, PNG, WebP or GIF · max 5 MB</span>
            </>
          )}
        </button>
      )}

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Or paste image URL</Label>
        <Input
          placeholder="https://..."
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value.trim() || null)}
        />
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
    </div>
  );
}
