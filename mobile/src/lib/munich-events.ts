import type { AudimaxLock } from './audimax-lock-api';
import type { DirectoryStation } from './goingelectric-api';

export interface MunichEvent {
  id: string;
  title: string;
  subtitle: string;
  category: 'tech' | 'sports' | 'culture' | 'concert';
  emoji: string;
  venue: string;
  address: string;
  latitude: number;
  longitude: number;
  date: string;
  expectedAttendance: string;
  source?: 'eventbrite' | 'demo';
  url?: string;
  startsAt?: string;
}

export interface EventChargingSpot {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  distanceMeters: number;
  totalPlugs: number;
  freePlugs: number;
  maxPowerKw: number;
  connectorTypes: string[];
  network?: string;
  isAudimaxHardware?: boolean;
  stationId?: number;
}

export const MUNICH_MOCK_EVENTS: MunichEvent[] = [
  {
    id: 'watt-the-hack-2026',
    title: 'WATT THE HACK · TUM HackFest',
    subtitle: 'Autonomous EV charging and barrier innovation challenge',
    category: 'tech',
    emoji: '⚡',
    venue: 'Audimax Munich (TUM)',
    address: 'Arcisstraße 21, 80333 München',
    latitude: 48.1488,
    longitude: 11.568,
    date: '24 Oct 2026 · All Day',
    expectedAttendance: '450 hackers & innovators',
  },
  {
    id: 'bayern-der-klassiker',
    title: 'FC Bayern München vs. Borussia Dortmund',
    subtitle: 'Bundesliga Der Klassiker marquee showdown',
    category: 'sports',
    emoji: '⚽',
    venue: 'Allianz Arena',
    address: 'Werner-Heisenberg-Allee 25, 80939 München',
    latitude: 48.2188,
    longitude: 11.6247,
    date: '25 Oct 2026 · 18:30',
    expectedAttendance: '75,000 spectators',
  },
  {
    id: 'oktoberfest-autumn-fest',
    title: 'Munich Autumn Folk & Beer Fest',
    subtitle: 'Traditional Bavarian folk festival and concerts',
    category: 'culture',
    emoji: '🎪',
    venue: 'Theresienwiese',
    address: 'Bavariaring, 80336 München',
    latitude: 48.1314,
    longitude: 11.5497,
    date: '26 Oct 2026 · 12:00–22:00',
    expectedAttendance: '120,000 visitors',
  },
  {
    id: 'coldplay-olympiapark',
    title: 'Music of the Spheres World Tour',
    subtitle: 'Stadium mega-concert with light shows and sustainable energy',
    category: 'concert',
    emoji: '🎸',
    venue: 'Olympiastadion München',
    address: 'Spiridon-Louis-Ring 21, 80809 München',
    latitude: 48.1731,
    longitude: 11.5466,
    date: '27 Oct 2026 · 19:00',
    expectedAttendance: '68,000 fans',
  },
  {
    id: 'bmw-ev-tech-expo',
    title: 'BMW NextGen EV & Mobility Expo',
    subtitle: 'Public showcase of high-power charging & smart grid tech',
    category: 'tech',
    emoji: '🚗',
    venue: 'BMW Welt & Museum',
    address: 'Am Olympiapark 1, 80809 München',
    latitude: 48.177,
    longitude: 11.556,
    date: '28 Oct 2026 · 10:00–18:00',
    expectedAttendance: '15,000 visitors',
  },
  {
    id: 'deutsches-museum-night',
    title: 'Long Night of Science & Technology',
    subtitle: 'Interactive technology exhibits and robotics demonstrations',
    category: 'culture',
    emoji: '🔬',
    venue: 'Deutsches Museum',
    address: 'Museumsinsel 1, 80538 München',
    latitude: 48.1299,
    longitude: 11.5835,
    date: '29 Oct 2026 · 18:00–02:00',
    expectedAttendance: '22,000 visitors',
  },
  {
    id: 'hbf-mobility-days',
    title: 'Munich Central Mobility & Transit Days',
    subtitle: 'Urban mobility transition, intermodal rail & EV charging hub',
    category: 'tech',
    emoji: '🚆',
    venue: 'Munich Central Station (Hauptbahnhof)',
    address: 'Bayerstraße 10A, 80335 München',
    latitude: 48.1402,
    longitude: 11.5583,
    date: '30 Oct 2026 · 09:00–19:00',
    expectedAttendance: '40,000 commuters',
  },
];

