import { SessionRecords } from '../src/AegisNode';

describe('in-process session records', () => {
  test('are bounded and keep recently used sessions', async () => {
    const records = new SessionRecords(undefined, 1_800_000, undefined, 100);
    const kept = await records.getOrCreate('kept');
    kept.times.push(Date.now());
    for (let i = 0; i < 1000; i++) {
      await records.getOrCreate(`rotating-${i}`);
      if (i % 20 === 0) await records.get('kept');
    }
    expect(records.localSize()).toBeLessThanOrEqual(100);
    expect(await records.get('kept')).toBe(kept);
    expect(await records.get('rotating-0')).toBeUndefined();
  });

  test('expire after the session TTL of inactivity', async () => {
    const records = new SessionRecords(undefined, 1000);
    const record = await records.getOrCreate('old', Date.now() - 5000);
    expect(await records.get('old')).toBeUndefined();
    const fresh = await records.getOrCreate('old');
    expect(fresh).not.toBe(record);
    fresh.times.push(Date.now());
    expect(await records.get('old')).toBe(fresh);
  });
});
