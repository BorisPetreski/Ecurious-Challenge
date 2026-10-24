/** Virtual BayReady allocation keys, never physical plug or bay identities. */
export interface DirectorySlotSource {
  id: number;
  connectors: { type: string; power: number; count: number }[];
}

export interface DirectorySlotGroup {
  stationId: number;
  type: string;
  power: number;
  count: number;
  prefix: string;
}

export interface DirectorySlotHold {
  stationId: number;
  slotKey: string;
  reservedUntil: string;
  isMine: boolean;
  myReservationId: string | null;
}

export type DirectorySlotDigest = (canonical: string) => Promise<string>;

/** Duplicate type/power records share one ordinal space, independent of order. */
export async function buildDirectorySlotGroups(source: DirectorySlotSource, digest: DirectorySlotDigest): Promise<DirectorySlotGroup[]> {
  if (!Number.isSafeInteger(source.id) || source.id < 1) throw new Error('Invalid station ID');
  const merged = new Map<string, { type: string; power: number; count: number }>();
  for (const connector of source.connectors) {
    if (!connector.type || !Number.isFinite(connector.power) || connector.power < 0 || !Number.isSafeInteger(connector.count) || connector.count < 1) throw new Error('Invalid connector group');
    const power = Object.is(connector.power, -0) ? 0 : connector.power;
    const key = JSON.stringify([connector.type, power]);
    const previous = merged.get(key);
    const count = (previous?.count ?? 0) + connector.count;
    if (count > 0xffffffff) throw new Error('Too many virtual slots');
    merged.set(key, { type: connector.type, power, count });
  }
  const groups = [...merged.values()].sort((left, right) => left.type === right.type ? left.power - right.power : left.type < right.type ? -1 : 1);
  return Promise.all(groups.map(async group => {
    const canonical = JSON.stringify(['bayready-directory-v1', source.id, group.type, group.power]);
    const hash = (await digest(canonical)).toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('Invalid slot digest');
    return { ...group, stationId: source.id, prefix: hash.slice(0, 56) };
  }));
}

export function directorySlotKey(group: DirectorySlotGroup, ordinal: number): string {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > group.count || !/^[0-9a-f]{56}$/.test(group.prefix)) throw new Error('Invalid virtual slot ordinal');
  return group.prefix + ordinal.toString(16).padStart(8, '0');
}

export function directorySlotOrdinal(group: DirectorySlotGroup, slotKey: string): number | null {
  if (!/^[0-9a-f]{64}$/.test(slotKey) || !slotKey.startsWith(group.prefix)) return null;
  const ordinal = Number.parseInt(slotKey.slice(56), 16);
  return ordinal >= 1 && ordinal <= group.count ? ordinal : null;
}

/** Expiry timestamps are display evidence. Only a fresh DB read frees a slot. */
export function directoryGroupStatus(group: DirectorySlotGroup, holds: readonly DirectorySlotHold[], fresh: boolean): { total: number; reserved: number | null; unreserved: number | null } {
  if (!fresh) return { total: group.count, reserved: null, unreserved: null };
  const keys = new Set(holds.filter(hold => hold.stationId === group.stationId && directorySlotOrdinal(group, hold.slotKey) !== null).map(hold => hold.slotKey));
  return { total: group.count, reserved: keys.size, unreserved: group.count - keys.size };
}

export function directorySlotPage(group: DirectorySlotGroup, holds: readonly DirectorySlotHold[], { fresh, showReserved, page, pageSize = 12 }: { fresh: boolean; showReserved: boolean; page: number; pageSize?: number }): { ordinals: number[]; total: number } {
  if (!Number.isSafeInteger(page) || page < 0 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('Invalid virtual slot page');
  const held = new Set(holds.filter(hold => hold.stationId === group.stationId).map(hold => hold.slotKey));
  const status = directoryGroupStatus(group, holds, fresh);
  const total = fresh && !showReserved ? status.unreserved ?? 0 : group.count;
  let skip = page * pageSize;
  const ordinals: number[] = [];
  for (let ordinal = 1; ordinal <= group.count && ordinals.length < pageSize; ordinal++) {
    if (fresh && !showReserved && held.has(directorySlotKey(group, ordinal))) continue;
    if (skip > 0) skip--;
    else ordinals.push(ordinal);
  }
  return { ordinals, total };
}
