/**
 * Errors shared by the source-access tools.
 *
 * `MissingApiKeyError` exists so a caller that needs the Anthropic API reports
 * SKIPPED rather than fabricating a result. See docs/pipeline-principles.md,
 * "Never report a number you did not measure".
 */

export class MissingApiKeyError extends Error {
  constructor(message = 'ANTHROPIC_API_KEY is not set') {
    super(message);
    this.name = 'MissingApiKeyError';
  }
}
