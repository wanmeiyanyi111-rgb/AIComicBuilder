import { useState } from "react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api-fetch";
import { useProjectStore } from "@/stores/project-store";

type Params = {
  fetchProject: (projectId: string, episodeId?: string, versionId?: string) => Promise<unknown>;
  project: { id: string } | null;
  selectedVersionId: string | null;
  t: (key: string, values?: Record<string, string | number>) => string;
};

export function useStoryboardReplan({
  fetchProject,
  project,
  selectedVersionId,
  t,
}: Params) {
  const [replanningLongShots, setReplanningLongShots] = useState(false);
  const [previewingReplanLongShots, setPreviewingReplanLongShots] = useState(false);

  async function handleReplanLongShots() {
    if (!project) return;
    setReplanningLongShots(true);
    try {
      const res = await apiFetch(`/api/projects/${project.id}/shots/replan-long`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          episodeId: useProjectStore.getState().currentEpisodeId,
          versionId: selectedVersionId ?? undefined,
        }),
      });
      const data = await res.json();
      if (data.status === "noop") {
        toast.info(t("storyboard.noLongShotsToReplan"));
      } else {
        toast.success(
          t("storyboard.replanLongShotsSuccess", {
            split: data.splitShots ?? 0,
            added: data.addedShots ?? 0,
          })
        );
      }
      await fetchProject(project.id, useProjectStore.getState().currentEpisodeId || undefined);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("storyboard.replanLongShotsError"));
    } finally {
      setReplanningLongShots(false);
    }
  }

  async function handlePreviewReplanLongShots() {
    if (!project) return;
    setPreviewingReplanLongShots(true);
    try {
      const res = await apiFetch(`/api/projects/${project.id}/shots/replan-long`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          episodeId: useProjectStore.getState().currentEpisodeId,
          versionId: selectedVersionId ?? undefined,
          dryRun: true,
        }),
      });
      const data = await res.json();
      if (data.status === "noop") {
        toast.info(t("storyboard.noLongShotsToReplan"));
      } else {
        toast.info(
          t("storyboard.replanLongShotsDryRunSummary", {
            before: data.beforeCount ?? 0,
            after: data.afterCount ?? 0,
            split: data.splitShots ?? 0,
            added: data.addedShots ?? 0,
          })
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("storyboard.replanLongShotsError"));
    } finally {
      setPreviewingReplanLongShots(false);
    }
  }

  return {
    handlePreviewReplanLongShots,
    handleReplanLongShots,
    previewingReplanLongShots,
    replanningLongShots,
  };
}
