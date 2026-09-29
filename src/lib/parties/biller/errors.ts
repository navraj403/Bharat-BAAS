/** Typed errors the biller's route handlers map to HTTP statuses. Owner: agent B. */

/** Unknown biller id (route → 404 NOT_FOUND). */
export class UnknownBillerError extends Error {
  readonly code = "NOT_FOUND";
  constructor(billerId: string) {
    super(`Unknown biller: ${billerId}`);
    this.name = "UnknownBillerError";
  }
}
