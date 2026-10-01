export function createKeyedLock() {
  const queues = new Map<string, Promise<void>>();

  return {
    async acquire(key: string): Promise<() => void> {
      const previous = queues.get(key) ?? Promise.resolve();
      let release!: () => void;
      const current = new Promise<void>((resolve) => {
        release = resolve;
      });
      const queued = previous.then(() => current);
      queues.set(key, queued);
      await previous;
      return () => {
        release();
        if (queues.get(key) === queued) queues.delete(key);
      };
    },
  };
}
