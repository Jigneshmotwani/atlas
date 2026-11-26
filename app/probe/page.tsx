// /probe — Device test (W8). Server Component: run counts + the device names the client matches a profile against.
import { DeviceTest } from '@/components/probe/DeviceTest';
import type { DeviceName } from '@/components/probe/match';
import { loadDeviceAliases, loadDevices, loadRunStats } from '@/lib/data';

export const revalidate = 3600;

export default async function ProbePage() {
  const [stats, devices, aliases] = await Promise.all([loadRunStats(), loadDevices(), loadDeviceAliases()]);
  const runs = stats.reduce((a, s) => a + s.nRuns, 0);
  const devicesWithRuns = new Set(stats.map(s => s.deviceId)).size;
  const aliasMap = new Map(aliases.map(a => [a.id, a.aliases]));
  const names: DeviceName[] = devices.map(d => ({ id: d.id, name: d.name, aliases: aliasMap.get(d.id) ?? [] }));
  return <DeviceTest runs={runs} devicesWithRuns={devicesWithRuns} devices={names} />;
}
