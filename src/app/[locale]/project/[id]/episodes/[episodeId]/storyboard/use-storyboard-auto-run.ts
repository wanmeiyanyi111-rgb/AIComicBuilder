import { getReferenceAssets } from "@/stores/project-store";
import type { Shot } from "@/stores/project-store";

type Params = {
  generationMode: "storyboard_grid" | "reference";
  handleBatchGenerateFrames: (overwrite?: boolean) => Promise<void>;
  handleBatchGenerateReferenceVideos: (overwrite?: boolean) => Promise<void>;
  handleBatchGenerateSceneFrames: (overwrite?: boolean) => Promise<void>;
  handleBatchGenerateVideoPrompts: () => Promise<void>;
  handleBatchGenerateVideos: (overwrite?: boolean) => Promise<void>;
  handleGenerateRefPrompts: () => Promise<void>;
  handleGenerateShots: () => Promise<void>;
  hasReferenceFrameForShot: (shot: Shot) => boolean;
  hasReferenceVideoForShot: (shot: Shot) => boolean;
  hasStoryboardFrameForShot: (shot: Shot) => boolean;
  hasStoryboardVideoForShot: (shot: Shot) => boolean;
  hasVideoPromptForShot: (shot: Shot) => boolean;
  project: { shots: Shot[] } | null;
  t: (key: string, values?: Record<string, string | number>) => string;
};

export function useStoryboardAutoRun({
  generationMode,
  handleBatchGenerateFrames,
  handleBatchGenerateReferenceVideos,
  handleBatchGenerateSceneFrames,
  handleBatchGenerateVideoPrompts,
  handleBatchGenerateVideos,
  handleGenerateRefPrompts,
  handleGenerateShots,
  hasReferenceFrameForShot,
  hasReferenceVideoForShot,
  hasStoryboardFrameForShot,
  hasStoryboardVideoForShot,
  hasVideoPromptForShot,
  project,
  t,
}: Params) {
  async function handleAutoRun() {
    if (!project) return;
    if (!confirm(t("project.autoRunConfirm"))) return;

    const shots = project.shots;
    const needsText = shots.some((shot) => !shot.prompt && !shot.motionScript);
    const needsFrame = shots.some((shot) =>
      generationMode === "reference"
        ? !hasReferenceFrameForShot(shot)
        : !hasStoryboardFrameForShot(shot)
    );
    const needsPrompt = shots.some((shot) => !hasVideoPromptForShot(shot));
    const needsVideo = shots.some((shot) =>
      generationMode === "reference"
        ? !hasReferenceVideoForShot(shot)
        : !hasStoryboardVideoForShot(shot)
    );

    if (needsText) await handleGenerateShots();
    if (generationMode === "reference") {
      const needsRefPrompts = shots.some((shot) => getReferenceAssets(shot).length === 0);
      if (needsRefPrompts) await handleGenerateRefPrompts();
      if (needsFrame) await handleBatchGenerateSceneFrames(false);
    } else if (needsFrame) {
      await handleBatchGenerateFrames(false);
    }

    if (needsPrompt) await handleBatchGenerateVideoPrompts();
    if (needsVideo) {
      if (generationMode === "reference") await handleBatchGenerateReferenceVideos(false);
      else await handleBatchGenerateVideos(false);
    }
  }

  return { handleAutoRun };
}
