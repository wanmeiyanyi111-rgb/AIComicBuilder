"use client";

import Link from "next/link";
import { ChevronDown, Download, Film, GitCompare, LayoutGrid, List, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { StoryboardControlPanelProps } from "./storyboard-control-panel-types";

type Props = Pick<
  StoryboardControlPanelProps,
  | "anyGenerating"
  | "compareMode"
  | "locale"
  | "onDownloadAll"
  | "onSelectVersion"
  | "onSetCompareMode"
  | "onToggleVersionDropdown"
  | "previewHref"
  | "selectedVersionId"
  | "switchView"
  | "t"
  | "totalShots"
  | "versionDropdownOpen"
  | "versionDropdownRef"
  | "versions"
  | "viewMode"
  | "handleGenerateShots"
>;

export function StoryboardPanelHeader({
  anyGenerating,
  compareMode,
  onDownloadAll,
  onSelectVersion,
  onSetCompareMode,
  onToggleVersionDropdown,
  previewHref,
  selectedVersionId,
  switchView,
  t,
  totalShots,
  versionDropdownOpen,
  versionDropdownRef,
  versions,
  viewMode,
  handleGenerateShots,
}: Props) {
  return (
    <>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
            <Film className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="font-display text-xl font-bold tracking-tight text-[--text-primary]">
              {t("project.storyboard")}
            </h2>
            <p className="text-xs text-[--text-muted]">{totalShots} shots</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {totalShots > 0 && (
            <div className="inline-flex gap-1 rounded-xl border border-[--border-subtle] bg-[--surface] p-1">
              <button
                onClick={() => switchView("list")}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-all duration-150 ${
                  viewMode === "list"
                    ? "bg-white text-primary shadow ring-1 ring-primary/20"
                    : "text-[--text-muted] hover:bg-white/60 hover:text-[--text-secondary]"
                }`}
              >
                <List className={`h-3.5 w-3.5 ${viewMode === "list" ? "text-primary" : ""}`} />
                {t("project.viewList")}
              </button>
              <button
                onClick={() => switchView("kanban")}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-all duration-150 ${
                  viewMode === "kanban"
                    ? "bg-white text-primary shadow ring-1 ring-primary/20"
                    : "text-[--text-muted] hover:bg-white/60 hover:text-[--text-secondary]"
                }`}
              >
                <LayoutGrid className={`h-3.5 w-3.5 ${viewMode === "kanban" ? "text-primary" : ""}`} />
                {t("project.viewKanban")}
              </button>
            </div>
          )}
          {totalShots > 0 && versions.length >= 2 && (
            <Button
              variant={compareMode ? "default" : "outline"}
              size="sm"
              onClick={() => onSetCompareMode(!compareMode)}
            >
              <GitCompare className="h-3.5 w-3.5" />
              {compareMode
                ? t("project.exitCompare") || "Exit Compare"
                : t("project.compareVersions") || "Compare Versions"}
            </Button>
          )}
          {totalShots > 0 && (
            <Link
              href={previewHref}
              className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium shadow-xs hover:bg-accent hover:text-accent-foreground"
            >
              <Film className="h-3.5 w-3.5" />
              {t("project.preview")}
            </Link>
          )}
          {totalShots > 0 && (
            <Button variant="outline" size="sm" onClick={onDownloadAll}>
              <Download className="h-3.5 w-3.5" />
              {t("project.downloadAll")}
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div />
        {versions.length > 0 && (
          <div className="flex items-center gap-1">
            {versions.slice(0, 2).map((v) => (
              <button
                key={v.id}
                onClick={() => onSelectVersion(v.id)}
                className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
                  selectedVersionId === v.id
                    ? "bg-primary/10 text-primary"
                    : "text-[--text-muted] hover:bg-[--surface] hover:text-[--text-secondary]"
                }`}
              >
                {v.label}
              </button>
            ))}
            {versions.length > 2 && (
              <div className="relative" ref={versionDropdownRef}>
                <button
                  onClick={() => onToggleVersionDropdown((o) => !o)}
                  className={`flex items-center gap-0.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
                    versions.slice(2).some((v) => v.id === selectedVersionId)
                      ? "bg-primary/10 text-primary"
                      : "text-[--text-muted] hover:bg-[--surface] hover:text-[--text-secondary]"
                  }`}
                >
                  {versions.slice(2).some((v) => v.id === selectedVersionId)
                    ? versions.find((v) => v.id === selectedVersionId)?.label
                    : `+${versions.length - 2}`}
                  <ChevronDown
                    className={`h-3 w-3 transition-transform ${versionDropdownOpen ? "rotate-180" : ""}`}
                  />
                </button>
                {versionDropdownOpen && (
                  <div
                    className="absolute right-0 top-full z-20 mt-1 min-w-[140px] overflow-hidden rounded-xl border border-[--border-subtle] bg-white shadow-lg"
                    onMouseLeave={() => onToggleVersionDropdown(false)}
                  >
                    {versions.slice(2).map((v) => (
                      <button
                        key={v.id}
                        onClick={() => {
                          onSelectVersion(v.id);
                          onToggleVersionDropdown(false);
                        }}
                        className={`w-full px-3 py-2 text-left text-[13px] font-medium transition-colors hover:bg-[--surface] ${
                          selectedVersionId === v.id ? "text-primary" : "text-[--text-secondary]"
                        }`}
                      >
                        {v.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button
              onClick={handleGenerateShots}
              disabled={anyGenerating}
              className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[13px] text-[--text-muted] transition-colors hover:bg-[--surface] hover:text-[--text-secondary] disabled:opacity-40"
              title={t("project.generateShots")}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </>
  );
}