/**
 * Pre-seeded realistic Munich EV charging stations distributed across major event hubs.
 */
interface StaticMunichCharger {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  totalPlugs: number;
  freePlugs: number;
  maxPowerKw: number;
  connectorTypes: string[];
  network: string;
}

const STATIC_MUNICH_CHARGERS: StaticMunichCharger[] = [
  // Allianz Arena vicinity
  {
    id: 'charger-arena-p1',
    name: 'SWM Hypercharger Parkhaus Arena P1',
    address: 'Werner-Heisenberg-Allee 21, 80939 München',
    latitude: 48.2195,
    longitude: 11.626,
    totalPlugs: 8,
    freePlugs: 4,
    maxPowerKw: 300,
    connectorTypes: ['CCS', 'Type 2'],
    network: 'Stadtwerke München (SWM)',
  },
  {
    id: 'charger-arena-nord',
    name: 'EnBW Mobility+ Schnellladepark Arena Nord',
    address: 'Lilienthalallee 40, 80939 München',
    latitude: 48.2135,
    longitude: 11.6112,
    totalPlugs: 12,
    freePlugs: 7,
    maxPowerKw: 300,
    connectorTypes: ['CCS'],
    network: 'EnBW',
  },
  {
    id: 'charger-kistlerhof-freimann',
    name: 'Ionity High-Power Charging Freimann',
    address: 'Heidemannstraße 17, 80939 München',
    latitude: 48.2045,
    longitude: 11.602,
    totalPlugs: 6,
    freePlugs: 3,
    maxPowerKw: 350,
    connectorTypes: ['CCS'],
    network: 'IONITY',
  },
  {
    id: 'charger-euro-industriepark',
    name: 'Allego Euro-Industriepark Schnellader',
    address: 'Maria-Probst-Straße 15, 80939 München',
    latitude: 48.201,
    longitude: 11.609,
    totalPlugs: 4,
    freePlugs: 2,
    maxPowerKw: 150,
    connectorTypes: ['CCS', 'CHAdeMO'],
    network: 'Allego',
  },
  {
    id: 'charger-kistlerhof-nord',
    name: 'Tesla Supercharger München-Freimann (All EVs)',
    address: 'Frankfurter Ring 255, 80807 München',
    latitude: 48.188,
    longitude: 11.601,
    totalPlugs: 16,
    freePlugs: 9,
    maxPowerKw: 250,
    connectorTypes: ['CCS'],
    network: 'Tesla Open Supercharger',
  },

  // TUM / Maxvorstadt / Central vicinity
  {
    id: 'charger-tum-arcis',
    name: 'SWM Ladestation TUM Gabelsbergerstraße',
    address: 'Gabelsbergerstraße 35, 80333 München',
    latitude: 48.1495,
    longitude: 11.5695,
    totalPlugs: 4,
    freePlugs: 2,
    maxPowerKw: 22,
    connectorTypes: ['Type 2'],
    network: 'SWM',
  },
  {
    id: 'charger-konigsplatz-hub',
    name: 'EnBW HyperHub Königsplatz / Brienner',
    address: 'Brienner Straße 28, 80333 München',
    latitude: 48.1455,
    longitude: 11.565,
    totalPlugs: 6,
    freePlugs: 3,
    maxPowerKw: 150,
    connectorTypes: ['CCS', 'Type 2'],
    network: 'EnBW',
  },
  {
    id: 'charger-theresienstr-hpc',
    name: 'Stadtwerke München Theresienstraße DC',
    address: 'Theresienstraße 90, 80333 München',
    latitude: 48.151,
    longitude: 11.564,
    totalPlugs: 4,
    freePlugs: 1,
    maxPowerKw: 50,
    connectorTypes: ['CCS', 'CHAdeMO'],
    network: 'SWM',
  },
  {
    id: 'charger-pinakothek-hub',
    name: 'E.ON Drive Pinakotheken Kunstareal',
    address: 'Barer Straße 29, 80333 München',
    latitude: 48.1472,
    longitude: 11.572,
    totalPlugs: 4,
    freePlugs: 2,
    maxPowerKw: 22,
    connectorTypes: ['Type 2'],
    network: 'E.ON Drive',
  },

  // Theresienwiese / Westend vicinity
  {
    id: 'charger-theresienwiese-nord',
    name: 'SWM Ladepark Bavariaring / Theresienwiese',
    address: 'Bavariaring 14, 80336 München',
    latitude: 48.133,
    longitude: 11.551,
    totalPlugs: 6,
    freePlugs: 4,
    maxPowerKw: 150,
    connectorTypes: ['CCS', 'Type 2'],
    network: 'SWM',
  },
  {
    id: 'charger-schwanthaler-dc',
    name: 'EnBW FastCharger Schwanthalerhöhe',
    address: 'Schwanthalerstraße 111, 80336 München',
    latitude: 48.138,
    longitude: 11.545,
    totalPlugs: 4,
    freePlugs: 2,
    maxPowerKw: 300,
    connectorTypes: ['CCS'],
    network: 'EnBW',
  },
  {
    id: 'charger-goetheplatz-hub',
    name: 'SWM CityCharge Goetheplatz',
    address: 'Goethestraße 54, 80336 München',
    latitude: 48.129,
    longitude: 11.558,
    totalPlugs: 4,
    freePlugs: 3,
    maxPowerKw: 22,
    connectorTypes: ['Type 2'],
    network: 'SWM',
  },

  // Olympiapark / BMW Welt vicinity
  {
    id: 'charger-bmw-welt-p1',
    name: 'BMW Welt Parkhaus EV Charging Lounge',
    address: 'Am Olympiapark 1, 80809 München',
    latitude: 48.1765,
    longitude: 11.557,
    totalPlugs: 10,
    freePlugs: 5,
    maxPowerKw: 150,
    connectorTypes: ['CCS', 'Type 2'],
    network: 'BMW Group / SWM',
  },
  {
    id: 'charger-olympiastadion-parkharfe',
    name: 'SWM Schnellladepark Parkharfe Olympiastadion',
    address: 'Sapporobogen 1, 80637 München',
    latitude: 48.171,
    longitude: 11.538,
    totalPlugs: 12,
    freePlugs: 6,
    maxPowerKw: 300,
    connectorTypes: ['CCS', 'Type 2'],
    network: 'SWM',
  },
  {
    id: 'charger-olympiapark-ost',
    name: 'EnBW Mobility+ Spiridon-Louis-Ring',
    address: 'Spiridon-Louis-Ring 25, 80809 München',
    latitude: 48.174,
    longitude: 11.552,
    totalPlugs: 6,
    freePlugs: 3,
    maxPowerKw: 150,
    connectorTypes: ['CCS'],
    network: 'EnBW',
  },

  // Deutsches Museum / Isar vicinity
  {
    id: 'charger-deutsches-museum-insel',
    name: 'SWM Ladepark Museumsinsel / Isartor',
    address: 'Zweibrückenstraße 12, 80331 München',
    latitude: 48.132,
    longitude: 11.582,
    totalPlugs: 6,
    freePlugs: 3,
    maxPowerKw: 50,
    connectorTypes: ['CCS', 'Type 2'],
    network: 'SWM',
  },
  {
    id: 'charger-rosenheimer-platz',
    name: 'Allego HPC Rosenheimer Platz / GEMA',
    address: 'Rosenheimer Straße 11, 81667 München',
    latitude: 48.1285,
    longitude: 11.591,
    totalPlugs: 4,
    freePlugs: 2,
    maxPowerKw: 300,
    connectorTypes: ['CCS'],
    network: 'Allego',
  },
  {
    id: 'charger-gasteig-kultur',
    name: 'SWM Ladestation Gasteig Kulturzentrum',
    address: 'Kellerstraße 8, 81667 München',
    latitude: 48.1315,
    longitude: 11.593,
    totalPlugs: 4,
    freePlugs: 2,
    maxPowerKw: 22,
    connectorTypes: ['Type 2'],
    network: 'SWM',
  },

  // Hauptbahnhof vicinity
  {
    id: 'charger-hbf-bayerstr',
    name: 'EnBW CityHub München Hauptbahnhof',
    address: 'Bayerstraße 14, 80335 München',
    latitude: 48.1398,
    longitude: 11.557,
    totalPlugs: 8,
    freePlugs: 4,
    maxPowerKw: 300,
    connectorTypes: ['CCS'],
    network: 'EnBW',
  },
  {
    id: 'charger-karlsplatz-stachus',
    name: 'SWM Schnelllader Karlsplatz (Stachus)',
    address: 'Sonnenstraße 2, 80331 München',
    latitude: 48.1388,
    longitude: 11.565,
    totalPlugs: 4,
    freePlugs: 2,
    maxPowerKw: 150,
    connectorTypes: ['CCS', 'Type 2'],
    network: 'SWM',
  },
];

