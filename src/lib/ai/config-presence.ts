type MaybeModelConfig = {
  text?: { apiKey?: string | null } | null;
  image?: { apiKey?: string | null } | null;
  video?: { apiKey?: string | null } | null;
} | null | undefined;

function hasApiKey(value?: string | null): boolean {
  return !!value?.trim();
}

export function hasTextModelConfig(modelConfig?: MaybeModelConfig): boolean {
  if (hasApiKey(modelConfig?.text?.apiKey)) return true;
  return (
    hasApiKey(process.env.OPENAI_COMPAT_API_KEY) ||
    hasApiKey(process.env.OPENAI_API_KEY) ||
    hasApiKey(process.env.GEMINI_API_KEY)
  );
}

export function hasImageModelConfig(modelConfig?: MaybeModelConfig): boolean {
  if (hasApiKey(modelConfig?.image?.apiKey)) return true;
  return (
    hasApiKey(process.env.WUYINKEJI_API_KEY) ||
    hasApiKey(process.env.IMAGE_MODEL_API_KEY) ||
    hasApiKey(process.env.OPENAI_COMPAT_API_KEY) ||
    hasApiKey(process.env.OPENAI_API_KEY) ||
    hasApiKey(process.env.GEMINI_API_KEY)
  );
}

export function hasVideoModelConfig(modelConfig?: MaybeModelConfig): boolean {
  if (hasApiKey(modelConfig?.video?.apiKey)) return true;
  return (
    hasApiKey(process.env.VOLCENGINE_VIDEO_API_KEY) ||
    hasApiKey(process.env.SEEDANCE_API_KEY) ||
    hasApiKey(process.env.OPENAI_COMPAT_API_KEY) ||
    hasApiKey(process.env.GEMINI_API_KEY)
  );
}
