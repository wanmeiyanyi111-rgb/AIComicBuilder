"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ShotCardDialogsProps {
  openPanelPrompts: boolean;
  openVideoPrompt: boolean;
  panelPrompts: string[];
  shotId: string;
  videoPrompt: string | null;
  onOpenPanelPromptsChange: (open: boolean) => void;
  onOpenVideoPromptChange: (open: boolean) => void;
}

export function ShotCardDialogs({
  openPanelPrompts,
  openVideoPrompt,
  panelPrompts,
  shotId,
  videoPrompt,
  onOpenPanelPromptsChange,
  onOpenVideoPromptChange,
}: ShotCardDialogsProps) {
  return (
    <>
      <Dialog open={openPanelPrompts} onOpenChange={onOpenPanelPromptsChange}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>四宫格提示词组</DialogTitle>
          </DialogHeader>
          {panelPrompts.length === 0 ? (
            <div className="rounded-2xl bg-slate-50 px-4 py-8 text-center text-sm text-[--text-muted]">
              暂无四宫格提示词
            </div>
          ) : (
            <div className="grid max-h-[70vh] gap-3 overflow-y-auto pr-1 md:grid-cols-2">
              {panelPrompts.map((prompt, index) => (
                <div
                  key={`${shotId}-dialog-panel-${index}`}
                  className="rounded-2xl border border-slate-200 bg-[linear-gradient(180deg,#fff,#f8fafc)] p-4 shadow-sm"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-primary">第 {index + 1} 格</div>
                    <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-semibold text-primary">
                      Panel
                    </span>
                  </div>
                  <div className="whitespace-pre-wrap text-sm leading-7 text-[--text-secondary]">
                    {prompt || "暂无提示词"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={openVideoPrompt} onOpenChange={onOpenVideoPromptChange}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>视频提示词</DialogTitle>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto whitespace-pre-wrap rounded-2xl bg-slate-50 px-4 py-4 text-sm leading-7 text-[--text-secondary]">
            {videoPrompt || "暂无视频提示词"}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
