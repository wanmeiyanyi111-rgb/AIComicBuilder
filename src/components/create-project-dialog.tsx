"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { Plus, Loader2, Sparkles } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import {
  DEFAULT_PROJECT_STYLE,
  PROJECT_STYLE_IDS,
  type ProjectStyleId,
} from "@/lib/project-style";
import {
  DEFAULT_SHOT_TRANSITION_PROFILE,
  SHOT_TRANSITION_PROFILE_IDS,
  type ShotTransitionProfileId,
} from "@/lib/shot-transition-profile";

export function CreateProjectDialog() {
  const t = useTranslations();
  const router = useRouter();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [styleId, setStyleId] = useState<ProjectStyleId>(DEFAULT_PROJECT_STYLE);
  const [transitionProfileId, setTransitionProfileId] =
    useState<ShotTransitionProfileId>(DEFAULT_SHOT_TRANSITION_PROFILE);
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    if (!title.trim()) return;
    setLoading(true);

    const res = await apiFetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, styleId }),
    });

    const project = await res.json();
    try {
      await apiFetch(`/api/projects/${project.id}/prompt-templates/shot_split`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "slots",
          slots: { transition_profile_id: transitionProfileId },
        }),
      });
    } catch (err) {
      console.warn("[CreateProject] Failed to save transition profile:", err);
    }

    setOpen(false);
    setTitle("");
    setStyleId(DEFAULT_PROJECT_STYLE);
    setTransitionProfileId(DEFAULT_SHOT_TRANSITION_PROFILE);
    setLoading(false);
    router.push(`/${locale}/project/${project.id}/script`);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button size="sm" className="gap-1.5" />}
      >
        <Plus className="h-3.5 w-3.5" />
        {t("dashboard.newProject")}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[--primary]" />
            {t("dashboard.newProject")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="title">{t("project.title")}</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="My Epic Comic..."
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  handleCreate();
                }
              }}
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="project-style">{t("dashboard.styleLabel")}</Label>
            <select
              id="project-style"
              value={styleId}
              onChange={(e) => setStyleId(e.target.value as ProjectStyleId)}
              className="w-full rounded-md border border-[--border-subtle] bg-white px-3 py-2 text-sm text-[--text-primary] outline-none focus:border-primary"
            >
              {PROJECT_STYLE_IDS.map((id) => (
                <option key={id} value={id}>
                  {t(`dashboard.styleOptions.${id}`)}
                </option>
              ))}
            </select>
            <p className="text-xs text-[--text-muted]">{t("dashboard.styleHelp")}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="transition-profile">
              {t("dashboard.transitionProfileLabel")}
            </Label>
            <select
              id="transition-profile"
              value={transitionProfileId}
              onChange={(e) =>
                setTransitionProfileId(e.target.value as ShotTransitionProfileId)
              }
              className="w-full rounded-md border border-[--border-subtle] bg-white px-3 py-2 text-sm text-[--text-primary] outline-none focus:border-primary"
            >
              {SHOT_TRANSITION_PROFILE_IDS.map((id) => (
                <option key={id} value={id}>
                  {t(`dashboard.transitionProfileOptions.${id}`)}
                </option>
              ))}
            </select>
            <p className="text-xs text-[--text-muted]">
              {t("dashboard.transitionProfileHelp")}
            </p>
          </div>
          <Button
            onClick={handleCreate}
            disabled={loading || !title.trim()}
            className="w-full"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading ? t("common.loading") : t("common.create")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
