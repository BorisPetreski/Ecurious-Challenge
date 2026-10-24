import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';

import { AppFrame, ui } from '@/components/bayready-ui';
import { palette } from '@/constants/bayready';
import { fetchDirectory, type DirectoryRegion, type DirectoryResult, type DirectoryStation } from '@/lib/goingelectric-api';

// Expo replaces this public directory key at bundle time. Hardware keys stay on the backend.
const DIRECTORY_KEY = process.env.EXPO_PUBLIC_GOINGELECTRIC_API_KEY?.trim() ?? '';
const SOURCE_URL = 'https://www.goingelectric.de/stromtankstellen/';
const CACHE_LIFETIME_MS = 60 * 60 * 1_000;
const INITIAL_REGION: DirectoryRegion = { latitude: 52.52, longitude: 13.405, latitudeDelta: 0.095, longitudeDelta: 0.095 };
type PlugFilter = 'CCS' | 'Typ2' | undefined;

function regionMoved(next: DirectoryRegion, previous: DirectoryRegion) {
  return Math.abs(next.latitude - previous.latitude) > previous.latitudeDelta * 0.04 ||
    Math.abs(next.longitude - previous.longitude) > previous.longitudeDelta * 0.04 ||
    Math.abs(next.latitudeDelta - previous.latitudeDelta) > previous.latitudeDelta * 0.12 ||
    Math.abs(next.longitudeDelta - previous.longitudeDelta) > previous.longitudeDelta * 0.12;
}

function displayPower(value: number | null) {
  return value === null ? 'Power not listed' : `${Number.isInteger(value) ? value : value.toFixed(1)} kW`;
}

