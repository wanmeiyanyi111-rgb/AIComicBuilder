import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { id as genId } from "@/lib/id";

const execFileAsync = promisify(execFile);

export async function composeStoryboardGrid(params: {
  panelPaths: string[];
  outputDir?: string;
  tileWidth?: number;
  tileHeight?: number;
}): Promise<string> {
  if (params.panelPaths.length !== 4) {
    throw new Error(`Storyboard grid requires exactly 4 panel paths, received ${params.panelPaths.length}`);
  }

  const outputDir = path.resolve(params.outputDir || process.env.UPLOAD_DIR || "./uploads", "storyboards");
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.resolve(outputDir, `storyboard-grid-${genId()}.png`);
  const tileWidth = params.tileWidth ?? 1280;
  const tileHeight = params.tileHeight ?? 720;
  const scaled = params.panelPaths.flatMap((panelPath) => [
    "-i",
    path.resolve(panelPath),
  ]);
  const filter = [
    `[0:v]scale=${tileWidth}:${tileHeight}:force_original_aspect_ratio=increase,crop=${tileWidth}:${tileHeight}[a0]`,
    `[1:v]scale=${tileWidth}:${tileHeight}:force_original_aspect_ratio=increase,crop=${tileWidth}:${tileHeight}[a1]`,
    `[2:v]scale=${tileWidth}:${tileHeight}:force_original_aspect_ratio=increase,crop=${tileWidth}:${tileHeight}[a2]`,
    `[3:v]scale=${tileWidth}:${tileHeight}:force_original_aspect_ratio=increase,crop=${tileWidth}:${tileHeight}[a3]`,
    `[a0][a1][a2][a3]xstack=inputs=4:layout=0_0|${tileWidth}_0|0_${tileHeight}|${tileWidth}_${tileHeight}[v]`,
  ].join(";");

  await execFileAsync("ffmpeg", [
    "-y",
    ...scaled,
    "-filter_complex",
    filter,
    "-map",
    "[v]",
    "-frames:v",
    "1",
    outputPath,
  ]);

  return outputPath;
}
