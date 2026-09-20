/**
 * LLM providers an organization can configure keys for.
 *
 * Ids are opencode provider ids, because the keys end up in the opencode
 * configuration of the VM an agent runs in (services/agent/provisioner.ts).
 */

export interface ProviderDefinition {
  id: string;
  name: string;
  /** Where the provider's console issues keys; shown in the UI. */
  keysUrl: string;
}

export const PROVIDERS: readonly ProviderDefinition[] = [
  { id: "anthropic", name: "Anthropic", keysUrl: "https://console.anthropic.com/settings/keys" },
  { id: "openai", name: "OpenAI", keysUrl: "https://platform.openai.com/api-keys" },
  { id: "google", name: "Google AI", keysUrl: "https://aistudio.google.com/app/apikey" },
  { id: "openrouter", name: "OpenRouter", keysUrl: "https://openrouter.ai/settings/keys" },
  { id: "xai", name: "xAI", keysUrl: "https://console.x.ai" },
  { id: "groq", name: "Groq", keysUrl: "https://console.groq.com/keys" },
  { id: "mistral", name: "Mistral", keysUrl: "https://console.mistral.ai/api-keys" },
  { id: "deepseek", name: "DeepSeek", keysUrl: "https://platform.deepseek.com/api_keys" },
];

export const PROVIDER_IDS = PROVIDERS.map((p) => p.id);

export function findProvider(id: string): ProviderDefinition | undefined {
  return PROVIDERS.find((p) => p.id === id);
}