export default function MapScreen() {
  const map = useRef<MapView>(null);
  const region = useRef<DirectoryRegion>(INITIAL_REGION);
  const searchedRegion = useRef<DirectoryRegion | null>(null);
  const request = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const mounted = useRef(false);
  const expiresAt = useRef<number | null>(null);
  const [result, setResult] = useState<DirectoryResult | null>(null);
  const [selected, setSelected] = useState<DirectoryStation | null>(null);
  const [minPower, setMinPower] = useState<number | undefined>();
  const [plug, setPlug] = useState<PlugFilter>();
  const [loading, setLoading] = useState(false);
  const [areaChanged, setAreaChanged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [locationMessage, setLocationMessage] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [outsideBerlin, setOutsideBerlin] = useState(false);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);

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
    setResult(null);
    expiresAt.current = null;
    try {
      const next = await fetchDirectory({ apiKey: DIRECTORY_KEY, region: target, minPower: power, plug: connector, signal: controller.signal });
      if (!mounted.current || controller.signal.aborted || currentSequence !== sequence.current) return;
      setResult(next);
      expiresAt.current = Date.now() + CACHE_LIFETIME_MS;
      searchedRegion.current = target;
      setAreaChanged(regionMoved(region.current, target));
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
    void search(INITIAL_REGION);
    const expire = () => {
      if (expiresAt.current !== null && Date.now() >= expiresAt.current) {
        expiresAt.current = null;
        setResult(null);
        setSelected(null);
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
  const changePlug = (value?: PlugFilter) => {
    if (value === plug) return;
    setPlug(value);
    void search(region.current, minPower, value);
  };

  return (
    <AppFrame mode="directory">
      <View style={styles.intro}>
        <View style={styles.titleRow}>
          <View style={ui.flex}><Text accessibilityRole="header" style={styles.title}>Find a charger</Text><Text style={styles.subtitle}>{outsideBerlin ? 'Move the map · search any area' : 'Berlin · move the map to explore'}</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="Center map on my location" accessibilityState={{ disabled: locating, busy: locating }} disabled={locating} onPress={() => void locate()} style={({ pressed }) => [styles.locationButton, locating && styles.disabled, pressed && ui.pressed]}>
            {locating ? <ActivityIndicator color={palette.ink} size="small" /> : <Text style={styles.locationMark}>◎</Text>}<Text style={styles.locationText}>My location</Text>
          </Pressable>
        </View>
        <View style={styles.filters}>
          <Filter label="Any power" active={minPower === undefined} onPress={() => changePower()} />
          <Filter label="50+ kW" active={minPower === 50} onPress={() => changePower(50)} />
          <Filter label="150+ kW" active={minPower === 150} onPress={() => changePower(150)} />
        </View>
        <View style={styles.filters}>
          <Filter label="All plugs" active={plug === undefined} onPress={() => changePlug()} />
          <Filter label="CCS" active={plug === 'CCS'} onPress={() => changePlug('CCS')} />
          <Filter label="Type 2" active={plug === 'Typ2'} onPress={() => changePlug('Typ2')} />
        </View>
      </View>

      <View style={styles.mapContainer}>
        <MapView ref={map} style={styles.map} initialRegion={INITIAL_REGION} showsMyLocationButton={false} showsCompass toolbarEnabled={false}
          onRegionChangeComplete={next => { region.current = next; setOutsideBerlin(Math.abs(next.latitude - INITIAL_REGION.latitude) > 0.04 || Math.abs(next.longitude - INITIAL_REGION.longitude) > 0.04); setAreaChanged(!searchedRegion.current || regionMoved(next, searchedRegion.current)); }}>
          {result?.stations.map(station => <Marker key={station.id} identifier={String(station.id)} coordinate={{ latitude: station.latitude, longitude: station.longitude }} title={station.name} description={displayPower(station.maxPower)} pinColor={selected?.id === station.id ? palette.ink : station.faultReported ? palette.errorInk : '#739332'} onPress={() => setSelected(station)} />)}
          {userLocation ? <Marker key="your-location" coordinate={userLocation} title="Your location" pinColor="#356EAE" /> : null}
        </MapView>
        <View style={styles.searchPosition} pointerEvents="box-none">
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: !DIRECTORY_KEY || loading, busy: loading }} disabled={!DIRECTORY_KEY || loading} onPress={() => void search(region.current, minPower, plug)} style={({ pressed }) => [styles.searchButton, !DIRECTORY_KEY && styles.disabled, pressed && ui.pressed]}>
            {loading ? <ActivityIndicator size="small" color={palette.ink} /> : <Text style={styles.searchMark}>⌕</Text>}<Text style={styles.searchText}>{loading ? 'Finding chargers…' : areaChanged || !result ? 'Search this area' : 'Refresh chargers'}</Text>
          </Pressable>
        </View>
        <View style={styles.noticePosition} pointerEvents="box-none">
          {!DIRECTORY_KEY ? <MapNotice title="Directory key needed" copy="Add the GoingElectric app key to the local setup, then restart Expo. You can still explore the map." action="Open official directory ↗" onPress={() => void openSource()} /> : null}
          {error ? <MapNotice title="Chargers could not load" copy={error} action="Try this area again" onPress={() => void search(region.current, minPower, plug)} /> : null}
          {expired ? <MapNotice title="Time for a fresh search" copy="Previous directory results were cleared after one hour. Search this area to load current directory data." /> : null}
          {result && result.stations.length === 0 ? <MapNotice title="No matching chargers here" copy="Try a wider area or change the connector and power filters." /> : null}
          {locationMessage ? <Pressable accessibilityRole="button" accessibilityLabel="Dismiss location message" onPress={() => setLocationMessage(null)} style={styles.locationNotice}><Text style={styles.locationCopy}>{locationMessage}</Text><Text style={styles.dismiss}>×</Text></Pressable> : null}
        </View>
      </View>

      {selected ? <View style={styles.details}>
        <ScrollView contentContainerStyle={styles.detailsContent} showsVerticalScrollIndicator>
          <View style={styles.detailHeading}><View style={ui.flex}><Text style={styles.stationName}>{selected.name}</Text><Text style={styles.stationAddress}>{selected.address || 'Address not listed'}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Close charger details" onPress={() => setSelected(null)} style={styles.closeButton}><Text style={styles.closeMark}>×</Text></Pressable></View>
          <Pressable accessibilityRole="link" onPress={() => void openSource(selected.url)} style={({ pressed }) => [styles.stationSource, pressed && ui.pressed]}><Text style={styles.stationSourceText}>View this station on GoingElectric ↗</Text></Pressable>
          <View style={styles.stationMeta}><Text style={styles.power}>{displayPower(selected.maxPower)}</Text>{selected.network ? <Text style={styles.network}>{selected.network}</Text> : null}</View>
          <Text style={styles.connectors}>{selected.connectors.length > 0 ? selected.connectors.map(connector => `${connector.count} × ${connector.type} · ${displayPower(connector.power)}`).join('\n') : 'Connector details not listed.'}</Text>
          {selected.faultReported ? <Text style={styles.fault}>A fault is reported in the directory. Check the station’s source page before travelling.</Text> : null}
          <Text style={styles.noAvailability}>Directory information · live availability and reservations are not provided.</Text>
        </ScrollView>
      </View> : null}

      <View style={styles.footer}>
        <View style={styles.attributionRow}><Pressable accessibilityRole="link" onPress={() => void openSource()} style={({ pressed }) => pressed && ui.pressed}><Text style={styles.attribution}>Data © GoingElectric ↗</Text></Pressable><Text style={styles.resultCount}>{result ? `${result.stations.length} chargers` : 'Public directory'}</Text></View>
        <Text style={styles.footerCopy}>{result ? `Retrieved ${new Date(result.fetchedAt).toLocaleString()}${result.hasMore ? ' · More results available; zoom in.' : ''}` : 'Direct directory requests · map data is separate from the demo bay.'}</Text>
        {result ? <Text style={styles.footerCopy}>Directory data · no live availability or reservations.</Text> : null}
        {linkError ? <Text style={styles.linkError} accessibilityLiveRegion="polite">{linkError}</Text> : null}
      </View>
    </AppFrame>
  );
}

function Filter({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={({ pressed }) => [styles.filter, active && styles.activeFilter, pressed && ui.pressed]}><Text style={[styles.filterText, active && styles.activeFilterText]}>{label}</Text></Pressable>;
}

function MapNotice({ title, copy, action, onPress }: { title: string; copy: string; action?: string; onPress?: () => void }) {
  return <View style={styles.notice} accessibilityLiveRegion="polite"><Text style={styles.noticeTitle}>{title}</Text><Text style={styles.noticeCopy}>{copy}</Text>{action && onPress ? <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.noticeAction, pressed && ui.pressed]}><Text style={styles.noticeActionText}>{action}</Text></Pressable> : null}</View>;
}

