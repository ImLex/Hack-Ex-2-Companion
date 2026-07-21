// Bridge to the game capture natives. Android uses the GameReader
// AccessibilityService; iOS uses a ReplayKit broadcast extension that OCRs the
// screen into the same snapshot queue. The native modules only exist in
// installed builds; elsewhere everything no-ops and the `available` flags are
// false.

import { NativeModules, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

type GameReaderNative = {
  isServiceEnabled(): Promise<boolean>;
  openAccessibilitySettings(): void;
  openAppSettings(): void;
  canDrawOverlays(): Promise<boolean>;
  openOverlaySettings(): void;
  isAutoOpenEnabled(): Promise<boolean>;
  setAutoOpenEnabled(enabled: boolean): void;
};

const native: GameReaderNative | undefined =
  Platform.OS === 'android' ? NativeModules.GameReader : undefined;

export const gameReaderAvailable = !!native;

/** Emitted by GameReaderService after every snapshot it writes. */
export const SNAPSHOT_EVENT = 'trakker3.snapshot';

export async function isReaderEnabled(): Promise<boolean> {
  if (!native) return false;
  return native.isServiceEnabled();
}

export function openAccessibilitySettings(): void {
  native?.openAccessibilitySettings();
}

export function openAppSettings(): void {
  native?.openAppSettings();
}

export async function canDrawOverlays(): Promise<boolean> {
  if (!native) return false;
  return native.canDrawOverlays();
}

export function openOverlaySettings(): void {
  native?.openOverlaySettings();
}

export async function isAutoOpenEnabled(): Promise<boolean> {
  if (!native) return false;
  return native.isAutoOpenEnabled();
}

export function setAutoOpenEnabled(enabled: boolean): void {
  native?.setAutoOpenEnabled(enabled);
}

// ---- iOS broadcast capture ----

type HX2GameReaderNative = {
  getQueueDirectoryUri(): string | null;
  lastFrameAt(): number;
  setCompanionForeground(active: boolean): void;
  launchBroadcastPicker(): Promise<void>;
};

const iosNative =
  Platform.OS === 'ios'
    ? requireOptionalNativeModule<HX2GameReaderNative>('HX2GameReader')
    : null;

export const iosCaptureAvailable = !!iosNative;

/** file:// URL of the app-group queue the broadcast extension writes into. */
export function getIosQueueDirectoryUri(): string | null {
  return iosNative?.getQueueDirectoryUri() ?? null;
}

/** True while a screen broadcast is delivering frames to the extension. */
export function isBroadcastActive(): boolean {
  const lastFrame = iosNative?.lastFrameAt() ?? 0;
  return Date.now() / 1000 - lastFrame < 6;
}

/**
 * Heartbeat while the companion is on screen; the extension pauses OCR so the
 * companion's own UI is never imported into the database.
 */
export function setCompanionForeground(active: boolean): void {
  iosNative?.setCompanionForeground(active);
}

/** Opens the system broadcast picker, preselecting the HE2 Game Capture extension. */
export function launchBroadcastPicker(): Promise<void> {
  return iosNative?.launchBroadcastPicker() ?? Promise.resolve();
}
