// Display names for personas (SPEC 1) and narration languages.

import type { Persona } from "../api/client";
import type { Language } from "../whatif/whatif";

export const LANG_LABEL: Record<Language, string> = { en: "EN", zh: "中文" };

export const PERSONA_LABEL: Record<Persona, string> = {
  casual: "Casual fan",
  analyst: "Analyst",
  player_fan: "Player fan",
  coach: "Coach",
  audio_description: "Audio description",
};
