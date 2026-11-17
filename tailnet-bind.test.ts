/**
 * Tailnet listener wait-and-retry test.
 *
 * After a reboot the broker unit can start before Tailscale has an address.
 * bindTailnetWhenReady keeps detecting (and retrying a bind that throws) with
 * a capped growing backoff until the peer listener is up.
 */

import { describe, expect, test } from "bun:test";
import { bindTailnetWhenReady } from "./tailnet-bind.ts";

function harness(detects: (string | null)[], bindFailures = 0) {
  const sleeps: number[] = [];
  const binds: string[] = [];
  const logs: string[] = [];
  let detectCalls = 0;
  let failuresLeft = bindFailures;
  const deps = {
    detect: async () => {
      const ip = detects[Math.min(detectCalls, detects.length - 1)] ?? null;
      detectCalls++;
      return ip;
    },
    bind: (ip: string) => {
      if (failuresLeft > 0) {
        failuresLeft--;
        throw new Error("EADDRNOTAVAIL");
      }
      binds.push(ip);
    },
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    log: (line: string) => {
      logs.push(line);
    },
  };
  return { deps, sleeps, binds, logs, detectCalls: () => detectCalls };
}

describe("bindTailnetWhenReady", () => {
  test("address present at first try binds once with no sleep and no warning", async () => {
    const h = harness(["100.64.0.5"]);
    const ip = await bindTailnetWhenReady(h.deps);
    expect(ip).toBe("100.64.0.5");
    expect(h.binds).toEqual(["100.64.0.5"]);
    expect(h.sleeps).toEqual([]);
    expect(h.logs).toEqual([]);
  });

  test("address absent N times then present binds once after N growing, capped sleeps", async () => {
    const h = harness([null, null, null, null, null, null, null, "100.64.0.5"]);
    const ip = await bindTailnetWhenReady(h.deps);
    expect(ip).toBe("100.64.0.5");
    expect(h.binds).toEqual(["100.64.0.5"]);
    expect(h.detectCalls()).toBe(8);
    expect(h.sleeps).toEqual([2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
  });

  test("bind throwing once then succeeding still ends bound", async () => {
    const h = harness(["100.64.0.5"], 1);
    const ip = await bindTailnetWhenReady(h.deps);
    expect(ip).toBe("100.64.0.5");
    expect(h.binds).toEqual(["100.64.0.5"]);
    expect(h.sleeps).toEqual([2_000]);
  });

  test("logs the not-detected warning once and one line when it finally binds", async () => {
    const h = harness([null, null, null, "100.64.0.5"], 2);
    await bindTailnetWhenReady(h.deps);
    const warnings = h.logs.filter((l) => l.includes("will retry"));
    expect(warnings).toHaveLength(1);
    const bound = h.logs.filter((l) => l.includes("100.64.0.5") && l.includes("after"));
    expect(bound).toHaveLength(1);
    expect(h.logs).toHaveLength(2);
  });
});
