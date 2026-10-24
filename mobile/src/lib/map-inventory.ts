/** Booking inventory: locations contain bays; a bay holds one vehicle. */
export interface InventoryConnector {
  id: string;
  label: string;
  type: string;
  powerKw: number;
  enabled: boolean;
}

export interface InventoryBay {
  id: string;
  label: string;
  locationId: string;
  locationLabel: string;
  latitude: number | null;
  longitude: number | null;
  goingelectricId: number | null;
  availability: 'unreserved' | 'reserved';
  connectors: InventoryConnector[];
}

export interface InventoryFilters {
  connectorType?: string;
  minPower?: number;
  showReserved?: boolean;
  includeFaults?: boolean;
  reportedFaultIds?: ReadonlySet<number>;
}

export interface RegisteredLocation<Bay extends InventoryBay = InventoryBay> {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  bays: Bay[];
  unreservedBayCount: number;
  connectorCount: number;
}

/** Compatibility is independent from whether the bay has an active booking. */
export function matchingConnectors(
  bay: InventoryBay,
  { connectorType, minPower }: Pick<InventoryFilters, 'connectorType' | 'minPower'> = {},
  { includeDisabled = false }: { includeDisabled?: boolean } = {},
): InventoryConnector[] {
  return bay.connectors.filter(connector =>
    (includeDisabled || connector.enabled) &&
    (connectorType === undefined || connector.type === connectorType) &&
    (minPower === undefined || connector.powerKw >= minPower),
  );
}

/** Multiple connectors in one bay never create multiple vehicle spaces. */
export function groupRegisteredLocations<Bay extends InventoryBay>(
  bays: Bay[],
  filters: InventoryFilters = {},
): RegisteredLocation<Bay>[] {
  const groups = new Map<string, RegisteredLocation<Bay>>();
  for (const bay of bays) {
    if (bay.availability === 'reserved' && !filters.showReserved) continue;
    if (bay.goingelectricId !== null && filters.reportedFaultIds?.has(bay.goingelectricId) && !filters.includeFaults) continue;
    const connectors = matchingConnectors(bay, filters);
    if (connectors.length === 0) continue;
    if (typeof bay.latitude !== 'number' || !Number.isFinite(bay.latitude) || Math.abs(bay.latitude) > 90 ||
      typeof bay.longitude !== 'number' || !Number.isFinite(bay.longitude) || Math.abs(bay.longitude) > 180) continue;
    let group = groups.get(bay.locationId);
    if (!group) {
      group = { id: bay.locationId, label: bay.locationLabel, latitude: bay.latitude, longitude: bay.longitude, bays: [], unreservedBayCount: 0, connectorCount: 0 };
      groups.set(bay.locationId, group);
    }
    group.bays.push(bay);
    group.connectorCount += connectors.length;
    if (bay.availability === 'unreserved') group.unreservedBayCount += 1;
  }
  return [...groups.values()];
}
