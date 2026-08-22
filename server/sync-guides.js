export async function mapWithConcurrency(entries, concurrency, worker) {
  const results = new Array(entries.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < entries.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = { status: 'fulfilled', value: await worker(entries[index], index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), entries.length) }, runWorker));
  return results;
}
