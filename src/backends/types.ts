/** A secret store. Resolves opaque references to values. */
export interface SecretBackend {
  readonly name: string;
  readonly kind: string;
  /**
   * Resolve references to values. Implementations should batch where the API allows.
   * A missing reference is an error, never an empty string: injecting '' silently
   * would look like a working deploy with a broken app.
   */
  resolve(refs: string[]): Promise<Map<string, string>>;
}

export class SecretError extends Error {
  constructor(message: string, public readonly retryable = true) {
    super(message);
    this.name = 'SecretError';
  }
}
