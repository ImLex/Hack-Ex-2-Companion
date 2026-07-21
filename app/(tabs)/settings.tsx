import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Platform, Pressable, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSQLiteContext } from 'expo-sqlite';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { createBackup, exportTargetsCsv, restoreBackup, serialiseBackup } from '@/db/repo/backup';
import { eraseAllData } from '@/db/database';
import { recalculateAllScores } from '@/db/repo/targets';
import { getUserProfile, setUserProfile } from '@/db/repo/settings';
import { getOwnDevice, getOwnSoftware } from '@/db/repo/ownDevice';
import {
  DEFAULT_THRESHOLD_MINUTES,
  formatDurationMs,
  getProxyNotifyPrefs,
  proxyExpiresAt,
  requestNotificationPermission,
  setProxyNotifyPrefs,
  syncProxyNotification,
} from '@/logic/proxyNotification';
import { clearResolvedReviews } from '@/db/repo/reviews';
import { getDashboardStats } from '@/db/repo/stats';
import { useQuery } from '@/db/useQuery';
import { DEVICES } from '@/logic/devices';
import {
  canDrawOverlays,
  gameReaderAvailable,
  iosCaptureAvailable,
  isAutoOpenEnabled,
  isBroadcastActive,
  isReaderEnabled,
  launchBroadcastPicker,
  openAccessibilitySettings,
  openAppSettings,
  openOverlaySettings,
  setAutoOpenEnabled,
} from '@/native/gameReader';
import { useAccounts } from '@/components/AccountProvider';
import { useTheme } from '@/components/ThemeProvider';
import { Button, Card, Chip, Divider, Input, Row, Screen, Section, Select, Txt } from '@/ui/components';
import { deriveAccent, THEME_OPTIONS } from '@/ui/palette';
import { colors, spacing } from '@/ui/theme';
import { formatDateTime, formatExact, plural, timeAgo } from '@/ui/format';

