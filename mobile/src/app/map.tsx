import * as Location from 'expo-location';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { Link, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, useWindowDimensions, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ui } from '@/components/bayready-ui';
import { useBookings } from '@/components/bookings-provider';
import { useProfile } from '@/components/profile-provider';
import { DirectoryBookingsList } from '@/components/directory-bookings-list';
import { DirectoryBookingModal, type DirectoryBookingChoice } from '@/components/directory-booking-form';
import { palette } from '@/constants/bayready';
import { useDirectoryBookings } from '@/hooks/use-directory-bookings';
import type { BayAvailability } from '@/lib/bookings-api';
import { fetchDirectory, type DirectoryRegion, type DirectoryResult, type DirectoryStation } from '@/lib/goingelectric-api';
import { groupRegisteredLocations, matchingConnectors, type RegisteredLocation } from '@/lib/map-inventory';
import { formatHardwareInstant } from '@/lib/hardware-time';
import { buildDirectorySlotGroups, directoryGroupStatus, directorySlotKey, directorySlotOrdinal, directorySlotPage, type DirectorySlotGroup, type DirectorySlotHold } from '@/lib/directory-slots';
import {
  AUDIMAX_COORDINATES,
  PREFERRED_LOCK_ID,
  fetchAudimaxLocks,
  reserveAudimaxLock,
  releaseAudimaxLock,
  getStoredActiveHold,
  setStoredActiveHold,
  type AudimaxLock,
  type AudimaxActiveHold,
} from '@/lib/audimax-lock-api';
import { AudimaxBookingModal } from '@/components/audimax-booking-modal';
import { MunichEventsModal } from '@/components/munich-events-modal';
import {
  MUNICH_MOCK_EVENTS,
  type MunichEvent,
  type EventChargingSpot,
} from '@/lib/munich-events';

// Expo replaces this public directory key at bundle time. Hardware keys stay on the backend.
const DIRECTORY_KEY = process.env.EXPO_PUBLIC_GOINGELECTRIC_API_KEY?.trim() ?? '';
const SOURCE_URL = 'https://www.goingelectric.de/stromtankstellen/';
const CACHE_LIFETIME_MS = 60 * 60 * 1_000;
const INITIAL_REGION: DirectoryRegion = { latitude: 48.1488, longitude: 11.568, latitudeDelta: 0.05, longitudeDelta: 0.05 };
type PlugFilter = 'CCS' | 'Typ2' | 'CHAdeMO' | undefined;

function regionMoved(next: DirectoryRegion, previous: DirectoryRegion) {
  return Math.abs(next.latitude - previous.latitude) > previous.latitudeDelta * 0.04 ||
    Math.abs(next.longitude - previous.longitude) > previous.longitudeDelta * 0.04 ||
    Math.abs(next.latitudeDelta - previous.latitudeDelta) > previous.latitudeDelta * 0.12 ||
    Math.abs(next.longitudeDelta - previous.longitudeDelta) > previous.longitudeDelta * 0.12;
}

function displayPower(value: number | null) {
  return value === null ? 'Power not listed' : `${Number.isInteger(value) ? value : value.toFixed(1)} kW`;
}

function hasCoordinates(bay: BayAvailability): bay is BayAvailability & { latitude: number; longitude: number } {
  return typeof bay.latitude === 'number' && Number.isFinite(bay.latitude) && typeof bay.longitude === 'number' && Number.isFinite(bay.longitude);
}

function remainingTime(deadline: string | null, now: number) {
  if (!deadline) return 'Deadline unavailable';
  const seconds = Math.max(0, Math.ceil((Date.parse(deadline) - now) / 1_000));
  return seconds > 0 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} remaining` : 'Deadline reached · refresh status';
}

function untilTime(deadline: string | null) {
  return deadline ? `Until ${new Date(deadline).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Deadline unavailable';
}

function connectorLabel(value?: string) {
  return value === 'Typ2' ? 'Type 2' : value ?? 'All connectors';
}

function maskedVehicle(value: string) {
  return `•••• ${value.replace(/[^\p{L}\p{N}]/gu, '').slice(-2)}`;
}

async function prepareDirectorySlots(stations: DirectoryStation[], signal: AbortSignal): Promise<Record<number, DirectorySlotGroup[]>> {
  const catalog: Record<number, DirectorySlotGroup[]> = {};
  let cursor = 0;
  // Bound calls into the native crypto module; hashing is once per group.
  await Promise.all(Array.from({ length: Math.min(8, stations.length) }, async () => {
    while (cursor < stations.length && !signal.aborted) {
      const station = stations[cursor++];
      catalog[station.id] = await buildDirectorySlotGroups(station, async canonical => String(await digestStringAsync(CryptoDigestAlgorithm.SHA256, canonical)));
    }
  }));
  return catalog;
}

