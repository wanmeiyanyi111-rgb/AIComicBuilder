import { toast } from "sonner";
import type { Dispatch, SetStateAction } from "react";
import type { Shot } from "@/stores/project-store";
import type {
  DirectorControl,
  PreflightFixDiffRecord,
  PreflightRunState,
  VideoPreflightResponse,
} from "./storyboard-preflight-utils";
import {
  createEmptyPreflightResponse,
  mergePreflightResponses,
} from "./storyboard-preflight-utils";

type StoryboardGenerationMode = "storyboard_grid" | "reference";

type ProgressState = {
  total: number;
  completed: number;
  running: number;
  failed: number;
} | null;

type Params = {
  directorControl: DirectorControl;
  generationMode: StoryboardGenerationMode;
  runVideoPreflightRequest: (shotIds?: string[]) => Promise<VideoPreflightResponse>;
  setPreflightFixDiffs: Dispatch<
    SetStateAction<Record<string, PreflightFixDiffRecord>>
  >;
  setPreflightProgress: Dispatch<SetStateAction<ProgressState>>;
  setPreflightResult: Dispatch<SetStateAction<VideoPreflightResponse | null>>;
  setPreflightShotErrors: Dispatch<SetStateAction<Record<string, string>>>;
  setPreflightShotStates: Dispatch<
    SetStateAction<Record<string, PreflightRunState>>
  >;
  setRunningVideoPreflight: Dispatch<SetStateAction<boolean>>;
  shots: Shot[];
  tr: (key: string, fallback: string, values?: Record<string, string | number>) => string;
};

export function useStoryboardPreflightRunner({
  directorControl,
  generationMode,
  runVideoPreflightRequest,
  setPreflightFixDiffs,
  setPreflightProgress,
  setPreflightResult,
  setPreflightShotErrors,
  setPreflightShotStates,
  setRunningVideoPreflight,
  shots,
  tr,
}: Params) {
  async function handleRunVideoPreflight() {
    const targetShots = [...shots].sort((a, b) => a.sequence - b.sequence);
    if (targetShots.length === 0) return;

    setRunningVideoPreflight(true);
    setPreflightFixDiffs({});
    setPreflightShotErrors({});
    setPreflightShotStates(
      Object.fromEntries(
        targetShots.map((shot) => [shot.id, "pending" as PreflightRunState])
      )
    );
    setPreflightProgress({
      total: targetShots.length,
      completed: 0,
      running: 0,
      failed: 0,
    });

    let mergedResult = createEmptyPreflightResponse(
      generationMode,
      directorControl,
      targetShots.length
    );
    setPreflightResult(mergedResult);

    try {
      const concurrency = Math.min(3, Math.max(1, targetShots.length));
      let nextIndex = 0;

      const runWorker = async () => {
        while (true) {
          const currentIndex = nextIndex;
          nextIndex += 1;
          if (currentIndex >= targetShots.length) return;
          const shot = targetShots[currentIndex];

          setPreflightShotStates((current) => ({
            ...current,
            [shot.id]: "running",
          }));
          setPreflightProgress((current) =>
            current ? { ...current, running: current.running + 1 } : current
          );

          try {
            const data = await runVideoPreflightRequest([shot.id]);
            mergedResult = mergePreflightResponses(mergedResult, data);
            setPreflightResult(mergedResult);
            setPreflightShotStates((current) => ({
              ...current,
              [shot.id]: "done",
            }));
            setPreflightProgress((current) =>
              current
                ? {
                    ...current,
                    completed: current.completed + 1,
                    running: Math.max(0, current.running - 1),
                  }
                : current
            );
          } catch (err) {
            const message =
              err instanceof Error
                ? err.message
                : tr("storyboard.preflightRunError", "连续性预检失败");
            setPreflightShotStates((current) => ({
              ...current,
              [shot.id]: "error",
            }));
            setPreflightShotErrors((current) => ({
              ...current,
              [shot.id]: message,
            }));
            setPreflightProgress((current) =>
              current
                ? {
                    ...current,
                    failed: current.failed + 1,
                    running: Math.max(0, current.running - 1),
                  }
                : current
            );
          }
        }
      };

      await Promise.all(Array.from({ length: concurrency }, () => runWorker()));

      if (mergedResult.summary.fail > 0) {
        toast.error(
          tr("storyboard.preflightSummaryFail", "{fail}/{total} 个镜头未通过预检（均分 {score}）", {
            fail: mergedResult.summary.fail,
            total: mergedResult.summary.total,
            score: mergedResult.summary.averageScore,
          })
        );
      } else {
        toast.success(
          tr("storyboard.preflightSummaryPass", "预检通过，共 {total} 个镜头（均分 {score}）", {
            total: mergedResult.summary.total,
            score: mergedResult.summary.averageScore,
          })
        );
      }
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : tr("storyboard.preflightRunError", "连续性预检失败")
      );
    } finally {
      setRunningVideoPreflight(false);
      setPreflightProgress((current) =>
        current ? { ...current, running: 0 } : current
      );
    }
  }

  return { handleRunVideoPreflight };
}