export default function SettingsScreen() {
  const db = useSQLiteContext();
  const { themeName, setTheme } = useTheme();
  const { accounts, activeAccount, switchAccount } = useAccounts();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const { data: stats, refresh } = useQuery((database) => getDashboardStats(database));
  const { data: profile, refresh: refreshProfile } = useQuery((database) =>
    getUserProfile(database),
  );

  const [level, setLevel] = useState('');
  const [device, setDevice] = useState('');
  const [themesOpen, setThemesOpen] = useState(false);

  const { data: ownDevice } = useQuery((database) => getOwnDevice(database));
  const { data: ownSoftware } = useQuery((database) => getOwnSoftware(database));
  const [ipRevealed, setIpRevealed] = useState(false);

  const { data: notifyPrefs, refresh: refreshNotifyPrefs } = useQuery((database) =>
    getProxyNotifyPrefs(database),
  );
  const [notifyEnabled, setNotifyEnabled] = useState(false);
  const [notifyHours, setNotifyHours] = useState('');
  const [notifyMinutes, setNotifyMinutes] = useState('');
  const notifySeeded = useRef(false);
  useEffect(() => {
    if (!notifyPrefs || notifySeeded.current) return;
    notifySeeded.current = true;
    setNotifyEnabled(notifyPrefs.enabled);
    setNotifyHours(String(Math.floor(notifyPrefs.thresholdMinutes / 60)));
    setNotifyMinutes(String(notifyPrefs.thresholdMinutes % 60));
  }, [notifyPrefs]);

  const thresholdMinutes = (Number(notifyHours) || 0) * 60 + (Number(notifyMinutes) || 0);
  const notifyChanged = notifyPrefs
    ? notifyEnabled !== notifyPrefs.enabled ||
      (notifyEnabled && thresholdMinutes > 0 && thresholdMinutes !== notifyPrefs.thresholdMinutes)
    : false;
  const proxyExpiry = proxyExpiresAt(ownDevice ?? null);

  const handleToggleNotify = async (value: boolean) => {
    if (value) {
      const granted = await requestNotificationPermission();
      if (!granted) {
        Alert.alert(
          'Notifications not allowed',
          'Android blocked the permission. Allow notifications for Hack EX 2 Companion in the system settings, then try again.',
        );
        return;
      }
    }
    setNotifyEnabled(value);
  };

  const handleSaveNotify = async () => {
    setBusy('notify');
    try {
      const minutes = thresholdMinutes > 0 ? thresholdMinutes : DEFAULT_THRESHOLD_MINUTES;
      await setProxyNotifyPrefs(db, { enabled: notifyEnabled, thresholdMinutes: minutes });
      await syncProxyNotification(db);
      refreshNotifyPrefs();
      if (notifyEnabled) {
        Alert.alert(
          'Saved',
          proxyExpiry !== null
            ? `Your proxy runs out around ${formatDateTime(proxyExpiry)}. ` +
                `You will be warned ${formatDurationMs(minutes * 60_000)} before that.`
            : `You will be warned ${formatDurationMs(minutes * 60_000)} before the proxy runs ` +
                `out, as soon as a proxy timer has been captured from the game.`,
        );
      }
    } catch (error) {
      Alert.alert('Could not save', String(error));
    } finally {
      setBusy(null);
    }
  };

  const [autoOpen, setAutoOpen] = useState(false);
  useEffect(() => {
    if (gameReaderAvailable) isAutoOpenEnabled().then(setAutoOpen).catch(() => {});
  }, []);

  const handleToggleAutoOpen = async (value: boolean) => {
    setAutoOpen(value);
    setAutoOpenEnabled(value);
    // Without the overlay permission Android is allowed to silently drop the
    // background start on many devices.
    if (value && !(await canDrawOverlays())) {
      Alert.alert(
        'One more permission',
        'Android only lets an app start itself from the background reliably when ' +
          '"Display over other apps" is allowed for it. Without it this switch may do nothing.',
        [
          { text: 'Later', style: 'cancel' },
          { text: 'Open settings', onPress: openOverlaySettings },
        ],
      );
    }
  };

  // Re-check on foreground: enabling the reader means leaving for Android's
  // Accessibility settings and coming back.
  const [readerOn, setReaderOn] = useState(false);
  useEffect(() => {
    if (!gameReaderAvailable) return;
    const check = () => {
      isReaderEnabled().then(setReaderOn).catch(() => {});
    };
    check();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => sub.remove();
  }, []);

  // iOS: the broadcast keeps a heartbeat in the shared container; poll it so
  // the status row flips green while a capture is running.
  const [broadcastOn, setBroadcastOn] = useState(false);
  useEffect(() => {
    if (!iosCaptureAvailable) return;
    const check = () => setBroadcastOn(isBroadcastActive());
    check();
    const timer = setInterval(check, 3000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, []);

  // Seed the form once: useQuery refetches on focus and would otherwise
  // overwrite an edit mid-typing.
  const seeded = useRef(false);
  useEffect(() => {
    if (!profile || seeded.current) return;
    seeded.current = true;
    setLevel(profile.level > 0 ? String(profile.level) : '');
    setDevice(profile.device ?? '');
  }, [profile]);

  const profileChanged =
    (Number(level) || 0) !== (profile?.level ?? 0) ||
    (device.trim() || null) !== (profile?.device ?? null);

  const handleSaveProfile = async () => {
    setBusy('profile');
    try {
      await setUserProfile(db, {
        level: Number(level) || 0,
        device: device.trim() || null,
      });
      // Recommendations are relative to the user's level, so rescore everything.
      const count = await recalculateAllScores(db);
      refreshProfile();
      refresh();
      Alert.alert('Saved', `${plural(count, 'target')} rescored against your level.`);
    } catch (error) {
      Alert.alert('Could not save', String(error));
    } finally {
      setBusy(null);
    }
  };

  const shareFile = async (filename: string, contents: string, mimeType: string) => {
    const directory = FileSystem.Paths.cache;
    const file = new FileSystem.File(directory, filename);
    if (file.exists) file.delete();
    file.create();
    file.write(contents);

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: filename });
    } else {
      Alert.alert('Saved', `Written to ${file.uri}`);
    }
  };

  const handleBackup = async () => {
    setBusy('backup');
    try {
      const backup = await createBackup(db);
      const stamp = new Date().toISOString().slice(0, 10);
      await shareFile(
        `hackex2-backup-${stamp}.json`,
        serialiseBackup(backup),
        'application/json',
      );
    } catch (error) {
      Alert.alert('Backup failed', String(error));
    } finally {
      setBusy(null);
    }
  };

  const handleExportCsv = async () => {
    setBusy('csv');
    try {
      const csv = await exportTargetsCsv(db);
      const stamp = new Date().toISOString().slice(0, 10);
      await shareFile(`hackex2-targets-${stamp}.csv`, csv, 'text/csv');
    } catch (error) {
      Alert.alert('Export failed', String(error));
    } finally {
      setBusy(null);
    }
  };

  const handleRestore = async () => {
    const picked = await DocumentPicker.getDocumentAsync({
      type: ['application/json', '*/*'],
      copyToCacheDirectory: true,
    });
    if (picked.canceled || picked.assets.length === 0) return;

    Alert.alert(
      'Replace everything?',
      'Restoring a backup deletes all current data and replaces it with the contents of the file. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore',
          style: 'destructive',
          onPress: async () => {
            setBusy('restore');
            try {
              const file = new FileSystem.File(picked.assets[0].uri);
              const contents = await file.text();
              const result = await restoreBackup(db, contents);

              if (result.ok) {
                const total = Object.values(result.restored).reduce((a, b) => a + b, 0);
                Alert.alert('Restored', `${formatExact(total)} rows restored.`);
                refresh();
              } else {
                Alert.alert('Restore failed', result.error ?? 'Unknown problem.');
              }
            } catch (error) {
              Alert.alert('Restore failed', String(error));
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    );
  };

  const handleRecalculate = async () => {
    setBusy('scores');
    try {
      const count = await recalculateAllScores(db);
      Alert.alert('Done', `${plural(count, 'target')} rescored.`);
      refresh();
    } finally {
      setBusy(null);
    }
  };

  const handleClearReviews = async () => {
    setBusy('reviews');
    try {
      const count = await clearResolvedReviews(db);
      Alert.alert('Tidied', `${plural(count, 'closed review')} removed.`);
      refresh();
    } finally {
      setBusy(null);
    }
  };

  const handleErase = () => {
    Alert.alert(
      'Erase everything?',
      'This deletes every target, log, wallet, IP and crypto record on this phone. Take a backup first if you are not certain.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Erase all data',
          style: 'destructive',
          onPress: async () => {
            setBusy('erase');
            try {
              await eraseAllData(db);
              Alert.alert('Erased', 'Hack EX 2 Companion is empty again.');
              refresh();
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    );
  };

  return (
    <Screen>
      <Section
        title="Game reader"
        subtitle="Reads Hack EX 2's screen while you play and fills this database automatically. No more copy-pasting logs."
      >
        <Card>
          {Platform.OS === 'ios' && iosCaptureAvailable ? (
            <>
              <Row gap={spacing.md} style={{ marginBottom: spacing.md }}>
                <Ionicons
                  name={broadcastOn ? 'checkmark-circle' : 'alert-circle'}
                  size={22}
                  color={broadcastOn ? colors.success : colors.warning}
                />
                <Txt variant="bodyStrong" style={{ flex: 1 }}>
                  {broadcastOn
                    ? 'Recording — reading the screen while you play.'
                    : 'Not recording right now.'}
                </Txt>
              </Row>
              <Txt variant="caption" color={colors.textMuted} style={{ marginBottom: spacing.md }}>
                Tap the button, pick "HE2 Game Capture" and press Start Broadcast. Then switch to
                Hack EX 2 and play normally — the screen is read on this phone only, nothing is
                uploaded anywhere, and recording pauses by itself whenever the companion is on
                screen. Stop it from the red status pill at the top of the screen or from Control
                Center.
              </Txt>
              <Button
                label={broadcastOn ? 'Stop screen capture' : 'Start screen capture'}
                onPress={() => launchBroadcastPicker()}
              />
            </>
          ) : !gameReaderAvailable ? (
            <Row gap={spacing.md}>
              <Ionicons name="information-circle" size={22} color={colors.textMuted} />
              <Txt variant="caption" color={colors.textMuted} style={{ flex: 1 }}>
                The reader only exists in the installed app. It is not available in Expo Go or in a
                web browser.
              </Txt>
            </Row>
          ) : (
            <>
              <Row gap={spacing.md} style={{ marginBottom: spacing.md }}>
                <Ionicons
                  name={readerOn ? 'checkmark-circle' : 'alert-circle'}
                  size={22}
                  color={readerOn ? colors.success : colors.warning}
                />
                <Txt variant="bodyStrong" style={{ flex: 1 }}>
                  {readerOn
                    ? 'On — reading Hack EX 2 whenever the game is open.'
                    : 'Not enabled yet.'}
                </Txt>
              </Row>
              {!readerOn ? (
                <>
                  <Txt
                    variant="caption"
                    color={colors.textMuted}
                    style={{ marginBottom: spacing.md }}
                  >
                    Because the companion is installed outside the Play Store, Android may lock the
                    accessibility toggle behind "Restricted settings". Step 1 opens the companion's
                    own settings page — tap the ⋮ menu in the top corner and choose "Allow
                    restricted settings". Then step 2: find "Hack EX 2 Game Reader" in the
                    Accessibility settings, switch it on and confirm the warning — that warning is
                    Android's standard text for anything that reads the screen. The reader only
                    looks at Hack EX 2; nothing it reads ever leaves this phone. Come back here:
                    this row turns green when it worked.
                  </Txt>
                  <Button
                    label="Step 1: Open app settings"
                    variant="secondary"
                    onPress={openAppSettings}
                    style={{ marginBottom: spacing.sm }}
                  />
                  <Button
                    label="Step 2: Open Accessibility settings"
                    onPress={openAccessibilitySettings}
                  />
                </>
              ) : (
                <>
                  <Txt
                    variant="caption"
                    color={colors.textFaint}
                    style={{ marginBottom: spacing.md }}
                  >
                    Open the game and play normally. Wallet values, logs, processes and any target
                    device you connect to are recorded as you see them.
                  </Txt>
                  <Button
                    label="Open Accessibility settings"
                    variant="secondary"
                    onPress={openAccessibilitySettings}
                  />
                </>
              )}

              <Divider />

              <Row>
                <View style={{ flex: 1 }}>
                  <Txt variant="body">Start with the game</Txt>
                  <Txt variant="caption" color={colors.textFaint} style={{ marginTop: 2 }}>
                    When Hack EX 2 opens, the companion starts itself behind it — imports and the
                    proxy warning stay fresh without opening it by hand.
                  </Txt>
                </View>
                <Switch
                  value={autoOpen}
                  onValueChange={handleToggleAutoOpen}
                  trackColor={{ true: colors.accent }}
                />
              </Row>
            </>
          )}
        </Card>
      </Section>

      <Section
        title="Game accounts"
        subtitle="Each account keeps its own separate database. The app notices whose home screen is on show in the game and switches by itself; tap one to switch by hand."
      >
        <Card>
          {accounts.map((account, index) => {
            const isActive = account.dbName === activeAccount.dbName;
            return (
              <View key={account.dbName}>
                {index > 0 ? <Divider style={{ marginVertical: spacing.sm }} /> : null}
                <Pressable
                  onPress={() => {
                    if (!isActive) switchAccount(account.dbName);
                  }}
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                >
                  <Row gap={spacing.md}>
                    <Ionicons
                      name={isActive ? 'radio-button-on' : 'radio-button-off'}
                      size={20}
                      color={isActive ? colors.accent : colors.textFaint}
                    />
                    <Txt variant="bodyStrong" style={{ flex: 1 }}>
                      {account.name ?? 'First account (name not seen yet)'}
                    </Txt>
                    {isActive ? (
                      <Txt variant="caption" color={colors.accent}>
                        ACTIVE
                      </Txt>
                    ) : null}
                  </Row>
                </Pressable>
              </View>
            );
          })}
          {accounts.length === 1 ? (
            <Txt variant="caption" color={colors.textFaint} style={{ marginTop: spacing.md }}>
              Log into another account in Hack EX 2 and open its home screen — it appears here
              automatically with a fresh, empty database.
            </Txt>
          ) : null}
        </Card>
      </Section>

      <Section
        title="Your device"
        subtitle="Read automatically from the game: your level from the home screen, hardware from Settings, software from APPS."
      >
        {ownDevice ? (
          <Card style={{ marginBottom: spacing.md }}>
            <Row>
              <Txt variant="body" style={{ flex: 1 }}>
                Device
              </Txt>
              <View style={{ alignItems: 'flex-end' }}>
                <Txt variant="bodyStrong">
                  {ownDevice.deviceName ?? '—'}
                  {ownDevice.deviceLevel !== null ? `  Lv ${ownDevice.deviceLevel}` : ''}
                </Txt>
                {ownDevice.deviceSpec ? (
                  <Txt variant="caption" color={colors.textFaint}>
                    {ownDevice.deviceSpec}
                  </Txt>
                ) : null}
              </View>
            </Row>
            <Divider style={{ marginVertical: spacing.sm }} />
            <Row>
              <Txt variant="body" style={{ flex: 1 }}>
                Network
              </Txt>
              <View style={{ alignItems: 'flex-end' }}>
                <Txt variant="bodyStrong">
                  {ownDevice.networkName ?? '—'}
                  {ownDevice.networkLevel !== null ? `  Lv ${ownDevice.networkLevel}` : ''}
                </Txt>
                {ownDevice.networkSpeed ? (
                  <Txt variant="caption" color={colors.textFaint}>
                    {ownDevice.networkSpeed}
                  </Txt>
                ) : null}
              </View>
            </Row>
            <Divider style={{ marginVertical: spacing.sm }} />
            <Row>
              <Txt variant="body" style={{ flex: 1 }}>
                My IP
              </Txt>
              <Pressable
                onPress={() => setIpRevealed((shown) => !shown)}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <Row gap={spacing.sm}>
                  <Txt variant="mono" color={ipRevealed ? colors.text : colors.textFaint}>
                    {ownDevice.ip === null ? '—' : ipRevealed ? ownDevice.ip : '···.···.···.···'}
                  </Txt>
                  {ownDevice.ip !== null ? (
                    <Ionicons
                      name={ipRevealed ? 'eye-off' : 'eye'}
                      size={18}
                      color={colors.textMuted}
                    />
                  ) : null}
                </Row>
              </Pressable>
            </Row>
            <Divider style={{ marginVertical: spacing.sm }} />
            <Row>
              <Txt variant="body" style={{ flex: 1 }}>
                Proxy
              </Txt>
              <Txt
                variant="bodyStrong"
                color={ownDevice.proxyActive ? colors.success : colors.textFaint}
              >
                {ownDevice.proxyActive
                  ? `ACTIVE${ownDevice.proxyRemaining ? ` · ${ownDevice.proxyRemaining} left` : ''}`
                  : 'Off'}
              </Txt>
            </Row>
            <Txt variant="caption" color={colors.textFaint} style={{ marginTop: spacing.sm }}>
              As of {timeAgo(ownDevice.capturedAt)}
            </Txt>
          </Card>
        ) : (
          <Card style={{ marginBottom: spacing.md }}>
            <Txt variant="caption" color={colors.textMuted}>
              Nothing captured yet. In the game, open the Settings tab (the reader takes IP, proxy,
              device and network) and the APPS tab (software levels).
            </Txt>
          </Card>
        )}

        {ownSoftware ? (
          <Card style={{ marginBottom: spacing.md }}>
            <Txt variant="label" color={colors.textFaint} style={{ marginBottom: spacing.sm }}>
              My software
            </Txt>
            <Row gap={spacing.xs} wrap>
              {ownSoftware.software.map((app) => (
                <Chip key={app.name} label={`${app.name} ${app.level}`} size="sm" />
              ))}
            </Row>
            <Txt variant="caption" color={colors.textFaint} style={{ marginTop: spacing.sm }}>
              As of {timeAgo(ownSoftware.capturedAt)}
            </Txt>
          </Card>
        ) : null}

        <Card>
          <Txt variant="caption" color={colors.textFaint} style={{ marginBottom: spacing.sm }}>
            Manual override — normally filled in by the game reader.
          </Txt>
          <Input
            label="Your level"
            value={level}
            onChangeText={(text) => setLevel(text.replace(/[^0-9]/g, ''))}
            placeholder="0"
            keyboardType="numeric"
            hint="Spamming pays when a target is 10 or more levels above you, or 9 or more below."
          />

          <Select
            label="Your device"
            value={device}
            options={DEVICES}
            onChange={setDevice}
            allowCustom
            placeholder="Something not on the list"
          />

          <Button
            label="Save"
            onPress={handleSaveProfile}
            disabled={!profileChanged}
            loading={busy === 'profile'}
          />
        </Card>
      </Section>

      <Section
        title="Appearance"
        subtitle="Pick a colour — the whole app follows, including the glow in the background. Dark picks are brightened so everything stays readable."
      >
        <Card>
          <Pressable
            onPress={() => setThemesOpen((open) => !open)}
            accessibilityRole="button"
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <Row gap={spacing.md}>
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  backgroundColor: colors.accent,
                }}
              />
              <Txt variant="bodyStrong" style={{ flex: 1 }}>
                {themeName ?? 'Default'}
              </Txt>
              <Ionicons
                name={themesOpen ? 'chevron-up' : 'chevron-down'}
                size={20}
                color={colors.textFaint}
              />
            </Row>
          </Pressable>

          {themesOpen ? (
            <Row gap={spacing.sm} wrap style={{ marginTop: spacing.md }}>
              {THEME_OPTIONS.map((option) => {
                const selected = option.name === themeName;
                return (
                  <Pressable
                    key={option.name}
                    onPress={() => setTheme(option.name)}
                    accessibilityLabel={`Theme ${option.name}`}
                    accessibilityRole="button"
                    style={({ pressed }) => ({
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      backgroundColor: deriveAccent(option.hex).accent,
                      borderWidth: 3,
                      borderColor: selected ? colors.text : 'transparent',
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    {selected ? (
                      <Ionicons name="checkmark" size={18} color={colors.accentText} />
                    ) : null}
                  </Pressable>
                );
              })}
            </Row>
          ) : null}
        </Card>
      </Section>

      <Section
        title="Notifications"
        subtitle="A warning before the proxy mask runs out, based on the timer read from the game."
      >
        <Card>
          <Row>
            <Txt variant="body" style={{ flex: 1 }}>
              Warn me before the proxy expires
            </Txt>
            <Switch
              value={notifyEnabled}
              onValueChange={handleToggleNotify}
              trackColor={{ true: colors.accent }}
            />
          </Row>

          {notifyEnabled ? (
            <>
              <Txt variant="label" color={colors.textFaint} style={{ marginTop: spacing.md }}>
                Notify when below
              </Txt>
              <Row gap={spacing.md}>
                <View style={{ flex: 1 }}>
                  <Input
                    label="Hours"
                    value={notifyHours}
                    onChangeText={(text) => setNotifyHours(text.replace(/[^0-9]/g, ''))}
                    placeholder="12"
                    keyboardType="numeric"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Input
                    label="Minutes"
                    value={notifyMinutes}
                    onChangeText={(text) => setNotifyMinutes(text.replace(/[^0-9]/g, ''))}
                    placeholder="0"
                    keyboardType="numeric"
                  />
                </View>
              </Row>
              <Txt variant="caption" color={colors.textFaint} style={{ marginBottom: spacing.md }}>
                {proxyExpiry !== null
                  ? `Proxy runs out around ${formatDateTime(proxyExpiry)}.`
                  : "No proxy timer captured yet — open the game's Settings tab once."}
              </Txt>
            </>
          ) : null}

          <Button
            label="Save"
            onPress={handleSaveNotify}
            disabled={!notifyChanged}
            loading={busy === 'notify'}
          />
        </Card>
      </Section>

      <Section
        title="Backups"
        subtitle="Your data is only on this phone. A backup is the only copy."
      >
        <Card>
          <Row gap={spacing.md} style={{ marginBottom: spacing.md }}>
            <Ionicons name="shield-checkmark" size={22} color={colors.success} />
            <Txt variant="caption" color={colors.textMuted} style={{ flex: 1 }}>
              A backup is one file containing everything. Save it somewhere safe and you can restore
              onto a new phone exactly as it is now.
            </Txt>
          </Row>
          <Button
            label="Save a backup"
            onPress={handleBackup}
            loading={busy === 'backup'}
            style={{ marginBottom: spacing.sm }}
          />
          <Button
            label="Restore from a backup"
            variant="secondary"
            onPress={handleRestore}
            loading={busy === 'restore'}
          />
        </Card>
      </Section>

      <Section title="Export" subtitle="For reading elsewhere, not for restoring">
        <Card>
          <Button
            label="Export targets as a spreadsheet"
            variant="secondary"
            onPress={handleExportCsv}
            loading={busy === 'csv'}
          />
          <Txt variant="caption" color={colors.textFaint} style={{ marginTop: spacing.sm }}>
            Opens in Excel or Google Sheets. One row per target, with its IPs, wallets, software and
            tags.
          </Txt>
        </Card>
      </Section>

      <Section
        title="Manual import"
        subtitle="The game reader does this by itself; this is the hand-fed fallback."
      >
        <Card>
          <Button
            label="Paste logs by hand"
            variant="secondary"
            onPress={() => router.push('/import')}
          />
          <Txt variant="caption" color={colors.textFaint} style={{ marginTop: spacing.sm }}>
            The old Import tab, unchanged: paste log lines copied from the game, preview, then
            import.
          </Txt>
        </Card>
      </Section>

      <Section title="Maintenance">
        <Card>
          <Button
            label="Recalculate every potential score"
            variant="secondary"
            onPress={handleRecalculate}
            loading={busy === 'scores'}
          />
          <Txt variant="caption" color={colors.textFaint} style={{ marginTop: spacing.sm }}>
            Scores update by themselves. Use this after changing the scoring rules in
            src/logic/potentialScore.ts.
          </Txt>

          <Divider />

          <Button
            label="Clear closed reviews"
            variant="secondary"
            onPress={handleClearReviews}
            loading={busy === 'reviews'}
          />
        </Card>
      </Section>

      {stats ? (
        <Section title="What is stored">
          <Card>
            {[
              ['Targets', stats.targetCount],
              ['IP addresses', stats.ipCount],
              ['Wallets', stats.walletCount],
              ['Log lines', stats.logCount],
              ['Software records', stats.softwareCount],
              ['Crypto events', stats.totals.eventCount],
              ['Open reviews', stats.openReviews],
            ].map(([label, value], index) => (
              <View key={String(label)}>
                {index > 0 ? <Divider style={{ marginVertical: spacing.sm }} /> : null}
                <Row>
                  <Txt variant="body" style={{ flex: 1 }}>
                    {label}
                  </Txt>
                  <Txt variant="bodyStrong" color={colors.textMuted}>
                    {formatExact(Number(value))}
                  </Txt>
                </Row>
              </View>
            ))}
          </Card>
        </Section>
      ) : null}

      <Section title="Danger zone">
        <Card style={{ borderColor: colors.danger }}>
          <Txt variant="caption" color={colors.textMuted} style={{ marginBottom: spacing.md }}>
            There is no undo for this, and no automatic backup behind it.
          </Txt>
          <Button
            label="Erase all data"
            variant="danger"
            onPress={handleErase}
            loading={busy === 'erase'}
          />
        </Card>
      </Section>

      <Txt variant="caption" color={colors.textFaint} style={{ textAlign: 'center' }}>
        Hack EX 2 Companion v1.1 · everything stored offline on this device
      </Txt>
    </Screen>
  );
}