export default function MapScreen() {
  const bookings = useBookings();
  const { profile, loading: profileLoading } = useProfile();
  const router = useRouter();
  const plug: PlugFilter = profile?.connectorType;
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const map = useRef<MapView>(null);
  const region = useRef<DirectoryRegion>(INITIAL_REGION);
  const searchedRegion = useRef<DirectoryRegion | null>(null);
  const request = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const mounted = useRef(false);
  const expiresAt = useRef<number | null>(null);
  const [result, setResult] = useState<DirectoryResult | null>(null);
  const [slotCatalog, setSlotCatalog] = useState<Record<number, DirectorySlotGroup[]>>({});
  const [slotCatalogError, setSlotCatalogError] = useState<string | null>(null);
  const [preparingSlots, setPreparingSlots] = useState(false);
  const [selected, setSelected] = useState<DirectoryStation | null>(null);
  const [selectedListedPlug, setSelectedListedPlug] = useState<{ stationId: number; prefix: string; ordinal: number } | null>(null);
  const automaticPlugSelection = useRef(false);
  const selectedListedPlugRef = useRef(selectedListedPlug);
  selectedListedPlugRef.current = selectedListedPlug;
  const [directoryConfirming, setDirectoryConfirming] = useState(false);
  const [directoryNotice, setDirectoryNotice] = useState<string | null>(null);
  const [listedPlugPage, setListedPlugPage] = useState(0);
  const [selectedBayId, setSelectedBayId] = useState<string | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [selectedConnectorId, setSelectedConnectorId] = useState<string | null>(null);
  const selectedConnectorIdRef = useRef(selectedConnectorId);
  selectedConnectorIdRef.current = selectedConnectorId;
  const selectedBayIdRef = useRef(selectedBayId);
  selectedBayIdRef.current = selectedBayId;
  const [confirming, setConfirming] = useState(false);
  const [holdMinutes, setHoldMinutes] = useState<5 | 10 | 15>(10);
  const [bookingNotice, setBookingNotice] = useState<string | null>(null);
  const [clockNow, setClockNow] = useState(Date.now);
  const clockAnchor = useRef({ serverAt: Date.now(), clientAt: Date.now() });
  const [selectedAudimax, setSelectedAudimax] = useState(false);
  const [audimaxLocks, setAudimaxLocks] = useState<AudimaxLock[]>([]);
  const [audimaxTeam, setAudimaxTeam] = useState<string>('Alpha Explorers');
  const [audimaxLoading, setAudimaxLoading] = useState(false);
  const [audimaxError, setAudimaxError] = useState<string | null>(null);
  const [selectedLockId, setSelectedLockId] = useState<string>(PREFERRED_LOCK_ID);
  const [activeHold, setActiveHold] = useState<AudimaxActiveHold | null>(null);
  const [activeHoldSecondsLeft, setActiveHoldSecondsLeft] = useState(0);
  const [audimaxActionBusy, setAudimaxActionBusy] = useState(false);
  const [audimaxActionNotice, setAudimaxActionNotice] = useState<string | null>(null);
  const [audimaxModalOpen, setAudimaxModalOpen] = useState(false);
  const [eventsModalOpen, setEventsModalOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<MunichEvent>(MUNICH_MOCK_EVENTS[0]);
  const [activeEventFilter, setActiveEventFilter] = useState<MunichEvent | null>(null);

  const audimaxPollBusyRef = useRef(false);
  const audimaxLastPollRef = useRef(0);
  const handleAudimaxLeaveRef = useRef<((reason?: string) => Promise<void>) | null>(null);

  const loadAudimaxData = useCallback(async (): Promise<AudimaxLock[]> => {
    setAudimaxLoading(true);
    setAudimaxError(null);
    try {
      const stored = await getStoredActiveHold();
      setActiveHold(stored);
      const res = await fetchAudimaxLocks();
      setAudimaxLocks(res.locks);
      if (res.team) setAudimaxTeam(res.team);
      if (res.locks.length > 0) {
        const hasPreferred = res.locks.some(l => l.id === PREFERRED_LOCK_ID);
        setSelectedLockId(current => {
          if (current && res.locks.some(l => l.id === current)) return current;
          return hasPreferred ? PREFERRED_LOCK_ID : res.locks[0].id;
        });
      }
      return res.locks;
    } catch (err) {
      setAudimaxError(err instanceof Error ? err.message : 'Could not fetch Audimax hardware status');
      return [];
    } finally {
      setAudimaxLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAudimaxData();
  }, [loadAudimaxData]);

  useEffect(() => {
    if (!activeHold) {
      setActiveHoldSecondsLeft(0);
      return;
    }
    const updateTimer = async () => {
      const nowMs = Date.now();
      if (activeHold.status === 'scheduled') {
        const raiseAtMs = Date.parse(activeHold.raiseAt);
        if (nowMs >= raiseAtMs && !audimaxActionBusy) {
          try {
            await reserveAudimaxLock(activeHold.lockId, [activeHold.plate]);
            const updated: AudimaxActiveHold = {
              ...activeHold,
              status: 'active',
            };
            await setStoredActiveHold(updated);
            setActiveHold(updated);
            setActiveHoldSecondsLeft(Math.max(0, Math.ceil((Date.parse(updated.expiresAt) - nowMs) / 1000)));
            setAudimaxActionNotice('Arrival window reached! Barrier raised & plate whitelisted.');
            await loadAudimaxData();
          } catch (err) {
            console.warn('Failed to raise barrier at scheduled time:', err);
          }
        }
      } else if (activeHold.status === 'active') {
        const left = Math.max(0, Math.ceil((Date.parse(activeHold.expiresAt) - nowMs) / 1000));
        setActiveHoldSecondsLeft(left);

        // Periodically poll hardware telemetry to detect if car has arrived
        let currentLock = audimaxLocks.find(l => l.id === activeHold.lockId);
        if (!audimaxPollBusyRef.current && (nowMs - audimaxLastPollRef.current > 3000 || left === 0)) {
          audimaxPollBusyRef.current = true;
          audimaxLastPollRef.current = nowMs;
          try {
            const freshLocks = await loadAudimaxData();
            const found = freshLocks.find(l => l.id === activeHold.lockId);
            if (found) currentLock = found;
          } catch (err) {
            console.warn('Failed to poll lock status:', err);
          } finally {
            audimaxPollBusyRef.current = false;
          }
        }

        // If car showed up in the bay, transition to occupied - do NOT unlock!
        if (currentLock?.carPresence === 'occupied') {
          const occupiedHold: AudimaxActiveHold = {
            ...activeHold,
            status: 'occupied',
          };
          await setStoredActiveHold(occupiedHold);
          setActiveHold(occupiedHold);
          setAudimaxActionNotice(`Vehicle arrived in bay! ${currentLock.name || currentLock.id} is occupied.`);
          return;
        }

        // If 30-second arrival window expired and car has NOT shown up, auto-unlock
        if (left === 0 && !audimaxActionBusy) {
          void handleAudimaxLeaveRef.current?.('No-show timeout (30s): Car did not arrive. Barrier unlocked & whitelist cleared.');
        }
      } else if (activeHold.status === 'occupied') {
        // While occupied, occasionally refresh telemetry
        if (!audimaxPollBusyRef.current && nowMs - audimaxLastPollRef.current > 10000) {
          audimaxPollBusyRef.current = true;
          audimaxLastPollRef.current = nowMs;
          try {
            await loadAudimaxData();
          } finally {
            audimaxPollBusyRef.current = false;
          }
        }
      }
    };
    void updateTimer();
    const interval = setInterval(() => { void updateTimer(); }, 1000);
    return () => clearInterval(interval);
  }, [activeHold, audimaxActionBusy, audimaxLocks, loadAudimaxData]);

  const [minPower, setMinPower] = useState<number | undefined>();
  const minPowerRef = useRef(minPower);
  minPowerRef.current = minPower;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [myBookingsOpen, setMyBookingsOpen] = useState(false);
  const [includeFaults, setIncludeFaults] = useState(false);
  const [showReserved, setShowReserved] = useState(false);
  const [showDirectoryOnly, setShowDirectoryOnly] = useState(true);
  const [showTestLocation, setShowTestLocation] = useState(false);
  const [sourceHeight, setSourceHeight] = useState(56);
  const [detailHeight, setDetailHeight] = useState(220);
  const [loading, setLoading] = useState(false);
  const [areaChanged, setAreaChanged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [locationMessage, setLocationMessage] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [outsideBerlin, setOutsideBerlin] = useState(false);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const directoryStationIds = useMemo(() => result?.stations.map(station => station.id) ?? [], [result]);
  const directoryBookings = useDirectoryBookings(directoryStationIds);
  const [directoryClockNow, setDirectoryClockNow] = useState(Date.now);
  const directoryClockAnchor = useRef({ serverAt: Date.now(), clientAt: Date.now() });

  useEffect(() => {
    if (!directoryBookings.snapshot) return;
    directoryClockAnchor.current = { serverAt: Date.parse(directoryBookings.snapshot.serverNow), clientAt: Date.now() };
    setDirectoryClockNow(directoryClockAnchor.current.serverAt);
  }, [directoryBookings.snapshot]);

  useEffect(() => {
    if (!bookings.snapshot) return;
    clockAnchor.current = { serverAt: Date.parse(bookings.snapshot.serverNow), clientAt: Date.now() };
    setClockNow(clockAnchor.current.serverAt);
  }, [bookings.snapshot]);

  useEffect(() => {
    const timer = setInterval(() => {
      setClockNow(clockAnchor.current.serverAt + Date.now() - clockAnchor.current.clientAt);
      setDirectoryClockNow(directoryClockAnchor.current.serverAt + Date.now() - directoryClockAnchor.current.clientAt);
    }, 1_000);
    return () => clearInterval(timer);
  }, []);

  const search = useCallback(async (target: DirectoryRegion, power?: number, connector?: PlugFilter) => {
    if (!DIRECTORY_KEY) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const currentSequence = ++sequence.current;
    setLoading(true);
    setError(null);
    setExpired(false);
    setSelected(null);
    setSelectedListedPlug(null);
    setDirectoryConfirming(false);
    setDirectoryNotice(null);
    setResult(null);
    setSlotCatalog({});
    setSlotCatalogError(null);
    setPreparingSlots(false);
    expiresAt.current = null;
    try {
      const next = await fetchDirectory({ apiKey: DIRECTORY_KEY, region: target, minPower: power, plug: connector, signal: controller.signal });
      if (!mounted.current || controller.signal.aborted || currentSequence !== sequence.current) return;
      setResult(next);
      expiresAt.current = Date.now() + CACHE_LIFETIME_MS;
      searchedRegion.current = target;
      setAreaChanged(regionMoved(region.current, target));
      setPreparingSlots(true);
      try {
        const catalog = await prepareDirectorySlots(next.stations, controller.signal);
        if (!mounted.current || controller.signal.aborted || currentSequence !== sequence.current) return;
        setSlotCatalog(catalog);
      } catch {
        if (mounted.current && !controller.signal.aborted && currentSequence === sequence.current) setSlotCatalogError('Listed plugs could not be prepared. Search this area again before reserving.');
      } finally {
        if (mounted.current && currentSequence === sequence.current) setPreparingSlots(false);
      }
    } catch (failure) {
      if (!mounted.current || controller.signal.aborted || currentSequence !== sequence.current) return;
      setError(failure instanceof Error ? failure.message : 'The charger directory is unavailable. Try searching this area again.');
    } finally {
      if (request.current === controller) request.current = null;
      if (mounted.current && currentSequence === sequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const expire = () => {
      if (expiresAt.current !== null && Date.now() >= expiresAt.current) {
        expiresAt.current = null;
        setResult(null);
        setSlotCatalog({});
        setSelected(null);
        setSelectedListedPlug(null);
        setDirectoryConfirming(false);
        setExpired(true);
      }
    };
    const timer = setInterval(expire, 30_000);
    const appState = AppState.addEventListener('change', state => { if (state === 'active') expire(); });
    return () => {
      mounted.current = false;
      request.current?.abort();
      request.current = null;
      clearInterval(timer);
      appState.remove();
    };
  }, [search]);

  useEffect(() => {
    if (profileLoading) return;
    setSelectedBayId(null);
    setSelectedConnectorId(null);
    setConfirming(false);
    void search(region.current, minPowerRef.current, plug);
  }, [plug, profileLoading, search]);

  const openSource = useCallback(async (url = SOURCE_URL) => {
    setLinkError(null);
    try { await Linking.openURL(url); }
    catch { setLinkError('The browser could not open GoingElectric. Try again.'); }
  }, []);

  const locate = useCallback(async () => {
    if (locating) return;
    setLocating(true);
    setLocationMessage(null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!mounted.current) return;
      if (!permission.granted) {
        setLocationMessage('Location access was declined. You can move the map and search any area.');
        return;
      }
      const position = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Location timed out')), 15_000); }),
      ]);
      if (!mounted.current) return;
      const next = { latitude: position.coords.latitude, longitude: position.coords.longitude, latitudeDelta: 0.065, longitudeDelta: 0.065 };
      setUserLocation({ latitude: next.latitude, longitude: next.longitude });
      region.current = next;
      setOutsideBerlin(Math.abs(next.latitude - INITIAL_REGION.latitude) > 0.04 || Math.abs(next.longitude - INITIAL_REGION.longitude) > 0.04);
      setAreaChanged(true);
      setLocationMessage('Map centered on your location. Tap “Search this area” to find chargers.');
      map.current?.animateToRegion(next, 550);
    } catch {
      if (mounted.current) setLocationMessage('Your location could not be found. Move the map manually and search an area.');
    } finally {
      if (timer) clearTimeout(timer);
      if (mounted.current) setLocating(false);
    }
  }, [locating]);

  const changePower = (value?: number) => {
    if (value === minPower) return;
    setMinPower(value);
    void search(region.current, value, plug);
  };

  const knownBays = bookings.snapshot?.bays ?? [];
  const displayedInventory = knownBays.filter(bay => bay.mode !== 'demo' || showTestLocation);
  const inventoryFilters = { connectorType: plug, minPower };
  const faultIds = new Set(result?.stations.filter(station => station.faultReported).map(station => station.id) ?? []);
  const visibleLocations = bookings.fresh ? groupRegisteredLocations(displayedInventory, { ...inventoryFilters, showReserved, includeFaults, reportedFaultIds: faultIds }) : [];
  const locationDetails = groupRegisteredLocations(displayedInventory, { ...inventoryFilters, showReserved: true, includeFaults: true });
  const selectedLocation = visibleLocations.find(location => location.id === selectedLocationId) ?? locationDetails.find(location => location.id === selectedLocationId) ?? null;
  const selectedBay = knownBays.find(bay => bay.id === selectedBayId) ?? null;
  const selectedBayDirectory = selectedBay?.goingelectricId ? result?.stations.find(station => station.id === selectedBay.goingelectricId) ?? null : null;
  const selectedBayHasFault = selectedBayDirectory?.faultReported === true;
  const selectedBayDirectoryUnknown = selectedBay?.goingelectricId !== null && selectedBay?.goingelectricId !== undefined && !selectedBayDirectory;
  const bayConnectors = selectedBay ? matchingConnectors(selectedBay, inventoryFilters, { includeDisabled: true }) : [];
  const selectedConnector = bayConnectors.find(connector => connector.id === selectedConnectorId) ?? null;
  const heldConnector = selectedBay?.myConnectorId ? selectedBay.connectors.find(connector => connector.id === selectedBay.myConnectorId) ?? null : null;
  const confirmationAllowed = !!profile && !!selectedBay && !!selectedConnector?.enabled && bookings.fresh && selectedBay.mode === 'demo' && selectedBay.availability === 'unreserved' && !selectedBayHasFault && !selectedBayDirectoryUnknown;
  const showConfirmation = confirming && confirmationAllowed;

  useEffect(() => {
    if (confirming && !confirmationAllowed) setConfirming(false);
  }, [confirming, confirmationAllowed]);
  const mappedDirectoryIds = new Set(displayedInventory.map(bay => bay.goingelectricId).filter(id => id !== null));
  const holdsByStation = useMemo(() => {
    const grouped = new Map<number, NonNullable<typeof directoryBookings.snapshot>['holds']>();
    for (const hold of directoryBookings.snapshot?.holds ?? []) grouped.set(hold.stationId, [...(grouped.get(hold.stationId) ?? []), hold]);
    return grouped;
  }, [directoryBookings.snapshot]);
  const directoryCounts = useMemo(() => {
    const counts: Record<number, { total: number; unreserved: number | null; reserved: number | null }> = {};
    const scope = new Set(directoryBookings.queriedStationIds);
    for (const station of result?.stations ?? []) {
      const groups = slotCatalog[station.id]?.filter(group => (plug === undefined || group.type === plug) && (minPower === undefined || group.power >= minPower));
      const total = groups?.reduce((sum, group) => sum + group.count, 0) ?? station.connectors.filter(group => (plug === undefined || group.type === plug) && (minPower === undefined || group.power >= minPower)).reduce((sum, group) => sum + group.count, 0);
      const fresh = groups !== undefined && directoryBookings.fresh && scope.has(station.id);
      if (!fresh) counts[station.id] = { total, unreserved: null, reserved: null };
      else {
        const reserved = groups.reduce((sum, group) => sum + (directoryGroupStatus(group, holdsByStation.get(station.id) ?? [], true).reserved ?? 0), 0);
        counts[station.id] = { total, reserved, unreserved: total - reserved };
      }
    }
    return counts;
  }, [directoryBookings.fresh, directoryBookings.queriedStationIds, holdsByStation, minPower, plug, result, slotCatalog]);
  const visibleStations = showDirectoryOnly ? result?.stations.filter(station =>
    (includeFaults || !station.faultReported) && (!bookings.fresh || !mappedDirectoryIds.has(station.id)) &&
    (showReserved || directoryCounts[station.id]?.unreserved === null || (directoryCounts[station.id]?.unreserved ?? 0) > 0),
  ) ?? [] : [];
  const reservedBays = bookings.fresh ? displayedInventory.filter(bay => bay.availability === 'reserved') : [];
  const directoryHolds = directoryBookings.snapshot?.holds ?? [];
  const ownDirectoryBookings = directoryBookings.snapshot?.myBookings ?? [];
  const reportedGroups = selected ? slotCatalog[selected.id]?.filter(group => (plug === undefined || group.type === plug) && (minPower === undefined || group.power >= minPower)) ?? [] : [];
  const reportedPlugCount = selected ? directoryCounts[selected.id]?.total ?? 0 : 0;
  const reportedMaxPower = reportedGroups.length ? Math.max(...reportedGroups.map(group => group.power)) : null;
  const selectedGroupPrefix = selectedListedPlug && selected && selectedListedPlug.stationId === selected.id ? selectedListedPlug.prefix : undefined;
  const selectedReportedGroup = reportedGroups.find(group => group.prefix === selectedGroupPrefix) ?? null;
  const selectedSlotKey = selectedReportedGroup && selectedListedPlug && selectedListedPlug.ordinal <= selectedReportedGroup.count ? directorySlotKey(selectedReportedGroup, selectedListedPlug.ordinal) : null;
  const selectedDirectoryHold = selected && selectedSlotKey ? holdsByStation.get(selected.id)?.find(hold => hold.slotKey === selectedSlotKey) ?? null : null;
  const selectedOwnDirectoryBooking = selectedDirectoryHold?.myReservationId ? ownDirectoryBookings.find(booking => booking.id === selectedDirectoryHold.myReservationId) ?? null : null;
  const selectedDirectoryFresh = !!selected && directoryCounts[selected.id]?.unreserved !== null && directoryCounts[selected.id]?.unreserved !== undefined;
  const directoryConfirmationAllowed = !!profile && !!selected && !!selectedSlotKey && selectedDirectoryFresh && !selected.faultReported;
  const showDirectoryConfirmation = directoryConfirming && !!selected && !!selectedSlotKey;
  const selectedGroupStatus = selectedReportedGroup ? directoryGroupStatus(selectedReportedGroup, selected ? holdsByStation.get(selected.id) ?? [] : [], selectedDirectoryFresh) : null;
  const listedPageTotal = selectedReportedGroup ? selectedDirectoryFresh && !showReserved ? selectedGroupStatus?.unreserved ?? 0 : selectedReportedGroup.count : 0;
  const effectiveListedPage = Math.min(listedPlugPage, Math.max(0, Math.ceil(listedPageTotal / 12) - 1));
  const listedPage = selectedReportedGroup ? directorySlotPage(selectedReportedGroup, selected ? holdsByStation.get(selected.id) ?? [] : [], { fresh: selectedDirectoryFresh, showReserved, page: effectiveListedPage }) : { ordinals: [], total: 0 };

  useEffect(() => {
    if (!selected || reportedGroups.length === 0) return;
    const alreadySelected = selectedListedPlug?.stationId === selected.id;
    if (alreadySelected && (!automaticPlugSelection.current || !selectedDirectoryFresh || !selectedDirectoryHold || selectedDirectoryHold.isMine)) return;
    const holds = holdsByStation.get(selected.id) ?? [];
    const group = reportedGroups.find(item => directoryGroupStatus(item, holds, selectedDirectoryFresh).unreserved !== 0) ?? reportedGroups[0];
    const page = directorySlotPage(group, holds, { fresh: selectedDirectoryFresh, showReserved: false, page: 0 });
    const ordinal = page.ordinals[0] ?? 1;
    if (alreadySelected && selectedListedPlug.prefix === group.prefix && selectedListedPlug.ordinal === ordinal) return;
    setSelectedListedPlug({ stationId: selected.id, prefix: group.prefix, ordinal });
    setDirectoryConfirming(true);
  }, [holdsByStation, reportedGroups, selected, selectedDirectoryFresh, selectedDirectoryHold, selectedListedPlug]);
  const visibleBayCount = visibleLocations.reduce((count, location) => count + location.unreservedBayCount, 0);
  const activeFilterCount = Number(minPower !== undefined) + Number(includeFaults) + Number(showReserved) + Number(!showDirectoryOnly) + Number(showTestLocation);
  const navigationBottom = insets.bottom + sourceHeight + 26;
  const detailsBottom = navigationBottom + 67;
  const baselineBottomPadding = navigationBottom + 67;
  // Leave a clear band below the search control for the map provider's logo.
  const detailMaxHeight = Math.max(120, Math.min(350, screenHeight * 0.42, screenHeight - detailsBottom - insets.top - 192));
  const detailVisible = !filtersOpen && !!(selected || selectedBay || selectedLocation);
  const mapBottomPadding = detailVisible ? detailsBottom + detailHeight + 16 : baselineBottomPadding;
  const filterPanelMaxHeight = Math.max(160, screenHeight - (insets.top + 72) - baselineBottomPadding - 64);

  const selectBay = (bay: BayAvailability) => {
    setSelected(null);
    setSelectedLocationId(bay.locationId);
    setSelectedBayId(bay.id);
    setSelectedConnectorId(null);
    setConfirming(false);
    setBookingNotice(null);
    setFiltersOpen(false);
  };

  const selectLocation = (location: RegisteredLocation<BayAvailability>) => {
    setSelectedAudimax(false);
    setSelected(null);
    setSelectedLocationId(location.id);
    setSelectedBayId(null);
    setSelectedConnectorId(null);
    setConfirming(false);
    setBookingNotice(null);
    setFiltersOpen(false);
  };

  const reserveBay = async () => {
    if (!profile) { router.push('/profile'); return; }
    if (!selectedBay || !selectedConnector || !confirmationAllowed) return;
    const bayId = selectedBay.id;
    setBookingNotice(null);
    const connectorId = selectedConnector.id;
    const reservation = await bookings.reserve(bayId, holdMinutes, connectorId);
    if (!mounted.current || selectedBayIdRef.current !== bayId || selectedConnectorIdRef.current !== connectorId) return;
    if (reservation?.status === 'held' && reservation.bayId === bayId && reservation.connectorId === connectorId) {
      setConfirming(false);
      setBookingNotice('Demo hold saved. This is an app booking; physical vacancy is unverified.');
    } else {
      setBookingNotice(null);
    }
  };

  const cancelHold = async (reservationId: string) => {
    if (!bookings.fresh) return;
    setBookingNotice(null);
    const cancelled = await bookings.cancel(reservationId);
    if (cancelled && mounted.current) setBookingNotice('Your demo hold was cancelled.');
  };

  const selectListedGroup = (group: DirectorySlotGroup) => {
    automaticPlugSelection.current = false;
    const page = directorySlotPage(group, holdsByStation.get(group.stationId) ?? [], { fresh: selectedDirectoryFresh, showReserved, page: 0 });
    setSelectedListedPlug({ stationId: group.stationId, prefix: group.prefix, ordinal: page.ordinals[0] ?? 1 });
    setListedPlugPage(0);
    setDirectoryConfirming(true);
    setDirectoryNotice(null);
  };

  const reserveListedPlug = async (choice: DirectoryBookingChoice): Promise<boolean> => {
    if (!profile) { router.push('/profile'); return false; }
    if (!selected || !selectedSlotKey || !directoryConfirmationAllowed || choice.bookingMode === 'now' && selectedDirectoryHold) return false;
    const stationId = selected.id;
    const slotKey = selectedSlotKey;
    const selection = selectedListedPlugRef.current;
    automaticPlugSelection.current = false;
    setDirectoryNotice(null);
    const saved = await directoryBookings.reserveBooking(stationId, slotKey, choice);
    if (!mounted.current || selectedListedPlugRef.current?.stationId !== selection?.stationId || selectedListedPlugRef.current?.prefix !== selection?.prefix || selectedListedPlugRef.current?.ordinal !== selection?.ordinal) return false;
    if (saved?.status === 'held' && saved.stationId === stationId && saved.slotKey === slotKey) { setDirectoryConfirming(false); setMyBookingsOpen(true); setDirectoryNotice(choice.bookingMode === 'scheduled' ? 'Scheduled for ' + formatHardwareInstant(saved.startsAt) : 'Reserved until ' + untilTime(saved.expiresAt).replace('Until ', '')); return true; }
    return false;
  };

  const extendListedHold = async (id: string) => {
    if (!directoryBookings.fresh) return;
    setDirectoryNotice(null);
    const saved = await directoryBookings.extend(id);
    if (saved?.status === 'held' && mounted.current) setDirectoryNotice('Extended until ' + formatHardwareInstant(saved.expiresAt));
  };

  const cancelListedHold = async (id: string) => {
    if (!directoryBookings.fresh) return;
    setDirectoryNotice(null);
    const saved = await directoryBookings.cancel(id);
    if (saved && mounted.current) setDirectoryNotice('Your app-only plug hold was cancelled.');
  };

  const listedHoldLabel = (hold: Pick<DirectorySlotHold, 'stationId' | 'slotKey'>) => {
    const station = result?.stations.find(item => item.id === hold.stationId);
    const group = slotCatalog[hold.stationId]?.find(item => directorySlotOrdinal(item, hold.slotKey) !== null);
    return { station: station?.name ?? `Station #${hold.stationId}`, plug: group ? `${connectorLabel(group.type)} · app plug ${directorySlotOrdinal(group, hold.slotKey)}` : 'App plug · outside current inventory' };
  };

  const selectDirectoryStation = (station: DirectoryStation) => {
    automaticPlugSelection.current = true;
    setSelectedAudimax(false);
    setSelected(station); setSelectedListedPlug(null); setListedPlugPage(0); setDirectoryConfirming(false); setDirectoryNotice(null);
    setSelectedLocationId(null); setSelectedBayId(null); setSelectedConnectorId(null); setConfirming(false); setFiltersOpen(false);
  };

  const selectAudimax = () => {
    setSelectedAudimax(true);
    setSelected(null);
    setSelectedListedPlug(null);
    setSelectedBayId(null);
    setSelectedLocationId(null);
    setSelectedConnectorId(null);
    setFiltersOpen(false);
    setConfirming(false);
    setDirectoryConfirming(false);
    void loadAudimaxData();
  };

  const handleAudimaxReserve = async (choice?: { bookingMode: 'now' | 'scheduled'; startsAt?: string; plate: string }) => {
    const lock = audimaxLocks.find(l => l.id === selectedLockId) ?? audimaxLocks[0];
    if (!lock) return;
    setAudimaxActionBusy(true);
    setAudimaxActionNotice(null);
    try {
      const plate = choice?.plate || profile?.licensePlate?.trim() || 'MBD14E';
      const isScheduled = choice?.bookingMode === 'scheduled' && !!choice.startsAt;
      const startsAt = isScheduled ? choice!.startsAt : undefined;
      const nowMs = Date.now();
      const startsAtMs = startsAt ? Date.parse(startsAt) : nowMs;
      const raiseAtMs = isScheduled ? startsAtMs - 30 * 1000 : nowMs;
      const expiresAtMs = startsAtMs + 30 * 1000;

      // Only raise the barrier if we are within 30 seconds of the selected time (or reserving now)
      const shouldRaiseNow = raiseAtMs <= nowMs;

      if (shouldRaiseNow) {
        await reserveAudimaxLock(lock.id, [plate]);
      }

      const hold: AudimaxActiveHold = {
        lockId: lock.id,
        lockName: lock.name || lock.id,
        plate,
        reservedAt: new Date(nowMs).toISOString(),
        bookingMode: isScheduled ? 'scheduled' : 'now',
        startsAt,
        raiseAt: new Date(raiseAtMs).toISOString(),
        expiresAt: new Date(expiresAtMs).toISOString(),
        status: shouldRaiseNow ? 'active' : 'scheduled',
      };

      await setStoredActiveHold(hold);
      setActiveHold(hold);
      if (shouldRaiseNow) {
        setActiveHoldSecondsLeft(30);
        setAudimaxActionNotice(`Barrier raised & plate ${plate} whitelisted for ${lock.name || lock.id}! (30-second hold)`);
      } else {
        setAudimaxActionNotice(`Booked ahead for ${formatHardwareInstant(startsAt!)}. Barrier will automatically raise 30s before arrival at ${new Date(raiseAtMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}.`);
      }
      await loadAudimaxData();
      setAudimaxModalOpen(false);
    } catch (err) {
      setAudimaxActionNotice(err instanceof Error ? err.message : 'Reservation failed');
    } finally {
      setAudimaxActionBusy(false);
    }
  };

  const handleAudimaxLeave = async (reason?: string) => {
    const lockId = activeHold?.lockId || selectedLockId;
    const isScheduledOnly = activeHold?.status === 'scheduled';
    setAudimaxActionBusy(true);
    setAudimaxActionNotice(null);
    try {
      if (!isScheduledOnly) {
        await releaseAudimaxLock(lockId);
      }
      await setStoredActiveHold(null);
      setActiveHold(null);
      setAudimaxActionNotice(
        reason ?? (isScheduledOnly ? 'Scheduled booking cancelled.' : 'Barrier lowered & whitelist cleared.')
      );
      await loadAudimaxData();
      setAudimaxModalOpen(false);
    } catch (err) {
      setAudimaxActionNotice(err instanceof Error ? err.message : 'Release failed');
    } finally {
      setAudimaxActionBusy(false);
    }
  };
  handleAudimaxLeaveRef.current = handleAudimaxLeave;

  const handleAudimaxExtend = async () => {
    if (!activeHold || activeHold.status !== 'active') return;
    setAudimaxActionBusy(true);
    setAudimaxActionNotice(null);
    try {
      const currentExpiresMs = Date.parse(activeHold.expiresAt);
      const newExpiresMs = currentExpiresMs + 30 * 1000;
      const updated: AudimaxActiveHold = {
        ...activeHold,
        expiresAt: new Date(newExpiresMs).toISOString(),
      };
      await setStoredActiveHold(updated);
      setActiveHold(updated);
      setActiveHoldSecondsLeft(Math.max(0, Math.ceil((newExpiresMs - Date.now()) / 1000)));
      setAudimaxActionNotice(
        `Added 30 seconds to arrival window (€1 mock fee applied). Auto-unlock postponed until ${new Date(newExpiresMs).toLocaleTimeString()}.`
      );
    } catch (err) {
      setAudimaxActionNotice(err instanceof Error ? err.message : 'Extension failed');
    } finally {
      setAudimaxActionBusy(false);
    }
  };

  const handleSelectEventSpot = (spot: EventChargingSpot, event: MunichEvent) => {
    setActiveEventFilter(event);
    setEventsModalOpen(false);
    map.current?.animateToRegion(
      {
        latitude: spot.latitude,
        longitude: spot.longitude,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      },
      600
    );

    if (spot.isAudimaxHardware) {
      selectAudimax();
      setAudimaxModalOpen(true);
    } else if (spot.stationId && result?.stations) {
      const station = result.stations.find(s => s.id === spot.stationId);
      if (station) {
        selectDirectoryStation(station);
      }
    }
  };

  const startPublicReservation = () => {
    if (selected && selectedSlotKey) { setFiltersOpen(false); setDirectoryConfirming(true); return; }
    const station = selected ?? visibleStations.find(item => !item.faultReported && (directoryCounts[item.id]?.unreserved ?? 1) > 0) ?? visibleStations[0];
    if (station) { selectDirectoryStation(station); return; }
    setLocationMessage('Search this area, then tap a charger to reserve an app plug.');
    if (!loading && DIRECTORY_KEY) void search(region.current, minPower, plug);
  };

  return (
    <View style={styles.screen}>
      <MapView ref={map} style={styles.map} initialRegion={INITIAL_REGION} showsMyLocationButton={false} showsCompass={false} toolbarEnabled={false}
        mapPadding={{ top: insets.top + 72, right: insets.right + 8, bottom: mapBottomPadding, left: insets.left + 8 }}
        onRegionChangeComplete={next => { region.current = next; setOutsideBerlin(Math.abs(next.latitude - INITIAL_REGION.latitude) > 0.04 || Math.abs(next.longitude - INITIAL_REGION.longitude) > 0.04); setAreaChanged(!searchedRegion.current || regionMoved(next, searchedRegion.current)); }}>
        {visibleStations.map(station => <Marker key={station.id} identifier={String(station.id)} coordinate={{ latitude: station.latitude, longitude: station.longitude }} title={station.name} description={directoryCounts[station.id]?.unreserved === null ? `${directoryCounts[station.id]?.total ?? 0} listed plugs · app status unknown` : `${directoryCounts[station.id]?.unreserved ?? 0}/${directoryCounts[station.id]?.total ?? 0} unreserved in BayReady`} pinColor={selected?.id === station.id ? palette.ink : station.faultReported ? palette.errorInk : directoryCounts[station.id]?.unreserved === 0 ? '#A77A24' : directoryCounts[station.id]?.unreserved === null ? '#737D77' : '#739332'} onPress={() => selectDirectoryStation(station)} />)}
        {visibleLocations.map(location => <Marker key={`location-${location.id}`} identifier={`location-${location.id}`} coordinate={{ latitude: location.latitude, longitude: location.longitude }} title={`${location.bays.every(bay => bay.mode === 'demo') ? 'DEMO · ' : ''}${location.label}`} description={`${location.unreservedBayCount} unreserved bays · ${location.connectorCount} compatible connectors`} pinColor={location.unreservedBayCount === 0 ? '#A77A24' : palette.ink} onPress={() => selectLocation(location)} />)}
        <Marker
          key="audimax-tum"
          identifier="audimax-tum"
          coordinate={AUDIMAX_COORDINATES}
          title="Audimax TUM · Ecurious Hardware"
          description={
            activeHold
              ? activeHold.status === 'scheduled'
                ? `Scheduled: ${activeHold.lockName} · Raises at ${new Date(activeHold.raiseAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
                : activeHold.status === 'occupied'
                ? `Parked: ${activeHold.lockName} · Vehicle present`
                : `Waiting for car: ${activeHold.lockName} (${activeHoldSecondsLeft}s left)`
              : audimaxLocks.length > 0
              ? `${audimaxLocks.length} bays · ${audimaxLocks.map(l => `${l.name || l.id} (${l.status})`).join(', ')}`
              : 'Ecurious parking lock · Tap for live status'
          }
          pinColor={selectedAudimax ? palette.ink : activeHold ? '#356EAE' : '#9C27B0'}
          onPress={selectAudimax}
        />
        {activeEventFilter ? (
          <Marker
            key={`event-${activeEventFilter.id}`}
            identifier={`event-${activeEventFilter.id}`}
            coordinate={{ latitude: activeEventFilter.latitude, longitude: activeEventFilter.longitude }}
            title={`${activeEventFilter.emoji} ${activeEventFilter.title}`}
            description={`${activeEventFilter.venue} · ${activeEventFilter.expectedAttendance}`}
            pinColor="#D32F2F"
          />
        ) : null}
        {userLocation ? <Marker key="your-location" coordinate={userLocation} title="Your location" pinColor="#356EAE" /> : null}
      </MapView>

      <View style={[styles.topRow, { top: insets.top + 12, left: insets.left + 16, right: insets.right + 16 }]} pointerEvents="box-none">
        <Pressable accessibilityRole="button" accessibilityLabel="Open driver profile" onPress={() => router.push('/profile')} style={styles.brandPill}><View style={styles.brandMark}><Text style={styles.bolt}>ϟ</Text></View><View><Text style={styles.brand}>BayReady</Text><Text style={styles.brandCaption}>CHARGERS & BOOKINGS</Text></View></Pressable>
        <View style={styles.topButtons}>
          <Pressable accessibilityRole="button" accessibilityLabel="Munich Events" onPress={() => setEventsModalOpen(true)} style={({ pressed }) => [styles.filterButton, activeEventFilter && styles.filterButtonOpen, pressed && ui.pressed]}>
            <Text style={[styles.filterButtonText, activeEventFilter && styles.filterButtonTextOpen]}>{activeEventFilter ? `${activeEventFilter.emoji} Events` : '🎯 Events'}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Charger filters" accessibilityState={{ expanded: filtersOpen }} onPress={() => setFiltersOpen(open => !open)} style={({ pressed }) => [styles.filterButton, filtersOpen && styles.filterButtonOpen, pressed && ui.pressed]}>
            <Text style={[styles.filterButtonText, filtersOpen && styles.filterButtonTextOpen]}>☷ Filters{activeFilterCount ? ` · ${activeFilterCount}` : ''}</Text>
          </Pressable>
        </View>
      </View>

      {activeEventFilter ? (
        <View style={[styles.eventPillContainer, { top: insets.top + 68, left: insets.left + 16, right: insets.right + 16 }]}>
          <Pressable onPress={() => setEventsModalOpen(true)} style={styles.eventPill}>
            <Text style={{ fontSize: 18 }}>{activeEventFilter.emoji}</Text>
            <View style={ui.flex}>
              <Text style={styles.eventPillTitle} numberOfLines={1}>
                {activeEventFilter.title}
              </Text>
              <Text style={styles.eventPillSubtitle} numberOfLines={1}>
                {activeEventFilter.venue} · Top 5 free chargers
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear event"
              onPress={() => setActiveEventFilter(null)}
              style={styles.eventPillClose}>
              <Text style={styles.eventPillCloseText}>×</Text>
            </Pressable>
          </Pressable>
        </View>
      ) : null}

      <View style={[styles.searchPosition, { top: insets.top + 80 }]} pointerEvents="box-none">
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: loading || bookings.refreshing, busy: loading || bookings.refreshing }} disabled={loading || bookings.refreshing} onPress={() => { setFiltersOpen(false); void bookings.refresh(); void directoryBookings.refresh(); void search(region.current, minPower, plug); }} style={({ pressed }) => [styles.searchButton, pressed && ui.pressed]}>
          {loading || bookings.refreshing ? <ActivityIndicator size="small" color={palette.ink} /> : <Text style={styles.searchMark}>⌕</Text>}<Text style={styles.searchText}>{loading || bookings.refreshing ? 'Finding chargers…' : areaChanged || !result ? 'Search this area' : 'Refresh chargers'}</Text>
        </Pressable>
        {!outsideBerlin && !result && !loading ? <Text style={styles.placeLabel}>Berlin · move the map to explore</Text> : null}
      </View>

      {filtersOpen ? <View style={[styles.filterPanel, { top: insets.top + 72, right: insets.right + 16, maxHeight: filterPanelMaxHeight }]}>
        <ScrollView contentContainerStyle={styles.filterContent} showsVerticalScrollIndicator={false}>
          <View style={styles.filterHeading}><Text style={styles.panelTitle}>Charger filters</Text><Pressable accessibilityRole="button" accessibilityLabel="Close filters" onPress={() => setFiltersOpen(false)} style={styles.smallClose}><Text style={styles.closeMark}>×</Text></Pressable></View>
          <Text style={styles.filterLabel}>Minimum power</Text>
          <View style={styles.filters}><Filter label="Any" active={minPower === undefined} onPress={() => changePower()} /><Filter label="50+ kW" active={minPower === 50} onPress={() => changePower(50)} /><Filter label="150+ kW" active={minPower === 150} onPress={() => changePower(150)} /></View>
          <View style={styles.connectorPreference}><View style={ui.flex}><Text style={styles.filterLabel}>Your connector</Text><Text style={styles.preferenceValue}>{connectorLabel(plug)}</Text></View><Link href="/profile" asChild><Pressable accessibilityRole="button" style={styles.preferenceEdit}><Text style={styles.noticeActionText}>{profile ? 'Edit profile' : 'Set up profile'}</Text></Pressable></Link></View>
          <View style={styles.toggleRow}><View style={ui.flex}><Text style={styles.toggleTitle}>Include reported faults</Text><Text style={styles.toggleCopy}>GoingElectric fault reports</Text></View><Switch accessibilityLabel="Include stations with reported faults" value={includeFaults} onValueChange={value => { setIncludeFaults(value); if (!value && selected?.faultReported) setSelected(null); }} trackColor={{ false: palette.line, true: '#98AC68' }} thumbColor={includeFaults ? palette.lime : palette.paper} /></View>
          <View style={styles.toggleRow}><View style={ui.flex}><Text style={styles.toggleTitle}>Show reserved</Text><Text style={styles.toggleCopy}>{directoryBookings.fresh ? `${directoryHolds.length} app plug holds${reservedBays.length ? ` · ${reservedBays.length} bay holds` : ''}` : 'Refresh to check active app bookings'}</Text></View><Switch accessibilityLabel="Show reserved BayReady stations" value={showReserved} onValueChange={setShowReserved} trackColor={{ false: palette.line, true: '#98AC68' }} thumbColor={showReserved ? palette.lime : palette.paper} /></View>
          <View style={styles.toggleRow}><View style={ui.flex}><Text style={styles.toggleTitle}>Show public chargers</Text><Text style={styles.toggleCopy}>Listed plugs · live availability unknown</Text></View><Switch accessibilityLabel="Show public chargers with listed plug counts and unknown availability" value={showDirectoryOnly} onValueChange={value => { setShowDirectoryOnly(value); if (!value) setSelected(null); }} trackColor={{ false: palette.line, true: '#98AC68' }} thumbColor={showDirectoryOnly ? palette.lime : palette.paper} /></View>
          <View style={styles.toggleRow}><View style={ui.flex}><Text style={styles.toggleTitle}>Show test location</Text><Text style={styles.toggleCopy}>Fictional inventory · app booking rehearsal</Text></View><Switch accessibilityLabel="Show the fictional test location" value={showTestLocation} onValueChange={value => { setShowTestLocation(value); if (!value && (selectedBay?.mode === 'demo' || selectedLocation?.bays.every(bay => bay.mode === 'demo'))) { setSelectedBayId(null); setSelectedLocationId(null); setSelectedConnectorId(null); setConfirming(false); } }} trackColor={{ false: palette.line, true: '#98AC68' }} thumbColor={showTestLocation ? palette.lime : palette.paper} /></View>
          <Pressable accessibilityRole="button" onPress={() => setFiltersOpen(false)} style={({ pressed }) => [styles.applyButton, pressed && ui.pressed]}><Text style={styles.applyButtonText}>Show map</Text></Pressable>
        </ScrollView>
      </View> : null}

      {!filtersOpen && !selectedBay && !selectedLocation && !selected && !selectedAudimax ? <View style={[styles.noticePosition, { top: insets.top + 140, left: insets.left + 16, right: insets.right + 16 }]} pointerEvents="box-none">
        {!bookings.configured && !showDirectoryOnly ? <MapNotice title="Connect bookings to show reservable bays" copy="The booking database is not connected yet. You can explore directory chargers with unknown availability." action="Show directory chargers" onPress={() => setShowDirectoryOnly(true)} /> : null}
        {bookings.configured && (showTestLocation || displayedInventory.some(bay => bay.mode === 'ecurious')) && bookings.error ? <MapNotice title="Booking status needs attention" copy={bookings.error} action="Refresh bookings" onPress={() => void bookings.refresh()} secondaryAction={!showDirectoryOnly ? "Browse directory chargers" : undefined} onSecondaryPress={() => setShowDirectoryOnly(true)} /> : null}
        {bookings.configured && (showTestLocation || displayedInventory.some(bay => bay.mode === 'ecurious')) && !bookings.loading && !bookings.fresh && !bookings.error ? <MapNotice title="Refresh before reserving" copy="Booking status is not current. Unknown bays are hidden until the database responds." action="Refresh bookings" onPress={() => void bookings.refresh()} /> : null}
        {showDirectoryOnly && !DIRECTORY_KEY ? <MapNotice title="Directory key needed" copy="Add the GoingElectric app key to the local setup, then restart Expo. You can still explore the map." action="Open official directory ↗" onPress={() => void openSource()} /> : null}
        {showDirectoryOnly && error ? <MapNotice title="Chargers could not load" copy={error} action="Try this area again" onPress={() => void search(region.current, minPower, plug)} /> : null}
        {showDirectoryOnly && expired ? <MapNotice title="Time for a fresh search" copy="Previous results were cleared after one hour. Search this area for a fresh directory snapshot." /> : null}
        {bookings.fresh && visibleLocations.length === 0 && (!showDirectoryOnly || (result && visibleStations.length === 0)) ? <MapNotice title="No matching bays on the map" copy="Try another area or change your filters. Directory-only chargers can be explored with unknown availability." /> : null}
        {locationMessage ? <Pressable accessibilityRole="button" accessibilityLabel="Dismiss location message" onPress={() => setLocationMessage(null)} style={styles.locationNotice}><Text style={styles.locationCopy}>{locationMessage}</Text><Text style={styles.dismiss}>×</Text></Pressable> : null}
      </View> : null}

      {selectedLocation && !selectedBay && !filtersOpen ? <View onLayout={event => setDetailHeight(event.nativeEvent.layout.height)} style={[styles.details, { bottom: detailsBottom, left: insets.left + 16, right: insets.right + 16, maxHeight: detailMaxHeight }]}>
        <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailsContent} showsVerticalScrollIndicator>
          <View style={styles.detailHeading}><View style={ui.flex}><View style={styles.bayBadge}><Text style={styles.bayBadgeText}>{selectedLocation.bays.every(bay => bay.mode === 'demo') ? 'DEMO LOCATION' : 'REGISTERED LOCATION'}</Text></View><Text style={styles.stationName}>{selectedLocation.label}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Close location details" onPress={() => setSelectedLocationId(null)} style={styles.closeButton}><Text style={styles.closeMark}>×</Text></Pressable></View>
          <Text style={styles.locationInventory}>{bookings.fresh ? `${selectedLocation.unreservedBayCount} unreserved bays · ${selectedLocation.connectorCount} compatible connectors` : 'Booking status unknown · refresh required'}</Text>
          <Text style={styles.noAvailability}>One vehicle per bay. Connectors within a bay share that space.</Text>
          {selectedLocation.bays.filter(bay => showReserved || bay.availability === 'unreserved').map(bay => <Pressable key={bay.id} accessibilityRole="button" accessibilityLabel={`Choose ${bay.label}`} onPress={() => selectBay(bay)} style={({ pressed }) => [styles.bayChoice, pressed && ui.pressed]}>
            <View style={ui.flex}><Text style={styles.bayChoiceName}>{bay.label}</Text><Text style={styles.bayChoiceCopy}>{matchingConnectors(bay, inventoryFilters).map(connector => `${connectorLabel(connector.type)} ${displayPower(connector.powerKw)}`).join(' · ')}</Text></View><View style={styles.bayChoiceEnd}><Text style={styles.bayChoiceStatus}>{!bookings.fresh ? 'Unknown' : bay.availability === 'reserved' ? bay.isMine ? 'Your hold' : 'Reserved' : 'Unreserved'}</Text><Text style={styles.choiceArrow}>›</Text></View>
          </Pressable>)}
          {selectedLocation.bays.every(bay => bay.availability === 'reserved') && !showReserved ? <Text style={styles.stationAddress}>All compatible bays have an app reservation. Turn on “Show reserved” in Filters to see the deadlines.</Text> : null}
          {bookings.error ? <Text style={styles.fault}>{bookings.error}</Text> : null}
          {!bookings.fresh ? <Pressable accessibilityRole="button" onPress={() => void bookings.refresh()} style={styles.applyButton}><Text style={styles.applyButtonText}>Refresh bookings</Text></Pressable> : null}
          <Text style={styles.noAvailability}>App reservations · physical vacancy unverified.</Text>
        </ScrollView>
      </View> : null}

      {selectedBay && !filtersOpen ? <View onLayout={event => setDetailHeight(event.nativeEvent.layout.height)} style={[styles.details, { bottom: detailsBottom, left: insets.left + 16, right: insets.right + 16, maxHeight: detailMaxHeight }]}>
        <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailsContent} showsVerticalScrollIndicator>
          {!showConfirmation ? <Pressable accessibilityRole="button" onPress={() => { setSelectedBayId(null); setSelectedConnectorId(null); setConfirming(false); }} style={styles.hierarchyBack}><Text style={styles.hierarchyBackText}>‹ {selectedBay.locationLabel}</Text></Pressable> : null}
          <View style={styles.detailHeading}><View style={ui.flex}><View style={styles.bayBadge}><Text style={styles.bayBadgeText}>{selectedBay.mode === 'demo' ? 'DEMO · APP BOOKING' : 'ECURIOUS · INTEGRATION PENDING'}</Text></View><Text style={styles.stationName}>{showConfirmation ? 'Confirm your demo hold' : selectedBay.label}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Close bay details" onPress={() => { setSelectedLocationId(null); setSelectedBayId(null); setSelectedConnectorId(null); setConfirming(false); }} style={styles.closeButton}><Text style={styles.closeMark}>×</Text></Pressable></View>
          {showConfirmation ? <>
            <Text style={styles.stationAddress}>{selectedBay.label} · {selectedConnector?.label} · {connectorLabel(selectedConnector?.type)} {displayPower(selectedConnector?.powerKw ?? null)}</Text>
            {profile ? <View style={styles.confirmationSummary}><Text style={styles.confirmationText}>{profile.licensePlate ? 'Vehicle ' + maskedVehicle(profile.licensePlate) : 'Vehicle plate not added'} · {connectorLabel(profile.connectorType)}</Text><Text style={styles.confirmationText}>{profile.paymentMethod === 'mock-wallet' ? 'Mock wallet' : 'Mock card'} · no payment is taken</Text></View> : null}
            <View style={styles.filters}>{([5, 10, 15] as const).map(minutes => <Filter key={minutes} label={`${minutes} min`} active={holdMinutes === minutes} onPress={() => setHoldMinutes(minutes)} />)}</View>
          </> : <>
            <Text style={styles.stationAddress}>{selectedBay.mode === 'demo' && !selectedBay.goingelectricId ? 'Fictional demo location · no public charger is mapped here.' : 'Registered BayReady bay · physical vacancy is unverified.'}</Text>
            <Text style={styles.bookingStatus}>{!bookings.fresh ? 'Booking status unknown · refresh required' : selectedBay.availability === 'reserved' ? `${selectedBay.isMine ? 'Your reservation' : 'Reserved'} · ${remainingTime(selectedBay.reservedUntil, clockNow)}` : 'No active BayReady reservation'}</Text>
            {selectedBay.reservedUntil && bookings.fresh ? <Text style={styles.toggleCopy}>Until {new Date(selectedBay.reservedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · server deadline</Text> : null}
            {heldConnector ? <Text style={styles.stationAddress}>Booked connector: {heldConnector.label} · {connectorLabel(heldConnector.type)} {displayPower(heldConnector.powerKw)}</Text> : null}
            {selectedBayDirectory ? <Pressable accessibilityRole="link" onPress={() => void openSource(selectedBayDirectory.url)} style={styles.stationSource}><Text style={styles.stationSourceText}>GoingElectric ↗</Text></Pressable> : null}
            {selectedBay.availability === 'unreserved' ? <View style={styles.connectorChoices}>
              <Text style={styles.filterLabel}>Choose an individual connector</Text>
              {bayConnectors.length === 0 ? <Text style={styles.stationAddress}>No connector matches {connectorLabel(plug)}{minPower ? ` at ${minPower}+ kW` : ''}. Edit your profile or power filter to explore other bays.</Text> : bayConnectors.map(connector => <Pressable key={connector.id} accessibilityRole="button" accessibilityState={{ selected: selectedConnectorId === connector.id, disabled: !connector.enabled || !bookings.fresh }} disabled={!connector.enabled || !bookings.fresh} onPress={() => { setSelectedConnectorId(connector.id); setConfirming(false); }} style={({ pressed }) => [styles.connectorChoice, selectedConnectorId === connector.id && styles.connectorChoiceSelected, !connector.enabled && styles.disabled, pressed && ui.pressed]}>
                <View style={ui.flex}><Text style={styles.connectorChoiceTitle}>{connector.label}</Text><Text style={styles.connectorChoiceCopy}>{connectorLabel(connector.type)} · {displayPower(connector.powerKw)}</Text></View><Text style={styles.connectorChoiceStatus}>{!connector.enabled ? 'Disabled' : !bookings.fresh ? 'Unknown' : selectedConnectorId === connector.id ? 'Selected ✓' : 'Select'}</Text>
              </Pressable>)}
            </View> : <Text style={styles.stationAddress}>The reservation holds the entire bay, including all of its connectors.</Text>}
          </>}
          {bookingNotice ? <Text style={styles.bookingNotice} accessibilityLiveRegion="polite">{bookingNotice}</Text> : null}
          {selectedBayHasFault ? <Text style={styles.fault}>Fault reported. New reservations are disabled until the report is resolved.</Text> : null}
          {bookings.error ? <Text style={styles.fault} accessibilityLiveRegion="polite">{bookings.error}</Text> : null}
          <Text style={styles.noAvailability}>App booking only. Physical vacancy and charging are unverified.</Text>
        </ScrollView>
        <View style={styles.bookingActions}>
          {bookings.busy ? <View style={[styles.applyButton, styles.disabled]} accessibilityLiveRegion="polite"><Text style={styles.applyButtonText}>Updating your hold…</Text></View>
            : !bookings.fresh ? <Pressable accessibilityRole="button" disabled={bookings.refreshing} onPress={() => void bookings.refresh()} style={({ pressed }) => [styles.applyButton, pressed && ui.pressed]}><Text style={styles.applyButtonText}>{bookings.refreshing ? 'Refreshing…' : 'Refresh booking status'}</Text></Pressable>
            : selectedBay.mode !== 'demo' ? <Text style={styles.integrationPending}>Live reservation integration pending</Text>
              : selectedBay.availability === 'unreserved' && selectedBayHasFault ? <Text style={styles.integrationPending}>Fault reported · reservation unavailable</Text>
                : selectedBay.availability === 'unreserved' && selectedBayDirectoryUnknown ? <Text style={styles.integrationPending}>Directory status unknown · search this bay’s area before reserving</Text>
                  : selectedBay.availability === 'unreserved' && !profile ? <Pressable accessibilityRole="button" onPress={() => router.push('/profile')} style={({ pressed }) => [styles.applyButton, pressed && ui.pressed]}><Text style={styles.applyButtonText}>Set up profile to reserve</Text></Pressable>
                    : selectedBay.availability === 'unreserved' && !selectedConnector?.enabled ? <View style={[styles.applyButton, styles.disabled]}><Text style={styles.applyButtonText}>Choose a connector above</Text></View>
              : selectedBay.availability === 'unreserved' ? <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!bookings.busy, busy: !!bookings.busy }} disabled={!!bookings.busy} onPress={() => showConfirmation ? void reserveBay() : setConfirming(true)} style={({ pressed }) => [styles.applyButton, !!bookings.busy && styles.disabled, pressed && ui.pressed]}><Text style={styles.applyButtonText}>{bookings.busy ? 'Saving your hold…' : showConfirmation ? `Confirm ${holdMinutes}-minute hold` : 'Reserve demo bay'}</Text></Pressable>
                : selectedBay.isMine && selectedBay.myReservationId ? <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!bookings.busy, busy: !!bookings.busy }} disabled={!!bookings.busy} onPress={() => void cancelHold(selectedBay.myReservationId!)} style={({ pressed }) => [styles.cancelButton, !!bookings.busy && styles.disabled, pressed && ui.pressed]}><Text style={styles.cancelButtonText}>{bookings.busy ? 'Updating your hold…' : 'Cancel my reservation'}</Text></Pressable> : <Text style={styles.integrationPending}>This bay is reserved in BayReady</Text>}
        </View>
      </View> : null}

      {selected && !filtersOpen ? <View onLayout={event => setDetailHeight(event.nativeEvent.layout.height)} style={[styles.details, { bottom: detailsBottom, left: insets.left + 16, right: insets.right + 16, maxHeight: detailMaxHeight }]}>
        <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailsContent} showsVerticalScrollIndicator>
          <View style={styles.detailHeading}><View style={ui.flex}><View style={styles.bayBadge}><Text style={styles.bayBadgeText}>CHARGER</Text></View><Text style={styles.stationName}>{showDirectoryConfirmation ? 'Now, or book ahead.' : selected.name}</Text><Text style={styles.stationAddress}>{selected.address || 'Address not listed'}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Close charger details" onPress={() => { setSelected(null); setSelectedListedPlug(null); setDirectoryConfirming(false); }} style={styles.closeButton}><Text style={styles.closeMark}>×</Text></Pressable></View>
          <Pressable accessibilityRole="link" onPress={() => void openSource(selected.url)} style={({ pressed }) => [styles.stationSource, pressed && ui.pressed]}><Text style={styles.stationSourceText}>GoingElectric ↗</Text></Pressable>
          {showDirectoryConfirmation && selectedReportedGroup && selectedListedPlug ? <>
            <Text style={styles.locationInventory}>{connectorLabel(selectedReportedGroup.type)} · app plug {selectedListedPlug.ordinal} of {selectedReportedGroup.count} · {displayPower(selectedReportedGroup.power)}</Text>
            <Text style={styles.stationAddress}>Choose Reserve now or Book ahead in the reservation window.</Text>
          </> : <>
            <View style={styles.stationMeta}><Text style={styles.power}>{displayPower(reportedMaxPower)}</Text>{selected.network ? <Text style={styles.network}>{selected.network}</Text> : null}</View>
            <Text style={styles.locationInventory}>{selectedDirectoryFresh ? `${directoryCounts[selected.id].unreserved}/${reportedPlugCount} unreserved in BayReady` : `${reportedPlugCount} listed plugs · app status unknown`}</Text>
            {preparingSlots ? <Text style={styles.stationAddress}>Preparing app plug choices…</Text> : null}
            {slotCatalogError ? <Text style={styles.fault}>{slotCatalogError}</Text> : null}
            {reportedGroups.length === 0 && !preparingSlots ? <Text style={styles.stationAddress}>No connector groups match your filters.</Text> : reportedGroups.filter(group => showReserved || directoryGroupStatus(group, holdsByStation.get(selected.id) ?? [], selectedDirectoryFresh).unreserved !== 0).map(group => {
              const status = directoryGroupStatus(group, holdsByStation.get(selected.id) ?? [], selectedDirectoryFresh);
              return <View key={group.prefix} style={styles.reportedGroup}>
                <Pressable accessibilityRole="button" accessibilityLabel={`Explore ${group.count} app-only ${connectorLabel(group.type)} plugs`} accessibilityState={{ expanded: selectedReportedGroup?.prefix === group.prefix }} onPress={() => selectListedGroup(group)} style={({ pressed }) => [styles.reportedGroupHeading, pressed && ui.pressed]}>
                  <View style={ui.flex}><Text style={styles.connectorChoiceTitle}>{group.count} × {connectorLabel(group.type)} · {displayPower(group.power)}</Text><Text style={styles.connectorChoiceCopy}>{status.unreserved === null ? 'App availability unknown' : `${status.unreserved}/${status.total} app-unreserved`}</Text></View><Text style={styles.noticeActionText}>{selectedReportedGroup?.prefix === group.prefix ? 'App plugs' : 'Choose ›'}</Text>
                </Pressable>
                {selectedReportedGroup?.prefix === group.prefix ? <>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.listedPlugs}>
                    {listedPage.ordinals.map(ordinal => {
                      const hold = holdsByStation.get(selected.id)?.find(item => item.slotKey === directorySlotKey(group, ordinal));
                      return <Pressable key={ordinal} accessibilityRole="button" accessibilityLabel={`${connectorLabel(group.type)}, app plug ${ordinal} of ${group.count}`} accessibilityState={{ selected: selectedListedPlug?.ordinal === ordinal }} onPress={() => { automaticPlugSelection.current = false; setSelectedListedPlug({ stationId: selected.id, prefix: group.prefix, ordinal }); setDirectoryConfirming(true); setDirectoryNotice(null); }} style={({ pressed }) => [styles.listedPlug, selectedListedPlug?.ordinal === ordinal && styles.listedPlugSelected, pressed && ui.pressed]}><Text style={styles.listedPlugNumber}>{ordinal}</Text><Text style={styles.listedPlugType}>{connectorLabel(group.type)}</Text><Text style={styles.listedPlugCaption}>{!selectedDirectoryFresh ? 'Unknown' : hold ? hold.isMine ? 'Your hold' : 'Reserved' : 'Unreserved'}</Text></Pressable>;
                    })}
                  </ScrollView>
                  {listedPage.total > 12 ? <View style={styles.listedPager}><Pressable accessibilityRole="button" disabled={effectiveListedPage === 0} onPress={() => setListedPlugPage(effectiveListedPage - 1)} style={styles.listedPageButton}><Text style={[styles.noticeActionText, effectiveListedPage === 0 && styles.disabled]}>‹ Previous</Text></Pressable><Text style={styles.toggleCopy}>{effectiveListedPage * 12 + 1}–{Math.min((effectiveListedPage + 1) * 12, listedPage.total)} of {listedPage.total}</Text><Pressable accessibilityRole="button" disabled={(effectiveListedPage + 1) * 12 >= listedPage.total} onPress={() => setListedPlugPage(effectiveListedPage + 1)} style={styles.listedPageButton}><Text style={[styles.noticeActionText, (effectiveListedPage + 1) * 12 >= listedPage.total && styles.disabled]}>Next ›</Text></Pressable></View> : null}
                </> : null}
              </View>;
            })}
            {selectedReportedGroup && selectedListedPlug ? <View style={styles.listedSelection}><Text style={styles.connectorChoiceTitle}>{connectorLabel(selectedReportedGroup.type)} · app plug {selectedListedPlug.ordinal} of {selectedReportedGroup.count}</Text><Text style={styles.connectorChoiceCopy}>{displayPower(selectedReportedGroup.power)} · {!selectedDirectoryFresh ? 'app status unknown' : selectedDirectoryHold ? selectedDirectoryHold.isMine ? 'your app hold' : 'reserved in BayReady' : 'unreserved in BayReady'}</Text>{selectedDirectoryHold ? <Text style={styles.bookingStatus}>{untilTime(selectedDirectoryHold.reservedUntil)} · {remainingTime(selectedDirectoryHold.reservedUntil, directoryClockNow)}</Text> : null}</View> : null}
          </>}
          {selected.faultReported ? <Text style={styles.fault}>Fault reported. New app holds are disabled for this location.</Text> : null}
          {directoryBookings.error ? <Text style={styles.fault}>{directoryBookings.error}</Text> : null}
          {selectedOwnDirectoryBooking && selectedDirectoryFresh && directoryClockNow < Date.parse(selectedOwnDirectoryBooking.expiresAt) && ['now', 'scheduled'].includes(selectedOwnDirectoryBooking.bookingMode) && !showDirectoryConfirmation ? <View style={styles.confirmationSummary}><Text style={styles.confirmationText}>{selectedOwnDirectoryBooking.reservationFeeCents === 0 ? 'Free 10-minute app reservation' : 'App reservation · €' + (selectedOwnDirectoryBooking.reservationFeeCents / 100).toFixed(2) + ' mock'}</Text><Pressable accessibilityRole="button" disabled={!selectedDirectoryFresh || directoryBookings.busy || selected.faultReported || directoryClockNow >= Date.parse(selectedOwnDirectoryBooking.expiresAt)} onPress={() => void extendListedHold(selectedOwnDirectoryBooking.id)} style={[styles.applyButton, (!selectedDirectoryFresh || directoryBookings.busy || selected.faultReported) && styles.disabled]}><Text style={styles.applyButtonText}>Add 10 minutes · €1 mock</Text></Pressable><Text style={styles.toggleCopy}>Payments are simulated.</Text></View> : null}
          {directoryNotice ? <Text style={styles.bookingNotice} accessibilityLiveRegion="polite">{directoryNotice}</Text> : null}
          <Text style={styles.noAvailability}>BayReady app slots · physical availability unknown</Text>
        </ScrollView>
        <View style={styles.bookingActions}>
          {directoryBookings.busy ? <View style={[styles.applyButton, styles.disabled]}><Text style={styles.applyButtonText}>Updating app hold…</Text></View>
            : !directoryBookings.configured ? <Text style={styles.integrationPending}>A shared booking connection is required for app holds.</Text>
            : !selectedDirectoryFresh ? <Pressable accessibilityRole="button" disabled={directoryBookings.loading || directoryBookings.refreshing} onPress={() => void directoryBookings.refresh()} style={({ pressed }) => [styles.applyButton, pressed && ui.pressed]}><Text style={styles.applyButtonText}>{directoryBookings.loading || directoryBookings.refreshing ? 'Reading app bookings…' : directoryBookings.configured ? 'Refresh app booking status' : 'Connect bookings to reserve'}</Text></Pressable>
              : selected.faultReported ? <View style={styles.connectorChoices}><Text style={styles.integrationPending}>Fault reported · app reservation unavailable</Text>{selectedDirectoryHold?.isMine && selectedDirectoryHold.myReservationId ? <Pressable accessibilityRole="button" onPress={() => void cancelListedHold(selectedDirectoryHold.myReservationId!)} style={styles.cancelButton}><Text style={styles.cancelButtonText}>Cancel my app reservation</Text></Pressable> : null}</View>
                    : !selectedSlotKey ? <View style={[styles.applyButton, styles.disabled]}><Text style={styles.applyButtonText}>Choose an app plug above</Text></View>
                      : !profile ? <Pressable accessibilityRole="button" onPress={() => router.push('/profile')} style={styles.applyButton}><Text style={styles.applyButtonText}>Set up profile to reserve</Text></Pressable>
                        : <View style={styles.connectorChoices}><Pressable accessibilityRole="button" onPress={() => setDirectoryConfirming(value => !value)} style={({ pressed }) => [styles.applyButton, pressed && ui.pressed]}><Text style={styles.applyButtonText}>{showDirectoryConfirmation ? '‹ Back to app plug' : selectedDirectoryHold ? 'Book this app plug ahead' : 'Reserve now or book ahead'}</Text></Pressable>{selectedDirectoryHold?.isMine && selectedDirectoryHold.myReservationId ? <Pressable accessibilityRole="button" onPress={() => void cancelListedHold(selectedDirectoryHold.myReservationId!)} style={({ pressed }) => [styles.cancelButton, pressed && ui.pressed]}><Text style={styles.cancelButtonText}>Cancel my app reservation</Text></Pressable> : selectedDirectoryHold ? <Text style={styles.integrationPending}>Reserved now by another BayReady user</Text> : null}</View>}
        </View>
      </View> : null}

      {selectedAudimax && !filtersOpen ? (
        <View onLayout={event => setDetailHeight(event.nativeEvent.layout.height)} style={[styles.details, { bottom: detailsBottom, left: insets.left + 16, right: insets.right + 16, maxHeight: detailMaxHeight }]}>
          <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailsContent} showsVerticalScrollIndicator>
            <View style={styles.detailHeading}>
              <View style={ui.flex}>
                <View style={[styles.bayBadge, { backgroundColor: '#EDE7F6' }]}>
                  <Text style={[styles.bayBadgeText, { color: '#6A1B9A' }]}>ECURIOUS LIVE HARDWARE · {audimaxTeam.toUpperCase()}</Text>
                </View>
                <Text style={styles.stationName}>Audimax Munich (TUM)</Text>
                <Text style={styles.stationAddress}>Arcisstraße 21, 80333 München</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Close Audimax details" onPress={() => setSelectedAudimax(false)} style={styles.closeButton}>
                <Text style={styles.closeMark}>×</Text>
              </Pressable>
            </View>

            {audimaxError ? <Text style={styles.fault}>{audimaxError}</Text> : null}
            {audimaxActionNotice ? <Text style={styles.bookingNotice}>{audimaxActionNotice}</Text> : null}

            {activeHold ? (
              <View style={[styles.confirmationSummary, { borderColor: activeHold.status === 'scheduled' ? '#1565C0' : activeHold.status === 'occupied' ? '#2E7D32' : '#8DA93C', borderWidth: 1 }]}>
                <Text style={[styles.confirmationText, { fontWeight: '700', color: activeHold.status === 'scheduled' ? '#1565C0' : activeHold.status === 'occupied' ? '#2E7D32' : activeHoldSecondsLeft > 0 ? '#2E7D32' : '#C62828' }]}>
                  {activeHold.status === 'scheduled'
                    ? '⏰ Scheduled Booking (Barrier raises 30s before)'
                    : activeHold.status === 'occupied'
                    ? '🚗 Vehicle Detected in Bay · Occupied'
                    : activeHoldSecondsLeft > 0
                    ? `✓ Barrier Raised · Waiting for Car (${activeHoldSecondsLeft}s left)`
                    : '⚠ 30-Second No-Show Window Expired'}
                </Text>
                <Text style={styles.confirmationText}>Bay: {activeHold.lockName} (ID: {activeHold.lockId})</Text>
                <Text style={styles.confirmationText}>Whitelisted plate: {activeHold.plate}</Text>
                {activeHold.status === 'scheduled' && activeHold.startsAt ? (
                  <Text style={styles.confirmationText}>Arrival time: {formatHardwareInstant(activeHold.startsAt)}</Text>
                ) : null}
                <Text style={styles.toggleCopy}>
                  {activeHold.status === 'scheduled'
                    ? `Barrier automatically raises at ${new Date(activeHold.raiseAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
                    : activeHold.status === 'occupied'
                    ? 'Vehicle arrived and is parked in the bay. Barrier is protecting your spot.'
                    : activeHoldSecondsLeft > 0
                    ? `Waiting 30 seconds for car arrival. Auto-unlocks if not showing up by ${new Date(activeHold.expiresAt).toLocaleTimeString()} (${activeHoldSecondsLeft}s left)`
                    : 'Unlocking barrier and clearing whitelist…'}
                </Text>
                {activeHold.status === 'active' && activeHoldSecondsLeft > 0 ? (
                  <View style={{ marginTop: 8 }}>
                    <Pressable
                      accessibilityRole="button"
                      disabled={audimaxActionBusy}
                      onPress={() => void handleAudimaxExtend()}
                      style={({ pressed }) => [styles.applyButton, { backgroundColor: '#8DA93C', marginVertical: 4 }, pressed && ui.pressed]}>
                      <Text style={styles.applyButtonText}>+ Add 30 seconds · €1 fee</Text>
                    </Pressable>
                    <Text style={styles.toggleCopy}>Haven't arrived yet? Add 30 more seconds before auto-unlock · €1 mock fee.</Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            <Text style={styles.filterLabel}>Available Bays / Locks</Text>
            {audimaxLocks.length === 0 && !audimaxLoading ? (
              <Text style={styles.stationAddress}>No locks reported by the live service.</Text>
            ) : (
              audimaxLocks.map(lock => {
                const isSelected = selectedLockId === lock.id;
                const isUserHold = activeHold?.lockId === lock.id;
                return (
                  <Pressable
                    key={lock.id}
                    accessibilityRole="button"
                    onPress={() => {
                      setSelectedLockId(lock.id);
                      setAudimaxModalOpen(true);
                    }}
                    style={({ pressed }) => [
                      styles.bayChoice,
                      isSelected && { borderColor: '#9C27B0', backgroundColor: '#F3E5F5' },
                      isUserHold && { borderColor: '#8DA93C', backgroundColor: '#F0F6DC' },
                      pressed && ui.pressed,
                    ]}>
                    <View style={ui.flex}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <Text style={styles.bayChoiceName}>{lock.name || lock.id}</Text>
                        {lock.id === PREFERRED_LOCK_ID ? (
                          <View style={{ backgroundColor: '#9C27B0', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                            <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>ACTIVE DEMO</Text>
                          </View>
                        ) : null}
                        {isUserHold ? (
                          <View style={{ backgroundColor: '#739332', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                            <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>YOUR HOLD</Text>
                          </View>
                        ) : null}
                      </View>
                      <Text style={styles.bayChoiceCopy}>
                        Barrier: <Text style={{ fontWeight: '700', color: lock.status === 'raised' ? '#A77A24' : '#2E7D32' }}>{lock.status}</Text>
                        {' · '}Presence: <Text style={{ fontWeight: '700', color: lock.carPresence === 'occupied' ? '#C62828' : '#2E7D32' }}>{lock.carPresence}</Text>
                        {lock.hasCamera ? ' · 📷 Camera' : ''}
                      </Text>
                      <Text style={[styles.bayChoiceCopy, { marginTop: 2 }]}>
                        {lock.battery12V !== undefined ? `12V: ${lock.battery12V}V` : ''}
                        {lock.signalStrength4G !== undefined ? ` · 4G: ${lock.signalStrength4G}` : ''}
                        {lock.waterIngress ? ' · ⚠ Water alert' : ''}
                        {lock.activeErrors && lock.activeErrors.length > 0 ? ` · ⚠ Errors: ${lock.activeErrors.join(', ')}` : ''}
                      </Text>
                    </View>
                    <View style={styles.bayChoiceEnd}>
                      <Text style={[styles.bayChoiceStatus, isSelected && { color: '#9C27B0' }]}>
                        {isUserHold ? 'Active' : isSelected ? 'Selected ✓' : 'Select'}
                      </Text>
                      <Text style={styles.choiceArrow}>›</Text>
                    </View>
                  </Pressable>
                );
              })
            )}

            <View style={styles.confirmationSummary}>
              <Text style={styles.confirmationText}>
                Driver plate: <Text style={{ fontWeight: '700' }}>{profile?.licensePlate?.trim() || 'MBD14E (Default test plate)'}</Text>
              </Text>
              {!profile?.licensePlate?.trim() ? (
                <Link href="/profile" asChild>
                  <Pressable accessibilityRole="button">
                    <Text style={styles.noticeActionText}>Set custom plate in Profile ›</Text>
                  </Pressable>
                </Link>
              ) : null}
            </View>

            <Text style={styles.noAvailability}>
              Live Ecurious hardware lock. Reserving sends a lock command to raise the barrier and adds your plate to the whitelist. Leaving clears the whitelist and lowers the barrier.
            </Text>
          </ScrollView>

          <View style={styles.bookingActions}>
            <View style={{ gap: 8 }}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setAudimaxModalOpen(true)}
                style={({ pressed }) => [
                  styles.applyButton,
                  pressed && ui.pressed,
                ]}>
                <Text style={styles.applyButtonText}>
                  {activeHold ? 'Manage / Leave reservation' : 'Reserve now or book ahead'}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => void loadAudimaxData()}
                disabled={audimaxLoading}
                style={({ pressed }) => [styles.cancelButton, pressed && ui.pressed]}>
                <Text style={styles.cancelButtonText}>{audimaxLoading ? 'Refreshing…' : 'Refresh hardware status'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}

      <AudimaxBookingModal
        visible={audimaxModalOpen}
        lock={audimaxLocks.find(l => l.id === selectedLockId) ?? audimaxLocks[0]}
        allLocks={audimaxLocks}
        team={audimaxTeam}
        profile={profile}
        activeHold={activeHold}
        busy={audimaxActionBusy}
        error={audimaxError}
        notice={audimaxActionNotice}
        onSelectLock={id => setSelectedLockId(id)}
        onReserve={async choice => {
          await handleAudimaxReserve(choice);
        }}
        onExtend={async () => {
          await handleAudimaxExtend();
        }}
        onLeave={async () => {
          await handleAudimaxLeave();
        }}
        onClose={() => setAudimaxModalOpen(false)}
        onProfile={() => {
          setAudimaxModalOpen(false);
          router.push('/profile');
        }}
      />

      <MunichEventsModal
        visible={eventsModalOpen}
        selectedEvent={selectedEvent}
        audimaxLocks={audimaxLocks}
        directoryStations={result?.stations}
        directoryCounts={directoryCounts}
        onSelectEvent={event => setSelectedEvent(event)}
        onSelectSpot={handleSelectEventSpot}
        onClose={() => setEventsModalOpen(false)}
      />

      {showDirectoryConfirmation && selected && selectedReportedGroup && selectedListedPlug ? <DirectoryBookingModal visible title={selected.name} plugLabel={connectorLabel(selectedReportedGroup.type) + ' · app plug ' + selectedListedPlug.ordinal + ' of ' + selectedReportedGroup.count + ' · ' + displayPower(selectedReportedGroup.power)} profile={profile} now={directoryClockNow} fresh={selectedDirectoryFresh} busy={directoryBookings.busy} nowAllowed={!selectedDirectoryHold} error={directoryBookings.error} unavailableReason={selected.faultReported ? 'A fault is reported for this location. New reservations are disabled; your existing app bookings can still be cancelled from Filters.' : undefined} onConfirm={reserveListedPlug} onClose={() => setDirectoryConfirming(false)} onChangePlug={() => { automaticPlugSelection.current = false; setDirectoryConfirming(false); }} onProfile={() => { setDirectoryConfirming(false); router.push('/profile'); }} onRefresh={() => void directoryBookings.refresh()} onSource={() => void openSource(selected.url)} /> : null}

      {myBookingsOpen ? <DirectoryBookingsList visible bookings={ownDirectoryBookings} activeIds={new Set(directoryHolds.filter(hold => hold.isMine && hold.myReservationId).map(hold => hold.myReservationId!))} now={directoryClockNow} fresh={directoryBookings.fresh} busy={directoryBookings.busy} loading={directoryBookings.loading} error={directoryBookings.error} labelFor={listedHoldLabel} onClose={() => setMyBookingsOpen(false)} onRefresh={() => void directoryBookings.refresh()} onExtend={id => void extendListedHold(id)} onCancel={id => void cancelListedHold(id)} /> : null}

      <View style={[styles.navigation, { bottom: navigationBottom, left: insets.left + 16 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Reserve now or book ahead at a public app charger" onPress={startPublicReservation} style={({ pressed }) => [styles.navButton, styles.navPrimary, pressed && ui.pressed]}><Text style={[styles.navButtonText, styles.navPrimaryText]}>Reserve</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={() => { setFiltersOpen(false); setMyBookingsOpen(true); }} style={({ pressed }) => [styles.navButton, pressed && ui.pressed]}><Text style={styles.navButtonText}>Bookings{ownDirectoryBookings.length ? ' · ' + ownDirectoryBookings.length : ''}</Text></Pressable>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Center map on my location" accessibilityState={{ disabled: locating, busy: locating }} disabled={locating} onPress={() => void locate()} style={({ pressed }) => [styles.locationButton, { bottom: navigationBottom, right: insets.right + 16 }, locating && styles.disabled, pressed && ui.pressed]}>
        {locating ? <ActivityIndicator color={palette.ink} size="small" /> : <Text style={styles.locationMark}>◎</Text>}
      </Pressable>

      <View onLayout={event => setSourceHeight(event.nativeEvent.layout.height)} style={[styles.sourceBar, { bottom: insets.bottom + 10, left: insets.left + 16, right: insets.right + 16 }]}>
        <View style={styles.attributionRow}><Pressable accessibilityRole="link" onPress={() => void openSource()} style={({ pressed }) => pressed && ui.pressed}><Text style={styles.attribution}>Directory © GoingElectric ↗</Text></Pressable><Text style={styles.resultCount}>{`${visibleLocations.length + visibleStations.length} locations${visibleLocations.length ? ` · ${visibleBayCount} unreserved bays` : ''}`}</Text></View>
        {showDirectoryOnly && result ? <Text style={styles.footerCopy}>Retrieved {new Date(result.fetchedAt).toLocaleString()}{result.hasMore ? ' · zoom in for more' : ''} · {directoryBookings.fresh ? 'app booking status refreshed' : 'app booking status unknown'}</Text> : <Text style={styles.footerCopy}>{bookings.fresh ? 'BayReady bookings · physical vacancy unverified' : 'Connect or refresh bookings · availability unknown'}</Text>}
        {linkError ? <Text style={styles.linkError} accessibilityLiveRegion="polite">{linkError}</Text> : null}
      </View>
    </View>
  );
}

function Filter({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={({ pressed }) => [styles.filter, active && styles.activeFilter, pressed && ui.pressed]}><Text style={[styles.filterText, active && styles.activeFilterText]}>{label}</Text></Pressable>;
}

function MapNotice({ title, copy, action, onPress, secondaryAction, onSecondaryPress }: { title: string; copy: string; action?: string; onPress?: () => void; secondaryAction?: string; onSecondaryPress?: () => void }) {
  return <View style={styles.notice} accessibilityLiveRegion="polite"><Text style={styles.noticeTitle}>{title}</Text><Text style={styles.noticeCopy}>{copy}</Text>{action && onPress ? <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.noticeAction, pressed && ui.pressed]}><Text style={styles.noticeActionText}>{action}</Text></Pressable> : null}{secondaryAction && onSecondaryPress ? <Pressable accessibilityRole="button" onPress={onSecondaryPress} style={({ pressed }) => [styles.noticeAction, pressed && ui.pressed]}><Text style={styles.noticeActionText}>{secondaryAction}</Text></Pressable> : null}</View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.soft },
  map: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  topRow: { position: 'absolute', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  topButtons: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  brandPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: palette.paper, borderRadius: 20, paddingVertical: 6, paddingHorizontal: 9, elevation: 4, shadowColor: palette.ink, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 5, flexShrink: 1 },
  brandMark: { width: 26, height: 28, backgroundColor: palette.lime, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  bolt: { color: palette.ink, fontSize: 24, fontWeight: '800', lineHeight: 26 },
  brand: { color: palette.ink, fontSize: 16, fontWeight: '800', letterSpacing: -0.5 },
  brandCaption: { color: palette.muted, fontSize: 7, fontWeight: '700', letterSpacing: 0.6, marginTop: 1 },
  filterButton: { minHeight: 40, paddingHorizontal: 10, borderRadius: 20, backgroundColor: palette.paper, justifyContent: 'center', alignItems: 'center', elevation: 4, shadowColor: palette.ink, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 5 },
  filterButtonOpen: { backgroundColor: palette.ink },
  filterButtonText: { fontSize: 12, fontWeight: '700', color: palette.ink },
  filterButtonTextOpen: { color: palette.lime },
  filterPanel: { position: 'absolute', width: 304, maxWidth: '90%', backgroundColor: palette.paper, borderWidth: 1, borderColor: palette.line, borderRadius: 23, elevation: 7, shadowColor: palette.ink, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 10 },
  filterContent: { padding: 17, gap: 12 },
  filterHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  panelTitle: { flex: 1, fontSize: 18, fontWeight: '800', color: palette.ink, letterSpacing: -0.4 },
  smallClose: { width: 32, minHeight: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: palette.soft },
  filterLabel: { color: palette.muted, fontSize: 12, fontWeight: '700' },
  connectorPreference: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, borderColor: palette.line, paddingTop: 10 },
  preferenceValue: { color: palette.ink, fontSize: 16, fontWeight: '700', marginTop: 5 },
  preferenceEdit: { minHeight: 40, justifyContent: 'center' },
  filters: { flexDirection: 'row', gap: 7 },
  filter: { flex: 1, minHeight: 36, borderWidth: 1, borderColor: palette.line, borderRadius: 11, backgroundColor: palette.paper, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, paddingVertical: 7 },
  activeFilter: { backgroundColor: palette.ink, borderColor: palette.ink },
  filterText: { color: palette.muted, fontSize: 12, fontWeight: '600' },
  activeFilterText: { color: palette.lime },
  toggleRow: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingTop: 8, borderTopWidth: 1, borderColor: palette.line },
  toggleTitle: { color: palette.ink, fontSize: 13, fontWeight: '700' },
  toggleCopy: { color: palette.muted, fontSize: 11, marginTop: 3 },
  reservedList: { gap: 10, borderTopWidth: 1, borderColor: palette.line, paddingTop: 12 },
  reservedRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: palette.soft, borderRadius: 11, padding: 10 },
  rowCancel: { minHeight: 38, paddingHorizontal: 8, justifyContent: 'center' },
  rowCancelText: { color: palette.errorInk, fontSize: 12, fontWeight: '700' },
  filterFootnote: { fontSize: 11, lineHeight: 16, color: palette.muted },
  applyButton: { minHeight: 43, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.lime, borderRadius: 13 },
  applyButtonText: { fontSize: 14, color: palette.ink, fontWeight: '800' },
  disabled: { opacity: 0.45 },
  searchPosition: { position: 'absolute', left: 16, right: 16, alignItems: 'center', gap: 6 },
  searchButton: { minHeight: 45, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 18, paddingVertical: 9, borderRadius: 24, backgroundColor: palette.lime, borderWidth: 1, borderColor: '#B5D64F', shadowColor: palette.ink, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.13, shadowRadius: 5, elevation: 4 },
  searchMark: { fontSize: 25, color: palette.ink, lineHeight: 27 },
  searchText: { color: palette.ink, fontSize: 14, fontWeight: '800' },
  placeLabel: { color: palette.ink, fontSize: 11, backgroundColor: palette.paper, paddingVertical: 5, paddingHorizontal: 9, borderRadius: 9 },
  noticePosition: { position: 'absolute', gap: 8 },
  notice: { padding: 14, gap: 6, borderRadius: 15, backgroundColor: palette.paper, borderWidth: 1, borderColor: palette.line, elevation: 3 },
  noticeTitle: { color: palette.ink, fontSize: 15, fontWeight: '700' },
  noticeCopy: { color: palette.muted, fontSize: 13, lineHeight: 19 },
  noticeAction: { minHeight: 36, justifyContent: 'center', alignSelf: 'flex-start' },
  noticeActionText: { color: palette.ink, fontSize: 13, fontWeight: '800', textDecorationLine: 'underline' },
  locationNotice: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: palette.cream, borderRadius: 13, borderWidth: 1, borderColor: palette.line, padding: 12 },
  locationCopy: { flex: 1, color: palette.muted, fontSize: 12, lineHeight: 18 },
  dismiss: { color: palette.ink, fontSize: 22 },
  details: { position: 'absolute', backgroundColor: palette.paper, borderRadius: 23, elevation: 5, borderWidth: 1, borderColor: palette.line, shadowColor: palette.ink, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 8 },
  detailsContent: { padding: 17, gap: 9 },
  detailScroll: { flexShrink: 1 },
  detailHeading: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  locationInventory: { color: palette.ink, fontSize: 13, fontWeight: '700', lineHeight: 20 },
  bayChoice: { borderWidth: 1, borderColor: palette.line, backgroundColor: palette.cream, padding: 12, borderRadius: 14, flexDirection: 'row', gap: 12, alignItems: 'center' },
  bayChoiceName: { color: palette.ink, fontSize: 14, fontWeight: '700' },
  bayChoiceCopy: { color: palette.muted, fontSize: 11, lineHeight: 17, marginTop: 4 },
  bayChoiceEnd: { alignItems: 'flex-end', gap: 3 },
  bayChoiceStatus: { color: palette.muted, fontSize: 10, fontWeight: '700' },
  choiceArrow: { color: palette.ink, fontSize: 23, lineHeight: 24 },
  hierarchyBack: { minHeight: 30, justifyContent: 'center', alignSelf: 'flex-start' },
  hierarchyBackText: { color: palette.muted, fontSize: 12, fontWeight: '700' },
  connectorChoices: { gap: 8 },
  connectorChoice: { borderRadius: 12, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.cream, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 11, minHeight: 60 },
  connectorChoiceSelected: { borderColor: '#8DA93C', backgroundColor: '#F0F6DC' },
  connectorChoiceTitle: { color: palette.ink, fontSize: 13, fontWeight: '700' },
  connectorChoiceCopy: { color: palette.muted, fontSize: 11, lineHeight: 17, marginTop: 3 },
  connectorChoiceStatus: { color: palette.ink, fontSize: 10, fontWeight: '700' },
  reportedGroup: { borderWidth: 1, borderColor: palette.line, borderRadius: 13, overflow: 'hidden' },
  reportedGroupHeading: { minHeight: 62, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.cream },
  listedPlugs: { padding: 10, gap: 8 },
  listedPlug: { minWidth: 76, minHeight: 85, paddingHorizontal: 10, paddingVertical: 9, borderWidth: 1, borderColor: palette.line, borderRadius: 11, alignItems: 'center', gap: 4, backgroundColor: palette.paper },
  listedPlugSelected: { borderColor: '#8DA93C', backgroundColor: '#F0F6DC' },
  listedPlugNumber: { color: palette.ink, fontSize: 20, fontWeight: '800' },
  listedPlugType: { color: palette.ink, fontSize: 11, fontWeight: '700' },
  listedPlugCaption: { color: palette.muted, fontSize: 9 },
  listedPager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 10, paddingBottom: 8 },
  listedPageButton: { minHeight: 34, justifyContent: 'center' },
  listedSelection: { backgroundColor: palette.soft, padding: 12, borderRadius: 13, gap: 8 },
  mappingUnavailable: { color: palette.warningInk, fontSize: 12, fontWeight: '700', lineHeight: 18 },
  confirmationSummary: { padding: 11, borderRadius: 12, backgroundColor: palette.soft, gap: 6 },
  confirmationText: { color: palette.ink, fontSize: 12, lineHeight: 18 },
  stationName: { color: palette.ink, fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  stationAddress: { color: palette.muted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  closeButton: { minWidth: 34, minHeight: 34, justifyContent: 'center', alignItems: 'center', backgroundColor: palette.soft, borderRadius: 11 },
  closeMark: { color: palette.ink, fontSize: 23 },
  stationMeta: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  power: { color: palette.ink, backgroundColor: palette.lime, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8, fontSize: 13, fontWeight: '800' },
  network: { color: palette.muted, fontSize: 12 },
  connectors: { color: palette.muted, fontSize: 12, lineHeight: 19 },
  fault: { color: palette.errorInk, backgroundColor: palette.error, padding: 9, borderRadius: 8, fontSize: 12, lineHeight: 18 },
  stationSource: { minHeight: 31, justifyContent: 'center', alignSelf: 'flex-start' },
  stationSourceText: { fontSize: 12, fontWeight: '800', color: palette.ink, textDecorationLine: 'underline' },
  noAvailability: { color: palette.muted, fontSize: 11, lineHeight: 16 },
  directoryStatus: { color: palette.warningInk, backgroundColor: palette.warning, padding: 10, borderRadius: 10, fontSize: 12, lineHeight: 18 },
  bayBadge: { alignSelf: 'flex-start', backgroundColor: palette.soft, paddingVertical: 4, paddingHorizontal: 7, borderRadius: 7, marginBottom: 6 },
  bayBadgeText: { color: palette.ink, fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },
  bookingStatus: { fontSize: 14, lineHeight: 21, color: palette.ink, fontWeight: '700' },
  bookingNotice: { color: palette.ink, backgroundColor: palette.soft, borderRadius: 10, padding: 10, fontSize: 12, lineHeight: 18 },
  bookingActions: { paddingHorizontal: 17, paddingTop: 8, paddingBottom: 15, borderTopWidth: 1, borderColor: palette.line },
  integrationPending: { textAlign: 'center', color: palette.muted, fontSize: 12, lineHeight: 18, paddingVertical: 7 },
  cancelButton: { minHeight: 43, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.soft, borderWidth: 1, borderColor: palette.line, borderRadius: 13 },
  cancelButtonText: { fontSize: 13, color: palette.ink, fontWeight: '700' },
  navigation: { position: 'absolute', flexDirection: 'row', gap: 8 },
  navPrimary: { backgroundColor: palette.ink }, navPrimaryText: { color: palette.paper },
  navButton: { minHeight: 46, paddingHorizontal: 15, alignItems: 'center', justifyContent: 'center', borderRadius: 23, backgroundColor: palette.paper, elevation: 4, shadowColor: palette.ink, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 4 },
  navButtonText: { color: palette.ink, fontSize: 12, fontWeight: '700' },
  locationButton: { position: 'absolute', width: 50, height: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 25, backgroundColor: palette.paper, elevation: 4, shadowColor: palette.ink, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 4 },
  locationMark: { fontSize: 30, color: palette.ink, lineHeight: 35 },
  sourceBar: { position: 'absolute', paddingHorizontal: 13, paddingVertical: 9, gap: 3, backgroundColor: palette.paper, borderRadius: 15, elevation: 3, borderWidth: 1, borderColor: palette.line },
  attributionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  attribution: { fontSize: 11, fontWeight: '700', color: palette.ink, textDecorationLine: 'underline', paddingVertical: 2 },
  resultCount: { color: palette.muted, fontSize: 10 },
  footerCopy: { color: palette.muted, fontSize: 9, lineHeight: 14 },
  linkError: { color: palette.errorInk, fontSize: 12, lineHeight: 17 },
  eventPillContainer: { position: 'absolute', zIndex: 10 },
  eventPill: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FFFFFF', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#D4E2BA', shadowColor: palette.ink, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 4, elevation: 4 },
  eventPillTitle: { fontSize: 12, fontWeight: '800', color: palette.ink },
  eventPillSubtitle: { fontSize: 10, color: '#2E7D32', fontWeight: '600' },
  eventPillClose: { width: 22, height: 22, borderRadius: 11, backgroundColor: palette.soft, alignItems: 'center', justifyContent: 'center' },
  eventPillCloseText: { fontSize: 14, color: palette.ink, fontWeight: '800', lineHeight: 16 },
});