/**
 * Calculates geodesic distance in meters between two lat/lon points using the Haversine formula.
 */
export function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3; // Earth radius in meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${meters} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export interface GetClosestOptions {
  audimaxLocks?: AudimaxLock[];
  directoryStations?: DirectoryStation[];
  directoryCounts?: Record<number, { unreserved: number | null; total: number }>;
}

/**
 * Finds and returns the top 5 closest free charging spots to a selected Munich event.
 */
export function getTopClosestFreeChargingSpots(
  event: MunichEvent,
  options?: GetClosestOptions
): EventChargingSpot[] {
  const candidates: EventChargingSpot[] = [];

  // 1. Add Audimax TUM hardware lock if active & vacant
  const audimaxLat = 48.1488;
  const audimaxLon = 11.568;
  const audimaxLocks = options?.audimaxLocks ?? [];
  const freeAudimaxCount = audimaxLocks.filter(
    l => l.carPresence === 'vacant' && l.status !== 'raised'
  ).length;

  candidates.push({
    id: 'audimax-tum-hardware',
    name: 'Audimax TUM · Ecurious Live Hardware Bay',
    address: 'Arcisstraße 21, 80333 München',
    latitude: audimaxLat,
    longitude: audimaxLon,
    distanceMeters: calculateDistanceMeters(event.latitude, event.longitude, audimaxLat, audimaxLon),
    totalPlugs: Math.max(1, audimaxLocks.length),
    freePlugs: freeAudimaxCount > 0 ? freeAudimaxCount : 1, // At least 1 demo slot
    maxPowerKw: 150,
    connectorTypes: ['CCS (Guarded Barrier)'],
    network: 'Ecurious Hardware',
    isAudimaxHardware: true,
  });

  // 2. Add real GoingElectric directory stations fetched for the area if they have unreserved spots
  if (options?.directoryStations) {
    for (const station of options.directoryStations) {
      if (station.faultReported) continue;
      const count = options.directoryCounts?.[station.id];
      const freePlugs = count?.unreserved !== null && count?.unreserved !== undefined ? count.unreserved : 1;
      if (freePlugs <= 0) continue;

      const connectorTypes = Array.from(new Set(station.connectors.map(c => c.type)));
      const maxPower = station.maxPower || Math.max(...station.connectors.map(c => c.power), 22);

      candidates.push({
        id: `directory-${station.id}`,
        name: station.name,
        address: station.address || 'München',
        latitude: station.latitude,
        longitude: station.longitude,
        distanceMeters: calculateDistanceMeters(
          event.latitude,
          event.longitude,
          station.latitude,
          station.longitude
        ),
        totalPlugs: count?.total ?? station.connectors.reduce((sum, c) => sum + c.count, 0) ?? 2,
        freePlugs,
        maxPowerKw: maxPower,
        connectorTypes,
        network: station.network ?? 'GoingElectric Directory',
        stationId: station.id,
      });
    }
  }

  // 3. Add static Munich chargers
  for (const staticCharger of STATIC_MUNICH_CHARGERS) {
    if (staticCharger.freePlugs <= 0) continue;
    // Don't add duplicate if very close to an existing station
    const dist = calculateDistanceMeters(
      event.latitude,
      event.longitude,
      staticCharger.latitude,
      staticCharger.longitude
    );
    candidates.push({
      ...staticCharger,
      distanceMeters: dist,
    });
  }

  // Sort strictly ascending by distance
  candidates.sort((a, b) => a.distanceMeters - b.distanceMeters);

  // Return the top 5 closest
  return candidates.slice(0, 5);
}
