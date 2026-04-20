"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Sparkles, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { uploadUrl } from "@/lib/utils/upload-url";
import type { VisualAsset } from "./use-episode-characters";

export function VisualAssetCard({
  asset,
  titlePlaceholder,
  promptPlaceholder,
  generating,
  batchGenerating,
  onGenerate,
  onSave,
  onDelete,
}: {
  asset: VisualAsset;
  titlePlaceholder: string;
  promptPlaceholder: string;
  generating: boolean;
  batchGenerating: boolean;
  onGenerate: (assetId: string) => Promise<void>;
  onSave: (assetId: string, patch: { name?: string; prompt?: string }) => Promise<void>;
  onDelete: (assetId: string) => Promise<void>;
}) {
  const t = useTranslations();
  const [name, setName] = useState(asset.name);
  const [prompt, setPrompt] = useState(asset.prompt);
  const [lightbox, setLightbox] = useState(false);

  useEffect(() => setName(asset.name), [asset.name]);
  useEffect(() => setPrompt(asset.prompt), [asset.prompt]);

  const statusGenerating =
    generating ||
    asset.status === "generating" ||
    (!!batchGenerating && !asset.imageUrl);

  async function handleBlur() {
    const nextName = name.trim();
    const nextPrompt = prompt.trim();
    if (nextName === asset.name && nextPrompt === asset.prompt) return;
    await onSave(asset.id, { name: nextName, prompt: nextPrompt });
  }

  return (
    <div className="group overflow-hidden rounded-2xl border border-[--border-subtle] bg-white transition-all duration-300 hover:border-[--border-hover] hover:shadow-lg hover:shadow-black/5">
      <div className="relative flex items-center justify-center bg-gradient-to-b from-[--surface] to-white p-8">
        <button
          className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-red-500/80 text-white opacity-0 transition-all hover:bg-red-600 group-hover:opacity-100"
          onClick={() => onDelete(asset.id)}
          title={t("common.delete")}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>

        <div className="relative w-full aspect-video overflow-hidden rounded-xl bg-[--surface]">
          {asset.imageUrl ? (
            <button type="button" onClick={() => setLightbox(true)} className="h-full w-full cursor-zoom-in">
              <img src={uploadUrl(asset.imageUrl)} alt={asset.name} className="h-full w-full object-cover" />
            </button>
          ) : statusGenerating ? (
            <div className="relative h-full w-full animate-shimmer">
              <div className="absolute inset-0 flex items-center justify-center text-xs text-[--text-muted]">
                {t("common.generating")}
              </div>
            </div>
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/15 to-accent/10 text-xs font-medium text-primary/80">
              {t("visualAsset.noImage")}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-3 p-4">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={handleBlur}
          placeholder={titlePlaceholder}
          className="h-9 font-display font-semibold text-base"
        />
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onBlur={handleBlur}
          placeholder={promptPlaceholder}
          className="h-32 resize-none text-sm"
        />

        {asset.errorMessage && !asset.imageUrl && asset.status !== "completed" ? (
          <div className="rounded-md bg-red-50 px-2 py-1 text-xs text-red-600">
            {asset.errorMessage}
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <Button size="sm" className="flex-1" onClick={() => onGenerate(asset.id)} disabled={statusGenerating}>
            {statusGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {statusGenerating ? t("common.generating") : t("visualAsset.generate")}
          </Button>
        </div>
      </div>

      {asset.imageUrl ? (
        <Dialog open={lightbox} onOpenChange={setLightbox}>
          <DialogContent className="!max-w-[90vw] !w-[90vw] border-0 bg-transparent p-0 shadow-none" showCloseButton={false}>
            <DialogTitle className="sr-only">{asset.name}</DialogTitle>
            <div className="relative inline-block w-full">
              <img src={uploadUrl(asset.imageUrl)} alt={asset.name} className="w-full max-h-[85vh] object-contain rounded-xl" />
              <button
                onClick={() => setLightbox(false)}
                className="absolute top-4 right-4 text-white bg-black/60 hover:bg-black/80 rounded-full w-10 h-10 flex items-center justify-center text-xl transition-colors"
                aria-label="Close image preview"
              >
                ×
              </button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
