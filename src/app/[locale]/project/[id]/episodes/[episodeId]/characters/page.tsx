"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useProjectStore } from "@/stores/project-store";
import { useModelStore } from "@/stores/model-store";
import { CharacterCard } from "@/components/editor/character-card";
import { Button } from "@/components/ui/button";
import {
  Users,
  Sparkles,
  ImageIcon,
  Loader2,
} from "lucide-react";
import { InlineModelPicker } from "@/components/editor/model-selector";
import { apiFetch } from "@/lib/api-fetch";
import { useModelGuard } from "@/hooks/use-model-guard";
import { PromptEditButton } from "@/components/prompt-templates/prompt-edit-button";
import { VisualAssetsSection } from "./visual-assets-section";
import { useEpisodeCharacters } from "./use-episode-characters";

export default function EpisodeCharactersPage() {
  const t = useTranslations();
  const router = useRouter();
  const locale = useLocale();
  const { project, fetchProject } = useProjectStore();
  const currentEpisodeId = useProjectStore((s) => s.currentEpisodeId);
  const getModelConfig = useModelStore((s) => s.getModelConfig);
  const textGuard = useModelGuard("text");
  const imageGuard = useModelGuard("image");

  const hasCharactersWithoutImages = project?.characters.some((c) => !c.referenceImage) ?? false;
  const {
    batchGeneratingProp,
    batchGeneratingScene,
    batchGenerateVisualAssets,
    createVisualAsset,
    creatingPropAsset,
    creatingSceneAsset,
    deleteVisualAsset,
    extracting,
    extractingVisualCandidates,
    generateVisualAssetImage,
    generatingAssetIds,
    generatingImages,
    handleBatchGenerateImages,
    handleExtractCharacters,
    handleExtractVisualCandidates,
    loadingVisualAssets,
    updateVisualAsset,
    visualAssets,
  } = useEpisodeCharacters({
    currentEpisodeId,
    fetchProject,
    getModelConfig,
    imageGuard,
    locale,
    project,
    routerPush: router.push,
    t,
    textGuard,
  });

  if (!project) return null;

  const sceneAssets = visualAssets.filter((asset) => asset.type === "scene");
  const propAssets = visualAssets.filter((asset) => asset.type === "prop");

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
            <VisualAssetsSection
              assets={sceneAssets}
              batchGenerating={batchGeneratingScene}
              emptyText={t("visualAsset.noScene")}
              generatingAssetIds={generatingAssetIds}
              icon="scene"
              loading={loadingVisualAssets}
              onAdd={() => void createVisualAsset("scene")}
              onBatchGenerate={() => void batchGenerateVisualAssets("scene")}
              onDelete={deleteVisualAsset}
              onGenerate={generateVisualAssetImage}
              onSave={updateVisualAsset}
              addLabel={t("visualAsset.addScene")}
              batchLabel={t("visualAsset.batchGenerate")}
              title={t("visualAsset.sceneTitle")}
              hint={t("visualAsset.sceneHint")}
              titlePlaceholder={t("visualAsset.sceneName")}
              promptPlaceholder={t("visualAsset.scenePrompt")}
              addBusy={creatingSceneAsset}
              t={t}
            />

            <VisualAssetsSection
              assets={propAssets}
              batchGenerating={batchGeneratingProp}
              emptyText={t("visualAsset.noProp")}
              generatingAssetIds={generatingAssetIds}
              icon="prop"
              loading={loadingVisualAssets}
              onAdd={() => void createVisualAsset("prop")}
              onBatchGenerate={() => void batchGenerateVisualAssets("prop")}
              onDelete={deleteVisualAsset}
              onGenerate={generateVisualAssetImage}
              onSave={updateVisualAsset}
              addLabel={t("visualAsset.addProp")}
              batchLabel={t("visualAsset.batchGenerate")}
              title={t("visualAsset.propTitle")}
              hint={t("visualAsset.propHint")}
              titlePlaceholder={t("visualAsset.propName")}
              promptPlaceholder={t("visualAsset.propPrompt")}
              addBusy={creatingPropAsset}
              t={t}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
