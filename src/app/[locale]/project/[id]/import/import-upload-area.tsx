"use client";

import { FileText, Sparkles, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ACCEPTED } from "./import-types";

type Props = {
  dragOver: boolean;
  file: File | null;
  handleFile: (f: File) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  setDragOver: (value: boolean) => void;
  setFile: (value: File | null) => void;
  startPipeline: () => void | Promise<void>;
  t: (key: string) => string;
};

export function ImportUploadArea({
  dragOver,
  file,
  handleFile,
  inputRef,
  setDragOver,
  setFile,
  startPipeline,
  t,
}: Props) {
  return (
    <div className="mx-auto w-full max-w-xl space-y-6">
      <div
        className={`relative flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-12 transition-colors ${
          dragOver ? "border-primary bg-primary/5" : file ? "border-emerald-300 bg-emerald-50/50" : "border-[--border-subtle] bg-white"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files[0];
          if (f) handleFile(f);
        }}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />
        {file ? (
          <div className="flex items-center gap-3">
            <FileText className="h-10 w-10 text-emerald-500" />
            <div>
              <p className="text-sm font-medium text-[--text-primary]">{file.name}</p>
              <p className="text-xs text-[--text-muted]">{(file.size / 1024).toFixed(1)} KB</p>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setFile(null);
              }}
              className="ml-2 flex h-6 w-6 items-center justify-center rounded-full hover:bg-black/5"
            >
              <X className="h-3.5 w-3.5 text-[--text-muted]" />
            </button>
          </div>
        ) : (
          <>
            <Upload className="mb-3 h-10 w-10 text-[--text-muted]" />
            <p className="text-sm font-medium text-[--text-primary]">{t("dropHint")}</p>
            <p className="mt-1 text-xs text-[--text-muted]">{t("supportedFormats")}</p>
          </>
        )}
      </div>

      <Button onClick={() => void startPipeline()} disabled={!file} className="w-full rounded-xl" size="lg">
        <Sparkles className="mr-2 h-4 w-4" />
        {t("startImport")}
      </Button>
    </div>
  );
}
