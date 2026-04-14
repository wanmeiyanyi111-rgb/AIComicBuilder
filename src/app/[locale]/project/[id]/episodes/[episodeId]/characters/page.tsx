"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { useProjectStore } from "@/stores/project-store";
import { useModelStore } from "@/stores/model-store";
import { CharacterCard } from "@/components/editor/character-card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useTranslations } from "next-intl";
import {
  Users,
  Sparkles,
  ImageIcon,
  Loader2,
  Mountain,
  Package,
  Trash2,
} from "lucide-react";
import { InlineModelPicker } from "@/components/editor/model-selector";
import { apiFetch } from "@/lib/api-fetch";
import { useModelGuard } from "@/hooks/use-model-guard";
import { PromptEditButton } from "@/components/prompt-templates/prompt-edit-button";
import { toast } from "sonner";
import { ApiError } from "@/lib/api-fetch";
import { uploadUrl } from "@/lib/utils/upload-url";

type VisualAssetType = "scene" | "prop";

type VisualAsset = {
  id: string;
  projectId: string;
  episodeId: string | null;
  type: VisualAssetType;
  name: string;
  prompt: string;
  imageUrl: string | null;
  status: "pending" | "generating" | "completed" | "failed";
  errorMessage: string | null;
};

function VisualAssetCard({
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

  useEffect(() => {
    setName(asset.name);
  }, [asset.name]);

  useEffect(() => {
    setPrompt(asset.prompt);
  }, [asset.prompt]);

  const statusGenerating =
    generating ||
    asset.status === "generating" ||
    (!!batchGenerating && !asset.imageUrl);

  async function handleBlur() {
    const nextName = name.trim();
    const nextPrompt = prompt.trim();
    if (nextName === asset.name && nextPrompt === asset.prompt) {
      return;
    }
    await onSave(asset.id, {
      name: nextName,
      prompt: nextPrompt,
    });
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
            <button
              type="button"
              onClick={() => setLightbox(true)}
              className="h-full w-full cursor-zoom-in"
            >
              <img
                src={uploadUrl(asset.imageUrl)}
                alt={asset.name}
                className="h-full w-full object-cover"
              />
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
          <Button
            size="sm"
            className="flex-1"
            onClick={() => onGenerate(asset.id)}
            disabled={statusGenerating}
          >
            {statusGenerating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {statusGenerating ? t("common.generating") : t("visualAsset.generate")}
          </Button>
        </div>
      </div>

      {asset.imageUrl ? (
        <Dialog open={lightbox} onOpenChange={setLightbox}>
          <DialogContent
            className="!max-w-[90vw] !w-[90vw] border-0 bg-transparent p-0 shadow-none"
            showCloseButton={false}
          >
            <DialogTitle className="sr-only">{asset.name}</DialogTitle>
            <div className="relative inline-block w-full">
              <img
                src={uploadUrl(asset.imageUrl)}
                alt={asset.name}
                className="w-full max-h-[85vh] object-contain rounded-xl"
              />
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

export default function EpisodeCharactersPage() {
  const t = useTranslations();
  const router = useRouter();
  const locale = useLocale();
  const { project, fetchProject } = useProjectStore();
  const currentEpisodeId = useProjectStore((s) => s.currentEpisodeId);
  const getModelConfig = useModelStore((s) => s.getModelConfig);
  const [extracting, setExtracting] = useState(false);
  const [generatingImages, setGeneratingImages] = useState(false);
  const [visualAssets, setVisualAssets] = useState<VisualAsset[]>([]);
  const [loadingVisualAssets, setLoadingVisualAssets] = useState(false);
  const [creatingSceneAsset, setCreatingSceneAsset] = useState(false);
  const [creatingPropAsset, setCreatingPropAsset] = useState(false);
  const [batchGeneratingScene, setBatchGeneratingScene] = useState(false);
  const [batchGeneratingProp, setBatchGeneratingProp] = useState(false);
  const [extractingVisualCandidates, setExtractingVisualCandidates] = useState(false);
  const [generatingAssetIds, setGeneratingAssetIds] = useState<string[]>([]);
  const textGuard = useModelGuard("text");
  const imageGuard = useModelGuard("image");

  const hasCharactersWithoutImages = project?.characters.some((c) => !c.referenceImage) ?? false;

  const fetchVisualAssets = useCallback(async () => {
    if (!project?.id || !currentEpisodeId) {
      setVisualAssets([]);
      return;
    }

    setLoadingVisualAssets(true);
    try {
      const res = await apiFetch(
        `/api/projects/${project.id}/visual-assets?episodeId=${currentEpisodeId}`
      );
      const rows = (await res.json()) as VisualAsset[];
      setVisualAssets(rows);
    } catch (err) {
      console.error("Visual assets fetch error:", err);
      toast.error(t("common.generationFailed"));
    } finally {
      setLoadingVisualAssets(false);
    }
  }, [project?.id, currentEpisodeId, t]);

  useEffect(() => {
    void fetchVisualAssets();
  }, [fetchVisualAssets]);

  if (!project) return null;

  const sceneAssets = visualAssets.filter((asset) => asset.type === "scene");
  const propAssets = visualAssets.filter((asset) => asset.type === "prop");

  async function handleExtractCharacters() {
    if (!project) return;
    if (!textGuard()) return;
    setExtracting(true);

    try {
      await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "character_extract",
          modelConfig: getModelConfig(),
          episodeId: useProjectStore.getState().currentEpisodeId,
        }),
      });
    } catch (err) {
      if (err instanceof ApiError && err.status < 500) {
        const message = err.message || t("common.generationFailed");
        toast.warning(message, {
          action: {
            label: t("project.script"),
            onClick: () => {
              const target = currentEpisodeId
                ? `/${locale}/project/${project.id}/episodes/${currentEpisodeId}/script`
                : `/${locale}/project/${project.id}/script`;
              router.push(target);
            },
          },
        });
      } else {
        console.error("Character extract error:", err);
        const message =
          err instanceof Error ? err.message : t("common.generationFailed");
        toast.error(message);
      }
    }

    setExtracting(false);
    fetchProject(project.id, useProjectStore.getState().currentEpisodeId!);
  }

  async function handleBatchGenerateImages() {
    if (!project) return;
    if (!imageGuard()) return;
    setGeneratingImages(true);

    try {
      const response = await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "batch_character_image",
          modelConfig: getModelConfig(),
          episodeId: useProjectStore.getState().currentEpisodeId,
        }),
      });

      const data = (await response.json()) as { results: Array<{ status: string }> };
      if (data.results?.some((r) => r.status === "error")) {
        toast.warning(t("common.batchPartialFailed"));
      }
    } catch (err) {
      console.error("Batch character image error:", err);
      toast.error(t("common.generationFailed"));
    }

    setGeneratingImages(false);
    fetchProject(project.id, useProjectStore.getState().currentEpisodeId!);
  }

  async function createVisualAsset(type: VisualAssetType) {
    if (!project?.id || !currentEpisodeId) return;

    if (type === "scene") setCreatingSceneAsset(true);
    if (type === "prop") setCreatingPropAsset(true);

    try {
      await apiFetch(`/api/projects/${project.id}/visual-assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          episodeId: currentEpisodeId,
          type,
          name:
            type === "scene"
              ? t("visualAsset.defaultSceneName")
              : t("visualAsset.defaultPropName"),
          prompt: "",
        }),
      });
      await fetchVisualAssets();
    } catch (err) {
      console.error("Create visual asset error:", err);
      toast.error(t("common.generationFailed"));
    } finally {
      if (type === "scene") setCreatingSceneAsset(false);
      if (type === "prop") setCreatingPropAsset(false);
    }
  }

  async function updateVisualAsset(
    assetId: string,
    patch: { name?: string; prompt?: string }
  ) {
    if (!project?.id) return;
    try {
      await apiFetch(`/api/projects/${project.id}/visual-assets/${assetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      await fetchVisualAssets();
    } catch (err) {
      console.error("Update visual asset error:", err);
      toast.error(t("common.generationFailed"));
    }
  }

  async function deleteVisualAsset(assetId: string) {
    if (!project?.id) return;
    try {
      await apiFetch(`/api/projects/${project.id}/visual-assets/${assetId}`, {
        method: "DELETE",
      });
      await fetchVisualAssets();
    } catch (err) {
      console.error("Delete visual asset error:", err);
      toast.error(t("common.generationFailed"));
    }
  }

  async function generateVisualAssetImage(assetId: string) {
    if (!project?.id) return;
    if (!imageGuard()) return;

    setGeneratingAssetIds((prev) => [...prev, assetId]);
    try {
      await apiFetch(`/api/projects/${project.id}/visual-assets/${assetId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelConfig: getModelConfig() }),
      });
      await fetchVisualAssets();
    } catch (err) {
      console.error("Generate visual asset error:", err);
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    } finally {
      setGeneratingAssetIds((prev) => prev.filter((id) => id !== assetId));
    }
  }

  async function batchGenerateVisualAssets(type: VisualAssetType) {
    if (!project?.id || !currentEpisodeId) return;
    if (!imageGuard()) return;

    if (type === "scene") setBatchGeneratingScene(true);
    if (type === "prop") setBatchGeneratingProp(true);
    const pollTimer = window.setInterval(() => {
      void fetchVisualAssets();
    }, 5000);

    try {
      const res = await apiFetch(`/api/projects/${project.id}/visual-assets/generate-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          episodeId: currentEpisodeId,
          type,
          modelConfig: getModelConfig(),
        }),
      });
      const data = (await res.json()) as {
        results?: Array<{ status: "ok" | "error" }>;
      };
      if (data.results?.some((item) => item.status === "error")) {
        toast.warning(t("common.batchPartialFailed"));
      }
      await fetchVisualAssets();
    } catch (err) {
      console.error("Batch generate visual assets error:", err);
      toast.error(t("common.generationFailed"));
    } finally {
      window.clearInterval(pollTimer);
      if (type === "scene") setBatchGeneratingScene(false);
      if (type === "prop") setBatchGeneratingProp(false);
    }
  }

  async function handleExtractVisualCandidates() {
    if (!project?.id || !currentEpisodeId) return;
    if (!textGuard()) return;

    setExtractingVisualCandidates(true);
    try {
      const response = await apiFetch(
        `/api/projects/${project.id}/visual-assets/extract-candidates`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            episodeId: currentEpisodeId,
            refreshExisting: true,
            modelConfig: getModelConfig(),
          }),
        }
      );
      const data = (await response.json()) as {
        created: number;
        createdScenes: number;
        createdProps: number;
        updated?: number;
        updatedScenes?: number;
        updatedProps?: number;
      };
      const changedTotal = data.created + (data.updated || 0);
      const changedScenes = data.createdScenes + (data.updatedScenes || 0);
      const changedProps = data.createdProps + (data.updatedProps || 0);

      if (changedTotal > 0) {
        toast.success(
          t("visualAsset.extractSuccess", {
            count: changedTotal,
            scenes: changedScenes,
            props: changedProps,
          })
        );
      } else {
        toast.message(t("visualAsset.extractNoNew"));
      }
      await fetchVisualAssets();
    } catch (err) {
      console.error("Extract visual candidates error:", err);
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    } finally {
      setExtractingVisualCandidates(false);
    }
  }

  return (
    <div className="animate-page-in space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
            <Users className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="font-display text-xl font-bold tracking-tight text-[--text-primary]">
              {t("project.characters")}
            </h2>
            <p className="text-xs text-[--text-muted]">
              {project.characters.length} characters
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <InlineModelPicker capability="text" />
          <Button
            onClick={handleExtractCharacters}
            disabled={extracting}
            variant="default"
            size="sm"
          >
            {extracting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {extracting ? t("common.generating") : t("project.extractCharacters")}
          </Button>
          {project.characters.length > 0 && hasCharactersWithoutImages && (
            <>
              <InlineModelPicker capability="image" />
              <Button
                onClick={handleBatchGenerateImages}
                disabled={generatingImages}
                variant="default"
                size="sm"
              >
                {generatingImages ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ImageIcon className="h-3.5 w-3.5" />
                )}
                {generatingImages
                  ? t("common.generating")
                  : t("character.batchGenerateImages")}
              </Button>
            </>
          )}
          <PromptEditButton promptKeys="character_extract" projectId={project.id} />
        </div>
      </div>

      {project.characters.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-[--border-subtle] bg-[--surface]/50 py-24">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-accent/10">
            <Users className="h-7 w-7 text-primary" />
          </div>
          <h3 className="font-display text-lg font-semibold text-[--text-primary]">
            {t("project.characters")}
          </h3>
          <p className="mt-2 max-w-sm text-center text-sm text-[--text-secondary]">
            {t("character.noCharacters")}
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {project.characters.map((char) => (
              <CharacterCard
                key={char.id}
                id={char.id}
                projectId={project.id}
                name={char.name}
                description={char.description}
                visualHint={char.visualHint ?? null}
                referenceImage={char.referenceImage}
                referenceImageHistory={char.referenceImageHistory}
                onUpdate={() => fetchProject(project.id, useProjectStore.getState().currentEpisodeId!)}
                batchGenerating={generatingImages}
                scope={char.scope}
                onPromote={
                  char.scope === "guest"
                    ? async () => {
                        await apiFetch(
                          `/api/projects/${project.id}/characters/${char.id}`,
                          {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ scope: "main", episodeId: null }),
                          }
                        );
                        fetchProject(project.id, useProjectStore.getState().currentEpisodeId!);
                      }
                    : undefined
                }
              />
            ))}
          </div>
        </>
      )}

      {currentEpisodeId ? (
        <div className="space-y-5 rounded-2xl border border-[--border-subtle] bg-[--surface]/50 p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-lg font-semibold text-[--text-primary]">
                {t("visualAsset.title")}
              </h3>
              <p className="text-xs text-[--text-muted]">{t("visualAsset.subtitle")}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <InlineModelPicker capability="text" />
              <Button
                size="sm"
                variant="outline"
                onClick={handleExtractVisualCandidates}
                disabled={extractingVisualCandidates}
              >
                {extractingVisualCandidates ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                {extractingVisualCandidates
                  ? t("visualAsset.extractingCandidates")
                  : t("visualAsset.extractCandidates")}
              </Button>
              <InlineModelPicker capability="image" />
              <PromptEditButton
                promptKeys={["scene_prop_extract", "scene_image", "prop_image"]}
                projectId={project.id}
              />
            </div>
          </div>

          <div className="space-y-8">
            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Mountain className="h-4 w-4 text-primary" />
                  <div>
                    <div className="text-sm font-semibold text-[--text-primary]">
                      {t("visualAsset.sceneTitle")}
                    </div>
                    <div className="text-xs text-[--text-muted]">
                      {t("visualAsset.sceneHint")}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => createVisualAsset("scene")}
                    disabled={creatingSceneAsset}
                  >
                    {creatingSceneAsset ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    {t("visualAsset.addScene")}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => batchGenerateVisualAssets("scene")}
                    disabled={batchGeneratingScene || sceneAssets.length === 0}
                  >
                    {batchGeneratingScene ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ImageIcon className="h-3.5 w-3.5" />
                    )}
                    {batchGeneratingScene
                      ? t("common.generating")
                      : t("visualAsset.batchGenerate")}
                  </Button>
                </div>
              </div>

              {loadingVisualAssets ? (
                <div className="rounded-xl border border-dashed border-[--border-subtle] p-6 text-center text-sm text-[--text-muted]">
                  {t("common.loading")}
                </div>
              ) : sceneAssets.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[--border-subtle] p-6 text-center text-sm text-[--text-muted]">
                  {t("visualAsset.noScene")}
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {sceneAssets.map((asset) => (
                    <VisualAssetCard
                      key={asset.id}
                      asset={asset}
                      titlePlaceholder={t("visualAsset.sceneName")}
                      promptPlaceholder={t("visualAsset.scenePrompt")}
                      generating={generatingAssetIds.includes(asset.id)}
                      batchGenerating={batchGeneratingScene}
                      onGenerate={generateVisualAssetImage}
                      onSave={updateVisualAsset}
                      onDelete={deleteVisualAsset}
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-primary" />
                  <div>
                    <div className="text-sm font-semibold text-[--text-primary]">
                      {t("visualAsset.propTitle")}
                    </div>
                    <div className="text-xs text-[--text-muted]">
                      {t("visualAsset.propHint")}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => createVisualAsset("prop")}
                    disabled={creatingPropAsset}
                  >
                    {creatingPropAsset ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    {t("visualAsset.addProp")}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => batchGenerateVisualAssets("prop")}
                    disabled={batchGeneratingProp || propAssets.length === 0}
                  >
                    {batchGeneratingProp ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ImageIcon className="h-3.5 w-3.5" />
                    )}
                    {batchGeneratingProp
                      ? t("common.generating")
                      : t("visualAsset.batchGenerate")}
                  </Button>
                </div>
              </div>

              {loadingVisualAssets ? (
                <div className="rounded-xl border border-dashed border-[--border-subtle] p-6 text-center text-sm text-[--text-muted]">
                  {t("common.loading")}
                </div>
              ) : propAssets.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[--border-subtle] p-6 text-center text-sm text-[--text-muted]">
                  {t("visualAsset.noProp")}
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {propAssets.map((asset) => (
                    <VisualAssetCard
                      key={asset.id}
                      asset={asset}
                      titlePlaceholder={t("visualAsset.propName")}
                      promptPlaceholder={t("visualAsset.propPrompt")}
                      generating={generatingAssetIds.includes(asset.id)}
                      batchGenerating={batchGeneratingProp}
                      onGenerate={generateVisualAssetImage}
                      onSave={updateVisualAsset}
                      onDelete={deleteVisualAsset}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      ) : null}
    </div>
  );
}
