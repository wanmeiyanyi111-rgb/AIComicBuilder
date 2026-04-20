"use client";

import { ImageIcon, Loader2, Mountain, Package, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VisualAssetCard } from "./visual-asset-card";
import type { VisualAsset, VisualAssetType } from "./use-episode-characters";

export function VisualAssetsSection({
  assets,
  batchGenerating,
  emptyText,
  generatingAssetIds,
  icon,
  loading,
  onAdd,
  onBatchGenerate,
  onDelete,
  onGenerate,
  onSave,
  addLabel,
  batchLabel,
  title,
  hint,
  titlePlaceholder,
  promptPlaceholder,
  addBusy,
  t,
}: {
  assets: VisualAsset[];
  batchGenerating: boolean;
  emptyText: string;
  generatingAssetIds: string[];
  icon: VisualAssetType;
  loading: boolean;
  onAdd: () => void;
  onBatchGenerate: () => void;
  onDelete: (assetId: string) => Promise<void>;
  onGenerate: (assetId: string) => Promise<void>;
  onSave: (assetId: string, patch: { name?: string; prompt?: string }) => Promise<void>;
  addLabel: string;
  batchLabel: string;
  title: string;
  hint: string;
  titlePlaceholder: string;
  promptPlaceholder: string;
  addBusy: boolean;
  t: (key: string) => string;
}) {
  const Icon = icon === "scene" ? Mountain : Package;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />
          <div>
            <div className="text-sm font-semibold text-[--text-primary]">{title}</div>
            <div className="text-xs text-[--text-muted]">{hint}</div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onAdd} disabled={addBusy}>
            {addBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {addLabel}
          </Button>
          <Button size="sm" onClick={onBatchGenerate} disabled={batchGenerating || assets.length === 0}>
            {batchGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
            {batchGenerating ? t("common.generating") : batchLabel}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl border border-dashed border-[--border-subtle] p-6 text-center text-sm text-[--text-muted]">
          {t("common.loading")}
        </div>
      ) : assets.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[--border-subtle] p-6 text-center text-sm text-[--text-muted]">
          {emptyText}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {assets.map((asset) => (
            <VisualAssetCard
              key={asset.id}
              asset={asset}
              titlePlaceholder={titlePlaceholder}
              promptPlaceholder={promptPlaceholder}
              generating={generatingAssetIds.includes(asset.id)}
              batchGenerating={batchGenerating}
              onGenerate={onGenerate}
              onSave={onSave}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </section>
  );
}
