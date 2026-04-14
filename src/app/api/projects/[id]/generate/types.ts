import type { ProviderConfig } from "@/lib/ai/ai-sdk";

export interface ModelConfig {
  text?: ProviderConfig | null;
  image?: ProviderConfig | null;
  video?: ProviderConfig | null;
}
