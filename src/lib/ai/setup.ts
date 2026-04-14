import { setDefaultAIProvider, setDefaultVideoProvider } from "./index";
import { OpenAIProvider } from "./providers/openai";
import { GeminiProvider } from "./providers/gemini";
import { SeedanceProvider } from "./providers/seedance";

let initialized = false;

export function initializeProviders() {
  if (initialized) return;

  const hasOpenAICompat = !!(
    process.env.OPENAI_COMPAT_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim()
  );
  const hasSeedanceCompat = !!(
    process.env.VOLCENGINE_VIDEO_API_KEY?.trim() ||
    process.env.SEEDANCE_API_KEY?.trim()
  );

  if (hasOpenAICompat) {
    setDefaultAIProvider(
      new OpenAIProvider(),
      (uploadDir) => new OpenAIProvider({ ...(uploadDir && { uploadDir }) }),
    );
  } else if (process.env.GEMINI_API_KEY) {
    setDefaultAIProvider(
      new GeminiProvider(),
      (uploadDir) => new GeminiProvider({ ...(uploadDir && { uploadDir }) }),
    );
  }

  if (hasSeedanceCompat) {
    setDefaultVideoProvider(
      new SeedanceProvider(),
      (uploadDir) => new SeedanceProvider({ ...(uploadDir && { uploadDir }) }),
    );
  }

  initialized = true;
}
