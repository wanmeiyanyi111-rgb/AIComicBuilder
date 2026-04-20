"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ExtractedCharacter, SplitEpisode } from "./import-types";

type Props = {
  characters: ExtractedCharacter[];
  episodes: SplitEpisode[];
  runGenerate: () => void | Promise<void>;
  removeEpisode: (idx: number) => void;
  t: (key: string) => string;
  updateEpisode: (idx: number, field: keyof SplitEpisode, value: string) => void;
};

export function ImportEpisodeReview({
  characters,
  episodes,
  runGenerate,
  removeEpisode,
  t,
  updateEpisode,
}: Props) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-bold text-[--text-primary]">
          {t("reviewEpisodes")} ({episodes.length})
        </h3>
        <Button onClick={() => void runGenerate()} className="rounded-xl">
          {t("confirmAndGenerate")}
        </Button>
      </div>
      <p className="text-sm text-[--text-muted]">{t("reviewEpisodesHint")}</p>
      <div className="space-y-3">
        {episodes.map((ep, idx) => (
          <div key={idx} className="rounded-xl border border-[--border-subtle] bg-white p-4">
            <div className="mb-2 flex items-center gap-3">
              <span className="shrink-0 rounded-md bg-primary/10 px-2 py-0.5 font-mono text-xs font-semibold text-primary">
                EP.{String(idx + 1).padStart(2, "0")}
              </span>
              <Input
                value={ep.title}
                onChange={(e) => updateEpisode(idx, "title", e.target.value)}
                className="h-8 text-sm font-semibold"
              />
              <button onClick={() => removeEpisode(idx)} className="shrink-0 text-[--text-muted] hover:text-red-500">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-[--text-muted]">{ep.description}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700">目标 {ep.targetDurationSec || 150}s</span>
              <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-[10px] font-medium text-cyan-700">预计 {ep.estimatedDurationSec || ep.targetDurationSec || 150}s</span>
              <span className="rounded-full bg-fuchsia-50 px-2 py-0.5 text-[10px] font-medium text-fuchsia-700">短剧模式</span>
            </div>
            {(ep.hook || ep.coreConflict || ep.cliffhanger) && (
              <div className="mt-2 grid gap-1 rounded-lg bg-[--surface] p-2 text-[11px] text-[--text-secondary]">
                {ep.hook && <div><span className="font-semibold text-[--text-primary]">钩子：</span>{ep.hook}</div>}
                {ep.coreConflict && <div><span className="font-semibold text-[--text-primary]">冲突：</span>{ep.coreConflict}</div>}
                {ep.turningPoint && <div><span className="font-semibold text-[--text-primary]">转折：</span>{ep.turningPoint}</div>}
                {ep.cliffhanger && <div><span className="font-semibold text-[--text-primary]">悬念：</span>{ep.cliffhanger}</div>}
              </div>
            )}
            {ep.validationIssues && ep.validationIssues.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {ep.validationIssues.map((issue) => (
                  <span key={`${ep.title}-${issue}`} className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                    {issue}
                  </span>
                ))}
              </div>
            )}
            {ep.characters && ep.characters.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {ep.characters.map((name) => {
                  const isMain = characters.some((c) => c.name === name && c.scope === "main");
                  return (
                    <span key={name} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${isMain ? "bg-blue-50 text-blue-600" : "bg-purple-50 text-purple-600"}`}>
                      {name}
                    </span>
                  );
                })}
              </div>
            )}
            {ep.scenes && ep.scenes.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {ep.scenes.map((name) => (
                  <span key={`scene-${name}`} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
                    场景·{name}
                  </span>
                ))}
              </div>
            )}
            {ep.props && ep.props.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {ep.props.map((name) => (
                  <span key={`prop-${name}`} className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                    道具·{name}
                  </span>
                ))}
              </div>
            )}
            {ep.keywords && (
              <div className="mt-2 flex flex-wrap gap-1">
                {ep.keywords.split(/[,，]/).map((kw) => kw.trim()).filter(Boolean).map((kw) => (
                  <span key={kw} className="rounded bg-primary/8 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                    {kw}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
