import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { ActionButton, AppFrame, ui } from '@/components/bayready-ui';
import { palette } from '@/constants/bayready';
import { classifyMapUrl, GOINGELECTRIC_MAP_URL, isMainDocumentFailure } from '@/lib/goingelectric-map';

export default function MapScreen() {
  // WebView 14's declaration defaults its extra-props generic to undefined.
  // An explicit object preserves the actual platform prop types under strict TS.
  const webView = useRef<WebView<object>>(null);
  const currentDocument = useRef(GOINGELECTRIC_MAP_URL);
  const backAvailable = useRef(false);
  const [source, setSource] = useState({ uri: GOINGELECTRIC_MAP_URL });
  const [instance, setInstance] = useState(0);
  const [canGoBack, setCanGoBack] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  const openBrowser = useCallback(async (url: string) => {
    if (classifyMapUrl(url) === 'blocked' || url === 'about:blank') return;
    setLinkError(null);
    try {
      await Linking.openURL(url);
    } catch {
      setLinkError('The browser could not open this link. Please try again.');
    }
  }, []);

  const reloadMap = useCallback(() => {
    currentDocument.current = GOINGELECTRIC_MAP_URL;
    backAvailable.current = false;
    setCanGoBack(false);
    setError(null);
    setLinkError(null);
    setProgress(0);
    setSource({ uri: GOINGELECTRIC_MAP_URL });
    setInstance(value => value + 1);
  }, []);

  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!error && backAvailable.current && webView.current) {
        webView.current.goBack();
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [error]));

  return (
    <AppFrame mode="directory">
      <View style={styles.intro}>
        <View style={styles.titleRow}>
          <View style={ui.flex}>
            <Text accessibilityRole="header" style={styles.title}>Find a charger</Text>
            <Text style={styles.source}>GoingElectric.de · official map</Text>
          </View>
          {progress < 1 && !error ? <ActivityIndicator color={palette.ink} accessibilityLabel="Loading GoingElectric map" /> : null}
        </View>
        <View style={styles.tools}>
          <MapTool label="← Back" disabled={!canGoBack || !!error} onPress={() => webView.current?.goBack()} />
          <MapTool label="↻ Reload" onPress={reloadMap} />
          <MapTool label="Browser ↗" onPress={() => void openBrowser(currentDocument.current)} />
        </View>
      </View>

      {linkError ? <Text style={styles.linkError} accessibilityLiveRegion="polite">{linkError}</Text> : null}

      <View style={styles.mapContainer}>
        <WebView<object>
          key={instance}
          ref={webView}
          source={source}
          style={styles.webView}
          containerStyle={styles.webView}
          // Request the original website. No scraping, content injection, or API proxy.
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          geolocationEnabled
          mixedContentMode="never"
          allowFileAccess={false}
          allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false}
          setBuiltInZoomControls
          setDisplayZoomControls={false}
          allowsBackForwardNavigationGestures
          onShouldStartLoadWithRequest={request => {
            const decision = classifyMapUrl(request.url);
            // Embedded frames belong to the website; external top-level links use the browser.
            if (request.isTopFrame === false) return decision !== 'blocked';
            if (decision === 'external') void openBrowser(request.url);
            return decision === 'internal';
          }}
          onOpenWindow={({ nativeEvent }) => {
            const decision = classifyMapUrl(nativeEvent.targetUrl);
            if (decision === 'internal' && nativeEvent.targetUrl !== 'about:blank') {
              currentDocument.current = nativeEvent.targetUrl;
              setError(null);
              setSource({ uri: nativeEvent.targetUrl });
            } else if (decision === 'external') {
              void openBrowser(nativeEvent.targetUrl);
            }
          }}
          onNavigationStateChange={navigation => {
            backAvailable.current = navigation.canGoBack;
            setCanGoBack(navigation.canGoBack);
            if (classifyMapUrl(navigation.url) === 'internal' && navigation.url !== 'about:blank') {
              currentDocument.current = navigation.url;
            }
          }}
          onLoadStart={({ nativeEvent }) => {
            if (classifyMapUrl(nativeEvent.url) === 'internal' && nativeEvent.url !== 'about:blank') {
              currentDocument.current = nativeEvent.url;
            }
            setError(null);
            setProgress(0.02);
          }}
          onLoadProgress={({ nativeEvent }) => setProgress(nativeEvent.progress)}
          onLoadEnd={() => setProgress(1)}
          onError={({ nativeEvent }) => {
            // iOS may report cancelled navigations when a link is intentionally handled elsewhere.
            if (nativeEvent.code === -999) return;
            setError('GoingElectric could not load. Check your internet connection and try again.');
          }}
          onHttpError={({ nativeEvent }) => {
            if (isMainDocumentFailure(nativeEvent.url, currentDocument.current)) {
              setError(`GoingElectric returned HTTP ${nativeEvent.statusCode}. Try reloading or open the map in your browser.`);
            }
          }}
          onRenderProcessGone={() => setError('The map was closed by Android. Reload it to continue.')}
          onContentProcessDidTerminate={() => setError('The map was closed. Reload it to continue.')}
          renderError={() => <View style={styles.webView} />}
        />
        {progress < 1 && !error ? <View style={styles.progressTrack} pointerEvents="none"><View style={[styles.progressFill, { width: `${Math.max(0.03, progress) * 100}%` }]} /></View> : null}
        {error ? (
          <View style={styles.failure} accessibilityLiveRegion="polite">
            <Text style={styles.failureMark}>↗</Text>
            <Text style={styles.failureTitle}>The map is unavailable</Text>
            <Text style={styles.failureCopy}>{error}</Text>
            <ActionButton label="Try again" onPress={reloadMap} />
            <ActionButton label="Open GoingElectric in browser" variant="secondary" onPress={() => void openBrowser(GOINGELECTRIC_MAP_URL)} />
          </View>
        ) : null}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Public directory by GoingElectric. Reservations currently cover the demo bay only.</Text>
      </View>
    </AppFrame>
  );
}

