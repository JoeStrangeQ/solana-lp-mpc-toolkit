export async function retry<T>(
  fn: () => Promise<T>,
  {
    retries = 3,
    initialDelayMs = 150,
    factor = 2,
  }: { retries?: number; initialDelayMs?: number; factor?: number } = {},
): Promise<{ ok: true; value: T } | { ok: false; error: any }> {
  let attempt = 0;
  let delay = initialDelayMs;

  while (attempt <= retries) {
    try {
      const value = await fn();
      return { ok: true, value };
    } catch (err) {
      if (attempt === retries) {
        return { ok: false, error: err };
      }
      await new Promise((res) => setTimeout(res, delay));
      delay *= factor;
      attempt++;
    }
  }

  return { ok: false, error: new Error("Unexpected retry flow") };
}

export function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