const styles = StyleSheet.create({
  intro: { paddingHorizontal: 20, paddingBottom: 12, gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 3 },
  title: { color: palette.ink, fontSize: 26, fontWeight: '800', letterSpacing: -0.6 },
  subtitle: { color: palette.muted, fontSize: 12, marginTop: 3 },
  locationButton: { minHeight: 45, minWidth: 82, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 12, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.paper },
  locationMark: { fontSize: 23, color: palette.ink },
  locationText: { fontSize: 12, color: palette.ink, fontWeight: '700' },
  filters: { flexDirection: 'row', gap: 7 },
  filter: { flex: 1, minHeight: 34, borderWidth: 1, borderColor: palette.line, borderRadius: 11, backgroundColor: palette.paper, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, paddingVertical: 7 },
  activeFilter: { backgroundColor: palette.ink, borderColor: palette.ink },
  filterText: { color: palette.muted, fontSize: 12, fontWeight: '600' },
  activeFilterText: { color: palette.lime },
  disabled: { opacity: 0.45 },
  mapContainer: { flex: 1, minHeight: 200, backgroundColor: palette.soft, borderTopWidth: 1, borderBottomWidth: 1, borderColor: palette.line },
  map: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  searchPosition: { position: 'absolute', top: 13, left: 16, right: 16, alignItems: 'center' },
  searchButton: { minHeight: 45, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 18, paddingVertical: 9, borderRadius: 24, backgroundColor: palette.lime, borderWidth: 1, borderColor: '#B5D64F', shadowColor: '#233024', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.13, shadowRadius: 5, elevation: 4 },
  searchMark: { fontSize: 25, color: palette.ink, lineHeight: 27 },
  searchText: { color: palette.ink, fontSize: 14, fontWeight: '800' },
  noticePosition: { position: 'absolute', top: 71, left: 15, right: 15, gap: 8 },
  notice: { padding: 14, gap: 6, borderRadius: 15, backgroundColor: palette.paper, borderWidth: 1, borderColor: palette.line, elevation: 2 },
  noticeTitle: { color: palette.ink, fontSize: 15, fontWeight: '700' },
  noticeCopy: { color: palette.muted, fontSize: 13, lineHeight: 19 },
  noticeAction: { minHeight: 36, justifyContent: 'center', alignSelf: 'flex-start' },
  noticeActionText: { color: palette.ink, fontSize: 13, fontWeight: '800', textDecorationLine: 'underline' },
  locationNotice: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: palette.cream, borderRadius: 13, borderWidth: 1, borderColor: palette.line, padding: 12 },
  locationCopy: { flex: 1, color: palette.muted, fontSize: 12, lineHeight: 18 },
  dismiss: { color: palette.ink, fontSize: 22 },
  details: { maxHeight: 200, flexShrink: 1, backgroundColor: palette.paper, borderTopWidth: 1, borderColor: palette.line },
  detailsContent: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 13, gap: 9 },
  detailHeading: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  stationName: { color: palette.ink, fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  stationAddress: { color: palette.muted, fontSize: 13, lineHeight: 19, marginTop: 4 },
  closeButton: { minWidth: 38, minHeight: 38, justifyContent: 'center', alignItems: 'center', backgroundColor: palette.soft, borderRadius: 12 },
  closeMark: { color: palette.ink, fontSize: 25 },
  stationMeta: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  power: { color: palette.ink, backgroundColor: palette.lime, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8, fontSize: 13, fontWeight: '800' },
  network: { color: palette.muted, fontSize: 12 },
  connectors: { color: palette.muted, fontSize: 12, lineHeight: 19 },
  fault: { color: palette.errorInk, backgroundColor: palette.error, padding: 9, borderRadius: 8, fontSize: 12, lineHeight: 18 },
  stationSource: { minHeight: 35, justifyContent: 'center', alignSelf: 'flex-start' },
  stationSourceText: { fontSize: 13, fontWeight: '800', color: palette.ink, textDecorationLine: 'underline' },
  noAvailability: { color: palette.muted, fontSize: 11, lineHeight: 16 },
  footer: { paddingHorizontal: 20, paddingVertical: 9, gap: 3, backgroundColor: palette.cream },
  attributionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  attribution: { fontSize: 12, fontWeight: '700', color: palette.ink, textDecorationLine: 'underline', paddingVertical: 3 },
  resultCount: { color: palette.muted, fontSize: 11 },
  footerCopy: { color: palette.muted, fontSize: 10, lineHeight: 15 },
  linkError: { color: palette.errorInk, fontSize: 12, lineHeight: 17 },
});
