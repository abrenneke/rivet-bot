export function getError(err: unknown): Error {
  if (err instanceof Error) {
    return err;
  }
  return new Error(`An unexpected error occurred: ${err}`);
}
