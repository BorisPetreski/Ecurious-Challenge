import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionButton, ui } from '@/components/bayready-ui';
import { palette } from '@/constants/bayready';
import type { AudimaxLock } from '@/lib/audimax-lock-api';
import type { DirectoryStation } from '@/lib/goingelectric-api';
import {
  formatDistance,
  getTopClosestFreeChargingSpots,
  MUNICH_MOCK_EVENTS,
  type EventChargingSpot,
  type MunichEvent,
} from '@/lib/munich-events';

export interface MunichEventsModalProps {
  visible: boolean;
  selectedEvent: MunichEvent | null;
  audimaxLocks: AudimaxLock[];
  directoryStations?: DirectoryStation[];
  directoryCounts?: Record<number, { unreserved: number | null; total: number }>;
  onSelectEvent: (event: MunichEvent) => void;
  onSelectSpot: (spot: EventChargingSpot, event: MunichEvent) => void;
  onClose: () => void;
}

export function MunichEventsModal({
  visible,
  selectedEvent,
  audimaxLocks,
  directoryStations,
  directoryCounts,
  onSelectEvent,
  onSelectSpot,
  onClose,
}: MunichEventsModalProps) {
  const [currentEvent, setCurrentEvent] = useState<MunichEvent>(
    () => selectedEvent ?? MUNICH_MOCK_EVENTS[0]
  );

  const closestSpots = getTopClosestFreeChargingSpots(currentEvent, {
    audimaxLocks,
    directoryStations,
    directoryCounts,
  });

  const handleChooseEvent = (event: MunichEvent) => {
    setCurrentEvent(event);
    onSelectEvent(event);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView style={styles.modal}>
        {/* Header */}
        <View style={styles.modalHeader}>
          <View style={ui.flex}>
            <Text style={ui.eyebrow}>MUNICH EVENT EV ROUTING</Text>
            <Text style={styles.modalTitle}>Events & Nearest Free Chargers</Text>
            <Text style={ui.small}>
              Pick an event in Munich to discover the top 5 closest available charging bays.
            </Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close modal" onPress={onClose} style={styles.close}>
            <Text style={styles.closeText}>×</Text>
          </Pressable>
        </View>

        <ScrollView style={ui.flex} contentContainerStyle={styles.content} showsVerticalScrollIndicator>
          {/* Horizontal Event Chips / Quick Selector */}
          <View style={styles.section}>
            <Text style={ui.label}>Select Munich Event</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.eventRow}>
              {MUNICH_MOCK_EVENTS.map(event => {
                const isSelected = event.id === currentEvent.id;
                return (
                  <Pressable
                    key={event.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => handleChooseEvent(event)}
                    style={({ pressed }) => [
                      styles.eventChip,
                      isSelected && styles.eventChipSelected,
                      pressed && ui.pressed,
                    ]}>
                    <Text style={styles.eventEmoji}>{event.emoji}</Text>
                    <View>
                      <Text style={[styles.eventChipTitle, isSelected && styles.eventChipTitleSelected]} numberOfLines={1}>
                        {event.title}
                      </Text>
                      <Text style={[styles.eventChipVenue, isSelected && { color: '#E8F5E9' }]} numberOfLines={1}>
                        {event.venue}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          {/* Active Event Banner Card */}
          <View style={styles.activeEventCard}>
            <View style={styles.activeEventHeader}>
              <Text style={styles.bigEmoji}>{currentEvent.emoji}</Text>
              <View style={ui.flex}>
                <View style={styles.badgeRow}>
                  <View style={[styles.badge, categoryBadgeStyle(currentEvent.category)]}>
                    <Text style={styles.badgeText}>{currentEvent.category.toUpperCase()}</Text>
                  </View>
                  <Text style={ui.small}>{currentEvent.date}</Text>
                </View>
                <Text style={styles.activeEventTitle}>{currentEvent.title}</Text>
                <Text style={styles.activeEventVenue}>{currentEvent.venue} · {currentEvent.address}</Text>
                <Text style={[ui.small, { color: palette.muted, marginTop: 2 }]}>
                  Expected crowd: {currentEvent.expectedAttendance}
                </Text>
              </View>
            </View>
          </View>

          {/* Top 5 Closest Free Spots Section */}
          <View style={styles.section}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={ui.label}>⚡ TOP 5 CLOSEST FREE CHARGING SPOTS</Text>
              <Text style={[ui.small, { color: '#2E7D32', fontWeight: '700' }]}>Sorted by Distance</Text>
            </View>

            <View style={styles.spotsList}>
              {closestSpots.map((spot, index) => {
                const rank = index + 1;
                return (
                  <Pressable
                    key={spot.id}
                    accessibilityRole="button"
                    onPress={() => onSelectSpot(spot, currentEvent)}
                    style={({ pressed }) => [
                      styles.spotCard,
                      spot.isAudimaxHardware && styles.audimaxCard,
                      pressed && ui.pressed,
                    ]}>
                    <View style={styles.rankPill}>
                      <Text style={styles.rankText}>#{rank}</Text>
                    </View>

                    <View style={ui.flex}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <Text style={styles.spotName}>{spot.name}</Text>
                        {spot.isAudimaxHardware ? (
                          <View style={styles.liveBadge}>
                            <Text style={styles.liveBadgeText}>★ LIVE BARRIER</Text>
                          </View>
                        ) : null}
                      </View>

                      <Text style={styles.spotAddress}>{spot.address}</Text>

                      <View style={styles.spotMetaRow}>
                        <View style={styles.distanceBadge}>
                          <Text style={styles.distanceText}>📍 {formatDistance(spot.distanceMeters)} away</Text>
                        </View>
                        <View style={styles.powerBadge}>
                          <Text style={styles.powerText}>⚡ {spot.maxPowerKw} kW</Text>
                        </View>
                        <View style={styles.freeBadge}>
                          <Text style={styles.freeText}>✓ {spot.freePlugs} / {spot.totalPlugs} free</Text>
                        </View>
                      </View>

                      <Text style={[ui.small, { color: palette.muted, marginTop: 4 }]}>
                        {spot.connectorTypes.join(' · ')} {spot.network ? `· ${spot.network}` : ''}
                      </Text>
                    </View>

                    <View style={styles.actionArrowContainer}>
                      <Text style={styles.actionArrow}>›</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <ActionButton
            label={`Navigate to #1 closest spot (${formatDistance(closestSpots[0]?.distanceMeters ?? 0)})`}
            variant="primary"
            onPress={() => {
              if (closestSpots[0]) {
                onSelectSpot(closestSpots[0], currentEvent);
              }
            }}
          />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function categoryBadgeStyle(category: string) {
  switch (category) {
    case 'tech':
      return { backgroundColor: '#EDE7F6', borderColor: '#7E57C2' };
    case 'sports':
      return { backgroundColor: '#E8F5E9', borderColor: '#4CAF50' };
    case 'culture':
      return { backgroundColor: '#FFF3E0', borderColor: '#FF9800' };
    case 'concert':
      return { backgroundColor: '#FCE4EC', borderColor: '#EC407A' };
    default:
      return { backgroundColor: palette.soft, borderColor: palette.line };
  }
}

const styles = StyleSheet.create({
  modal: { flex: 1, backgroundColor: palette.paper },
  modalHeader: {
    padding: 20,
    flexDirection: 'row',
    gap: 12,
    borderBottomWidth: 1,
    borderColor: palette.line,
  },
  modalTitle: { color: palette.ink, fontSize: 22, fontWeight: '800', marginVertical: 4 },
  close: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: palette.soft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { color: palette.ink, fontSize: 27 },
  content: { padding: 20, gap: 16 },
  section: { gap: 8 },
  eventRow: { gap: 8, paddingVertical: 4 },
  eventChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: palette.soft,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.line,
    maxWidth: 240,
  },
  eventChipSelected: {
    backgroundColor: '#1B3B2B',
    borderColor: '#2E7D32',
  },
  eventEmoji: { fontSize: 20 },
  eventChipTitle: { color: palette.ink, fontSize: 13, fontWeight: '700' },
  eventChipTitleSelected: { color: '#FFFFFF' },
  eventChipVenue: { color: palette.muted, fontSize: 11 },
  activeEventCard: {
    backgroundColor: '#F7F9F4',
    borderWidth: 1,
    borderColor: '#D4E2BA',
    borderRadius: 14,
    padding: 14,
  },
  activeEventHeader: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  bigEmoji: { fontSize: 36 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  badge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: { fontSize: 9, fontWeight: '800', color: palette.ink },
  activeEventTitle: { color: palette.ink, fontSize: 16, fontWeight: '800' },
  activeEventVenue: { color: palette.ink, fontSize: 12, fontWeight: '600', marginTop: 2 },
  spotsList: { gap: 10 },
  spotCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: palette.soft,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.line,
    padding: 12,
  },
  audimaxCard: {
    backgroundColor: '#F3E5F5',
    borderColor: '#BA68C8',
  },
  rankPill: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#1B3B2B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  spotName: { color: palette.ink, fontSize: 14, fontWeight: '800', flexShrink: 1 },
  liveBadge: {
    backgroundColor: '#9C27B0',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  liveBadgeText: { color: '#FFFFFF', fontSize: 9, fontWeight: '800' },
  spotAddress: { color: palette.muted, fontSize: 12, marginTop: 2 },
  spotMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' },
  distanceBadge: {
    backgroundColor: '#E8F5E9',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  distanceText: { color: '#2E7D32', fontSize: 11, fontWeight: '700' },
  powerBadge: {
    backgroundColor: '#FFF8E1',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  powerText: { color: '#F57F17', fontSize: 11, fontWeight: '700' },
  freeBadge: {
    backgroundColor: '#E0F2F1',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  freeText: { color: '#00695C', fontSize: 11, fontWeight: '700' },
  actionArrowContainer: { paddingLeft: 6 },
  actionArrow: { fontSize: 20, color: palette.muted, fontWeight: '700' },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.paper,
  },
});
