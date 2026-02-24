/**
 * Public-facing AI label. Used everywhere in the UI.
 * Internal provider routing (OpenAI/Anthropic) is never exposed to the client.
 */
export function getPublicAiLabel(): string {
  return 'OpinIA AI';
}
