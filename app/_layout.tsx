import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Stack } from 'expo-router';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  ActivityIndicator,
  AppState,
  DeviceEventEmitter,
  LogBox,
  Platform,
  Text,
  View,
} from 'react-native';
import { initialiseDatabase } from '@/db/database';
import { notifyDataChanged } from '@/db/useQuery';
import { SNAPSHOT_EVENT, iosCaptureAvailable, setCompanionForeground } from '@/native/gameReader';
import { runAutoImport } from '@/logic/autoImport';
import { syncProxyNotification } from '@/logic/proxyNotification';
import { AccountProvider, useAccounts } from '@/components/AccountProvider';
import { ThemeProvider, useTheme } from '@/components/ThemeProvider';
import { colors, spacing, typography } from '@/ui/theme';

// Dev-only: keep-awake can fail to engage while the app is backgrounded. Harmless.
LogBox.ignoreLogs(['Unable to activate keep awake']);

export default function RootLayout() {
  // Show proxy warnings even while the companion itself is on screen.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    import('expo-notifications')
      .then((Notifications) => {
        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowBanner: true,
            shouldShowList: true,
            shouldPlaySound: false,
            shouldSetBadge: false,
          }),
        });
      })
      .catch(() => {});
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <AccountProvider fallback={<DatabaseLoading />}>
          <AccountDatabase />
        </AccountProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// Keyed on the database file: switching account tears down the old connection
// and reopens (and if needed migrates) the new account's database.
function AccountDatabase() {
  const { activeAccount } = useAccounts();

  return (
    <SQLiteProvider
      key={activeAccount.dbName}
      databaseName={activeAccount.dbName}
      onInit={initialiseDatabase}
      useSuspense={false}
      // Screens only render once the DB migration in initialiseDatabase completes.
      onError={undefined}
    >
      <ThemeProvider>
        <AutoImporter />
        <AppStack />
      </ThemeProvider>
    </SQLiteProvider>
  );
}

// Triggered by the reader's snapshot events (JS timers are paused while the
// companion sits behind the game, so it cannot poll) and on AppState 'active'.
function AutoImporter() {
  const db = useSQLiteContext();
  const { activeAccount, reportDetectedAccount } = useAccounts();

  // iOS: heartbeat a shared flag while the companion is on screen. The
  // broadcast extension pauses OCR while the flag is fresh, so the companion's
  // own UI is never captured back into the database. The flag decays by itself
  // within seconds once JS is suspended in the background.
  useEffect(() => {
    if (Platform.OS !== 'ios' || !iosCaptureAvailable) return;
    let interval: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (interval) return;
      setCompanionForeground(true);
      interval = setInterval(() => setCompanionForeground(true), 2000);
    };
    const stop = () => {
      if (interval) clearInterval(interval);
      interval = null;
      setCompanionForeground(false);
    };
    start();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') start();
      else stop();
    });
    return () => {
      stop();
      sub.remove();
    };
  }, []);

  useEffect(() => {
    // Serialised: snapshot events arrive faster than an import completes, and
    // two concurrent runs would double-import the same queue files.
    let inFlight = false;
    let rerun = false;
    let disposed = false;

    const run = () => {
      if (disposed) return;
      if (inFlight) {
        rerun = true;
        return;
      }
      inFlight = true;
      runAutoImport(db, activeAccount.name)
        .then(async (report) => {
          const changed =
            report !== null &&
            (report.newLines > 0 ||
              report.enemyScreens > 0 ||
              report.virusCaptures > 0 ||
              report.ownCaptures > 0);
          if (changed) {
            console.log(
              `[auto-import] ${report.newLines} new lines, ` +
                `${report.cryptoAdded} crypto, ${report.enemyScreens} enemy screens, ` +
                `${report.virusCaptures} virus captures, ${report.ownCaptures} own captures, ` +
                `from ${report.snapshotsProcessed} snapshots`,
            );
          }
          // Must complete BEFORE any account switch: the switch below remounts
          // SQLiteProvider, which closes this connection — and expo-sqlite
          // segfaults natively when a query lands on a closed database.
          await syncProxyNotification(db);
          if (changed) notifyDataChanged();
          // Registers/renames/switches as needed. On a switch this component
          // unmounts and its successor drains the rest of the queue into the
          // other account's database. Nothing may touch `db` after this call.
          if (report?.ownAccountName) {
            const switched = reportDetectedAccount(report.ownAccountName);
            if (switched) {
              disposed = true;
              console.log(`[auto-import] switched to account ${report.ownAccountName}`);
            }
          }
        })
        .catch((error) => console.warn('[auto-import] failed', error))
        .finally(() => {
          inFlight = false;
          if (rerun) {
            rerun = false;
            run();
          }
        });
    };

    run();
    const appSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') run();
    });
    const snapshotSub = DeviceEventEmitter.addListener(SNAPSHOT_EVENT, run);
    // iOS has no snapshot push events; the broadcast extension keeps writing
    // while the game plays, so poll cheaply whenever the companion is open.
    const pollId =
      Platform.OS === 'ios' && iosCaptureAvailable ? setInterval(run, 5000) : null;
    return () => {
      disposed = true;
      appSub.remove();
      snapshotSub.remove();
      if (pollId) clearInterval(pollId);
    };
  }, [db, activeAccount.name, reportDetectedAccount]);

  return null;
}

function AppStack() {
  // Re-renders the whole navigator tree when the accent theme changes.
  useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerTitleStyle: { ...typography.heading, color: colors.text },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="target/[id]" options={{ title: 'Target' }} />
      <Stack.Screen name="target/new" options={{ title: 'New target', presentation: 'modal' }} />
      <Stack.Screen name="target/edit/[id]" options={{ title: 'Edit target' }} />
      <Stack.Screen name="review" options={{ title: 'Review inbox' }} />
      <Stack.Screen name="import" options={{ title: 'Manual import' }} />
      <Stack.Screen name="+not-found" options={{ title: 'Not found' }} />
    </Stack>
  );
}

export function DatabaseLoading({ error }: { error?: Error }) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 3000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.background,
        padding: spacing.xl,
      }}
    >
      {error ? (
        <>
          <Text style={[typography.heading, { color: colors.danger }]}>
            The database could not be opened
          </Text>
          <Text
            style={[
              typography.caption,
              { color: colors.textMuted, textAlign: 'center', marginTop: spacing.sm },
            ]}
          >
            {error.message}
          </Text>
        </>
      ) : (
        <>
          <ActivityIndicator color={colors.accent} />
          {slow ? (
            <Text style={[typography.caption, { color: colors.textFaint, marginTop: spacing.md }]}>
              Upgrading the database…
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}
