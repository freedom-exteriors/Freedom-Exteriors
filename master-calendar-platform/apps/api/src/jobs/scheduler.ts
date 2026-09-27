// Runs each background job on its own cadence from one loop. A job that throws is logged
// and retried next time; it never stops the others. Every job is idempotent, so running
// more than one worker is safe (at worst, duplicate work that the DB constraints absorb).
export interface Job {
  name: string;
  everySeconds: number;
  run: () => Promise<object | void>;
}

export class JobScheduler {
  private lastRun = new Map<string, number>();
  constructor(
    private readonly jobs: Job[],
    private readonly log: (msg: string, extra?: object) => void,
  ) {}

  /** Runs whichever jobs are due at `now` (ms). Exposed for tests. */
  async tick(now = Date.now()): Promise<string[]> {
    const ran: string[] = [];
    for (const job of this.jobs) {
      const last = this.lastRun.get(job.name);
      if (last !== undefined && now - last < job.everySeconds * 1000) continue;
      this.lastRun.set(job.name, now);
      ran.push(job.name);
      const started = Date.now();
      try {
        const result = await job.run();
        const quiet = result && Object.values(result).every((v) => v === 0);
        if (!quiet) this.log(`${job.name} done`, { ms: Date.now() - started, ...(result ?? {}) });
      } catch (err) {
        this.log(`${job.name} failed`, { error: String(err) });
      }
    }
    return ran;
  }
}