function MapTool({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.tool, disabled && styles.disabled, pressed && ui.pressed]}>
      <Text style={styles.toolText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  intro: { paddingHorizontal: 20, paddingBottom: 12, gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { color: palette.ink, fontSize: 26, fontWeight: '800', letterSpacing: -0.6 },
  source: { color: palette.muted, fontSize: 13, marginTop: 3 },
  tools: { flexDirection: 'row', gap: 8 },
  tool: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.paper, borderWidth: 1, borderColor: palette.line, borderRadius: 11, paddingHorizontal: 7 },
  toolText: { color: palette.ink, fontSize: 14, fontWeight: '700' },
  disabled: { opacity: 0.35 },
  mapContainer: { flex: 1, backgroundColor: palette.paper, borderTopWidth: 1, borderBottomWidth: 1, borderColor: palette.line },
  webView: { flex: 1, backgroundColor: palette.paper },
  progressTrack: { position: 'absolute', top: 0, left: 0, right: 0, height: 3, backgroundColor: palette.soft },
  progressFill: { height: 3, backgroundColor: '#759033' },
  failure: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, justifyContent: 'center', padding: 24, gap: 14, backgroundColor: palette.cream },
  failureMark: { fontSize: 44, color: '#759033', textAlign: 'center' },
  failureTitle: { color: palette.ink, fontSize: 23, fontWeight: '800', textAlign: 'center' },
  failureCopy: { color: palette.muted, fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: 6 },
  footer: { paddingHorizontal: 20, paddingVertical: 10 },
  footerText: { color: palette.muted, fontSize: 12, lineHeight: 17 },
  linkError: { color: palette.errorInk, paddingHorizontal: 20, paddingBottom: 10, fontSize: 14, lineHeight: 20 },
});
