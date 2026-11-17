/**
 * Wait for the Tailscale address, then open the cross-broker listener.
 *
 * After a reboot the broker unit can start before Tailscale has an address,
 * or while the address is not yet assignable (bind throws). Either way the
 * attempt counts as "not ready": sleep with a growing, capped backoff and try
 * again, forever. Resolves with the bound address.
 */

export interface TailnetBindDeps {
  detect: () => Promise<string | null>;
  bind: (ip: string) => void;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

const FIRST_DELAY_MS = 2_000;
const MAX_DELAY_MS = 30_000;

export async function bindTailnetWhenReady(deps: TailnetBindDeps): Promise<string> {
  let delay = FIRST_DELAY_MS;
  let failures = 0;
  for (;;) {
    const ip = await deps.detect();
    let reason = "Tailscale not detected";
    if (ip) {
      try {
        deps.bind(ip);
        if (failures > 0) {
          deps.log(`[claude-peers broker] Tailscale ready — peer listener bound to ${ip} after ${failures} retries`);
        }
        return ip;
      } catch (e) {
        reason = `bind ${ip} failed (${e instanceof Error ? e.message : String(e)})`;
      }
    }
    if (failures === 0) {
      deps.log(`[claude-peers broker] WARNING: brokers.json present but ${reason} — peer listener will retry until it binds.`);
    }
    failures++;
    await deps.sleep(delay);
    delay = Math.min(delay * 2, MAX_DELAY_MS);
  }
}
