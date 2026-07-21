// Note: the add panels on this screen must not autoFocus — the keyboard opening
// inside the ScrollView drags the scroll position. Modals are fine to autofocus.

import { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useSQLiteContext } from 'expo-sqlite';
import { useQuery } from '@/db/useQuery';
import { deleteTarget, getTargetWithDetails, logAttack } from '@/db/repo/targets';
import { getUserProfile } from '@/db/repo/settings';
import { softwareSortIndex } from '@/db/seed';
import {
  addIp,
  addTagToTarget,
  deleteInstalledSoftware,
  deleteIp,
  deleteWallet,
  ensureSoftware,
  ensureTag,
  listAllTags,
  listSoftwareCatalogue,
  removeTagFromTarget,
  setInstalledSoftware,
  setIpStatus,
  setWalletCracked,
  upsertWallet,
} from '@/db/repo/intel';
import { explainScore } from '@/logic/potentialScore';
import { recommendAction } from '@/logic/recommendation';
import { yieldTrend } from '@/logic/trend';
import { thresholdsFor, VALUE_TIERS, yieldTierFor } from '@/logic/valueScale';
import {
  Button,
  Card,
  Chip,
  Divider,
  EmptyState,
  Field,
  Input,
  Loading,
  ProgressBar,
  Row,
  Screen,
  Section,
  StatTile,
  Txt,
} from '@/ui/components';
import { Sparkline } from '@/ui/Charts';
import {
  activityColor,
  activityLabel,
  colors,
  eventColor,
  humanise,
  radius,
  recommendationColor,
  recommendationLabel,
  scoreColor,
  spacing,
  tierColor,
  trendColor,
} from '@/ui/theme';
import { formatCrypto, formatDateTime, formatExact, plural, timeAgo } from '@/ui/format';
import { useTheme } from '@/components/ThemeProvider';

export default function TargetProfileScreen() {
  useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const targetId = Number(id);
  const db = useSQLiteContext();
  const router = useRouter();

  const { data, loading, refresh } = useQuery(
    (database) => getTargetWithDetails(database, targetId),
    [targetId],
  );

  const { data: profile } = useQuery((database) => getUserProfile(database));
  const userLevel = profile?.level ?? 0;

  const [adding, setAdding] = useState<'ip' | 'wallet' | 'software' | 'tag' | null>(null);
  const [draft, setDraft] = useState('');
  const [loggingAttack, setLoggingAttack] = useState(false);

  const score = useMemo(() => {
    if (!data) return null;
    return explainScore({
      level: data.info.level,
      crypto: data.info.crypto,
      activity: data.info.activity,
      totals: data.totals,
      software: data.software,
      attackCount: data.target.attackCount,
      dateAdded: data.target.dateAdded,
      device: data.target.device,
      userLevel,
    });
  }, [data, userLevel]);

  const trend = useMemo(
    () =>
      yieldTrend(
        (data?.cryptoHistory ?? []).map((event) => ({ amount: event.amount, date: event.date })),
      ),
    [data],
  );

  const advice = useMemo(() => {
    if (!data) return null;
    return recommendAction({
      level: data.info.level,
      userLevel,
      activity: data.info.activity,
      score: data.info.potentialScore,
      ratePerActiveDay: data.totals.averagePerActiveDay,
      device: data.target.device,
    });
  }, [data, userLevel]);

  if (loading && !data) return <Loading />;
  if (!data) {
    return (
      <Screen>
        <EmptyState
          title="Target not found"
          message="It may have been deleted."
          action={<Button label="Back to targets" onPress={() => router.replace('/targets')} />}
        />
      </Screen>
    );
  }

  const { target, info, totals, tags, ips, wallets, logs, cryptoHistory, software } = data;
  const thresholds = thresholdsFor(info.level);
  const godly = thresholds.GODLY;

  // Tiers rank what you extract per active day, not what the target holds.
  const rate = totals.averagePerActiveDay;
  const tier = yieldTierFor(info.level, rate);

  const closeAdd = () => {
    setAdding(null);
    setDraft('');
  };

  const handleAddIp = async () => {
    const address = draft.trim();
    if (!address) return;
    await addIp(db, { targetId, address, status: 'ACTIVE', source: 'MANUAL' });
    closeAdd();
    refresh();
  };

  const handleAddWallet = async () => {
    const address = draft.trim();
    if (!address) return;
    await upsertWallet(db, { displayAddress: address, targetId });
    closeAdd();
    refresh();
  };

  const handleAddTag = async () => {
    const name = draft.trim();
    if (!name) return;
    const tagId = await ensureTag(db, name);
    await addTagToTarget(db, targetId, tagId);
    closeAdd();
    refresh();
  };

  const handleDelete = () => {
    Alert.alert(
      `Delete ${target.name}?`,
      'This removes the target and everything attached to it: IPs, wallets, logs, crypto history and software. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteTarget(db, targetId);
            router.replace('/targets');
          },
        },
      ],
    );
  };

  const sparkData = cryptoHistory
    .slice(0, 20)
    .reverse()
    .map((event) => event.amount);

  return (
    <>
      <Stack.Screen
        options={{
          title: target.name,
          headerRight: () => (
            <Pressable
              onPress={() => router.push(`/target/edit/${targetId}`)}
              hitSlop={12}
              accessibilityLabel="Edit target"
            >
              <Ionicons name="create-outline" size={22} color={colors.accent} />
            </Pressable>
          ),
        }}
      />

      <Screen>
        <Card style={{ marginBottom: spacing.lg }}>
          <Row gap={spacing.md}>
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: radius.md,
                backgroundColor: `${scoreColor(info.potentialScore)}1F`,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Txt variant="title" color={scoreColor(info.potentialScore)}>
                {Math.round(info.potentialScore)}
              </Txt>
            </View>

            <View style={{ flex: 1 }}>
              <Row gap={spacing.sm} wrap>
                <Chip
                  label={activityLabel[info.activity]}
                  color={activityColor[info.activity]}
                  selected
                  size="sm"
                />
                {tier ? <Chip label={tier} color={tierColor[tier]} selected size="sm" /> : null}
              </Row>
              <Txt variant="caption" color={colors.textFaint} style={{ marginTop: spacing.xs }}>
                Potential score · updated {timeAgo(info.lastUpdated)}
              </Txt>
            </View>
          </Row>

          <Divider />

          <Row wrap gap={spacing.lg}>
            <Field label="Level" value={info.level} />
            <Field label="Holding" value={formatExact(info.crypto)} color={colors.crypto} />
            <Field label="Device" value={target.device ?? '—'} />
            <Field label="Attacks" value={target.attackCount} />
          </Row>

          {godly > 0 ? (
            <>
              <Txt variant="caption" color={colors.textFaint} style={{ marginBottom: spacing.xs }}>
                What you take per active day — {formatExact(rate)} — against the tiers for level{' '}
                {info.level}
              </Txt>
              <ProgressBar
                progress={rate / godly}
                color={tier ? tierColor[tier] : colors.textFaint}
              />
              <Row style={{ marginTop: spacing.xs }} wrap gap={spacing.md}>
                {VALUE_TIERS.map((name) => (
                  <Txt
                    key={name}
                    variant="caption"
                    color={rate >= thresholds[name] ? tierColor[name] : colors.textFaint}
                  >
                    {name} {thresholds[name]}
                  </Txt>
                ))}
              </Row>
            </>
          ) : (
            <Txt variant="caption" color={colors.textFaint}>
              Set a level to see value tiers for this target.
            </Txt>
          )}
        </Card>

        {advice ? (
          <Card style={{ marginBottom: spacing.lg }}>
            <Row gap={spacing.sm} wrap style={{ marginBottom: spacing.sm }}>
              <Chip
                label={recommendationLabel[advice.action]}
                color={recommendationColor[advice.action]}
                selected
              />
              {advice.levelDelta !== 0 && userLevel > 0 ? (
                <Txt variant="caption" color={colors.textFaint}>
                  {advice.levelDelta > 0 ? `+${advice.levelDelta}` : advice.levelDelta} levels on you
                </Txt>
              ) : null}
            </Row>
            <Txt variant="body" color={colors.textMuted}>
              {advice.reason}
            </Txt>

            <Divider />

            <Row gap={spacing.sm} wrap>
              <Chip
                label={humanise(trend.direction)}
                color={trendColor(trend.direction)}
                selected
                size="sm"
              />
              {trend.direction !== 'UNKNOWN' ? (
                <Txt variant="label" color={trendColor(trend.direction)}>
                  {trend.percent > 0 ? `+${trend.percent}` : trend.percent}% against earlier hauls
                </Txt>
              ) : null}
            </Row>
            <Txt variant="caption" color={colors.textFaint} style={{ marginTop: spacing.xs }}>
              {trend.detail}
            </Txt>
          </Card>
        ) : null}

        <Section title="Crypto" subtitle={`${plural(totals.eventCount, 'extraction')} recorded`}>
          <Row gap={spacing.sm} style={{ marginBottom: spacing.sm }}>
            <StatTile label="Today" value={formatCrypto(totals.extractedToday)} />
            <StatTile
              label="All time"
              value={formatCrypto(totals.extractedTotal)}
              color={colors.crypto}
            />
            <StatTile label="Per active day" value={formatCrypto(totals.averagePerActiveDay)} />
          </Row>
          {sparkData.length > 1 ? (
            <Card>
              <Txt variant="caption" color={colors.textFaint} style={{ marginBottom: spacing.sm }}>
                Last {sparkData.length} extractions
              </Txt>
              <SparklineBlock data={sparkData} />
            </Card>
          ) : null}
        </Section>

        {score ? (
          <Section title="Why this score" subtitle="What feeds the potential score">
            <Card>
              {score.components.map((component, index) => (
                <View key={component.key}>
                  {index > 0 ? <Divider style={{ marginVertical: spacing.sm }} /> : null}
                  <Row style={{ marginBottom: spacing.xs }}>
                    <Txt variant="label" style={{ flex: 1 }}>
                      {component.label}
                    </Txt>
                    <Txt variant="caption" color={colors.textFaint}>
                      {Math.round(component.value * 100)}% of {Math.round(component.weight * 100)}
                    </Txt>
                  </Row>
                  <ProgressBar progress={component.value} color={colors.accent} height={4} />
                  <Txt variant="caption" color={colors.textFaint} style={{ marginTop: spacing.xs }}>
                    {component.detail}
                  </Txt>
                </View>
              ))}
            </Card>
          </Section>
        ) : null}

        <Section
          title="Tags"
          action={<AddButton onPress={() => setAdding(adding === 'tag' ? null : 'tag')} />}
        >
          {adding === 'tag' ? (
            <Card style={{ marginBottom: spacing.sm }}>
              <Input
                value={draft}
                onChangeText={setDraft}
                placeholder="e.g. BANK, VIP"
                autoCapitalize="characters"
                style={{ marginBottom: spacing.sm }}
                hint="Value and trend tags look after themselves — these are for anything else."
              />
              <Row gap={spacing.sm}>
                <Button label="Add tag" onPress={handleAddTag} full />
                <Button label="Cancel" variant="ghost" onPress={closeAdd} />
              </Row>
              <ExistingTags targetId={targetId} onAdded={refresh} />
            </Card>
          ) : null}

          {tags.length > 0 ? (
            <Row gap={spacing.xs} wrap>
              {tags.map((tag) => (
                <Chip
                  key={tag.id}
                  label={tag.name}
                  color={tag.color ?? colors.textMuted}
                  selected
                  onRemove={async () => {
                    await removeTagFromTarget(db, targetId, tag.id);
                    refresh();
                  }}
                />
              ))}
            </Row>
          ) : (
            <Txt variant="caption" color={colors.textFaint}>
              No tags yet.
            </Txt>
          )}
        </Section>

        <Section
          title="Known IPs"
          subtitle={plural(ips.length, 'address')}
          action={<AddButton onPress={() => setAdding(adding === 'ip' ? null : 'ip')} />}
        >
          {adding === 'ip' ? (
            <Card style={{ marginBottom: spacing.sm }}>
              <Input
                value={draft}
                onChangeText={setDraft}
                placeholder="216.22.206.218"
                keyboardType="numeric"
                style={{ marginBottom: spacing.sm }}
                hint="Adding an IP here also teaches the log parser who it belongs to."
              />
              <Row gap={spacing.sm}>
                <Button label="Add IP" onPress={handleAddIp} full />
                <Button label="Cancel" variant="ghost" onPress={closeAdd} />
              </Row>
            </Card>
          ) : null}

          {ips.length > 0 ? (
            <Card padded={false}>
              {ips.map((ip, index) => (
                <View key={ip.id}>
                  {index > 0 ? <Divider style={{ marginVertical: 0 }} /> : null}
                  <Row style={{ padding: spacing.md }} gap={spacing.sm}>
                    <View style={{ flex: 1 }}>
                      <CopyableAddress value={ip.address} />
                      <Txt variant="caption" color={colors.textFaint} style={{ marginTop: 2 }}>
                        {humanise(ip.status)} · found {timeAgo(ip.discoveredAt)} ·{' '}
                        {ip.source === 'PARSER' ? 'from logs' : 'added by hand'}
                      </Txt>
                    </View>
                    <Chip
                      label={ip.status === 'ACTIVE' ? 'Active' : 'Dead'}
                      size="sm"
                      color={ip.status === 'ACTIVE' ? colors.success : colors.textFaint}
                      selected
                      onPress={async () => {
                        await setIpStatus(db, ip.id, ip.status === 'ACTIVE' ? 'DEAD' : 'ACTIVE');
                        refresh();
                      }}
                    />
                    <Pressable
                      onPress={async () => {
                        await deleteIp(db, ip.id);
                        refresh();
                      }}
                      hitSlop={10}
                      accessibilityLabel={`Delete ${ip.address}`}
                    >
                      <Ionicons name="trash-outline" size={16} color={colors.textFaint} />
                    </Pressable>
                  </Row>
                </View>
              ))}
            </Card>
          ) : (
            <Txt variant="caption" color={colors.textFaint}>
              None yet. Importing logs finds these automatically.
            </Txt>
          )}
        </Section>

        <Section
          title="Wallets"
          subtitle={plural(wallets.length, 'wallet')}
          action={<AddButton onPress={() => setAdding(adding === 'wallet' ? null : 'wallet')} />}
        >
          {adding === 'wallet' ? (
            <Card style={{ marginBottom: spacing.sm }}>
              <Input
                value={draft}
                onChangeText={setDraft}
                placeholder="hx84d9...762d"
                autoCapitalize="none"
                style={{ marginBottom: spacing.sm }}
                hint="Once a wallet is linked here, crypto from it is credited to this target automatically."
              />
              <Row gap={spacing.sm}>
                <Button label="Add wallet" onPress={handleAddWallet} full />
                <Button label="Cancel" variant="ghost" onPress={closeAdd} />
              </Row>
            </Card>
          ) : null}

          {wallets.length > 0 ? (
            <Card padded={false}>
              {wallets.map((wallet, index) => (
                <View key={wallet.id}>
                  {index > 0 ? <Divider style={{ marginVertical: 0 }} /> : null}
                  <Row style={{ padding: spacing.md }} gap={spacing.sm}>
                    <View style={{ flex: 1 }}>
                      <Txt variant="mono" color={colors.crypto} selectable>
                        {wallet.fullAddress ?? wallet.displayAddress}
                      </Txt>
                      <Txt variant="caption" color={colors.textFaint} style={{ marginTop: 2 }}>
                        found {timeAgo(wallet.discoveredAt)}
                      </Txt>
                    </View>
                    <Chip
                      label={wallet.cracked ? 'Cracked' : 'Not cracked'}
                      size="sm"
                      color={wallet.cracked ? colors.success : colors.textFaint}
                      selected
                      onPress={async () => {
                        await setWalletCracked(db, wallet.id, !wallet.cracked);
                        refresh();
                      }}
                    />
                    <Pressable
                      onPress={async () => {
                        await deleteWallet(db, wallet.id);
                        refresh();
                      }}
                      hitSlop={10}
                      accessibilityLabel={`Delete ${wallet.displayAddress}`}
                    >
                      <Ionicons name="trash-outline" size={16} color={colors.textFaint} />
                    </Pressable>
                  </Row>
                </View>
              ))}
            </Card>
          ) : (
            <Txt variant="caption" color={colors.textFaint}>
              None yet.
            </Txt>
          )}
        </Section>

        <Section
          title="Installed software"
          subtitle={plural(software.length, 'record')}
          action={<AddButton onPress={() => setAdding(adding === 'software' ? null : 'software')} />}
        >
          {adding === 'software' ? (
            <SoftwarePanel targetId={targetId} onAdded={refresh} onClose={closeAdd} />
          ) : null}

          {software.length > 0 ? (
            <Card padded={false}>
              {software.map((item, index) => (
                <View key={item.id}>
                  {index > 0 ? <Divider style={{ marginVertical: 0 }} /> : null}
                  <Row style={{ padding: spacing.md }} gap={spacing.sm}>
                    <View style={{ flex: 1 }}>
                      <Row gap={spacing.sm}>
                        <Txt variant="bodyStrong">{item.name}</Txt>
                        <Chip
                          label={`Lv${item.level}`}
                          size="sm"
                          color={item.category === 'DEFENSIVE' ? colors.danger : colors.info}
                          selected
                        />
                      </Row>
                      <Txt variant="caption" color={colors.textFaint} style={{ marginTop: 2 }}>
                        {item.owner === 'MINE' ? 'Uploaded by me' : "Target's own"} ·{' '}
                        {item.category.toLowerCase()}
                        {item.source === 'PARSER' ? ' · from logs' : ''}
                      </Txt>
                    </View>
                    <Pressable
                      onPress={async () => {
                        await deleteInstalledSoftware(db, item.id);
                        refresh();
                      }}
                      hitSlop={10}
                      accessibilityLabel={`Delete ${item.name}`}
                    >
                      <Ionicons name="trash-outline" size={16} color={colors.textFaint} />
                    </Pressable>
                  </Row>
                </View>
              ))}
            </Card>
          ) : (
            <Txt variant="caption" color={colors.textFaint}>
              None recorded. Logs mentioning software fill this in automatically.
            </Txt>
          )}
        </Section>

        {cryptoHistory.length > 0 ? (
          <Section title="Crypto history" subtitle="Every extraction, traceable to its log line">
            <Card padded={false}>
              {cryptoHistory.slice(0, 30).map((event, index) => (
                <View key={event.id}>
                  {index > 0 ? <Divider style={{ marginVertical: 0 }} /> : null}
                  <View style={{ padding: spacing.md }}>
                    <Row>
                      <Txt variant="bodyStrong" color={colors.crypto} style={{ flex: 1 }}>
                        +{formatExact(event.amount)}
                      </Txt>
                      <Txt variant="caption" color={colors.textFaint}>
                        {formatDateTime(event.date)}
                      </Txt>
                    </Row>
                    <Txt variant="caption" color={colors.textFaint} style={{ marginTop: 2 }}>
                      {humanise(event.source)}
                      {event.walletDisplayAddress ? ` · ${event.walletDisplayAddress}` : ''}
                    </Txt>
                    {event.log ? (
                      <Txt variant="mono" color={colors.textFaint} style={{ marginTop: spacing.xs }}>
                        {event.log.rawLog}
                      </Txt>
                    ) : null}
                  </View>
                </View>
              ))}
            </Card>
          </Section>
        ) : null}

        {logs.length > 0 ? (
          <Section title="Logs" subtitle={plural(logs.length, 'line')}>
            <Card padded={false}>
              {logs.slice(0, 40).map((log, index) => (
                <View key={log.id}>
                  {index > 0 ? <Divider style={{ marginVertical: 0 }} /> : null}
                  <View style={{ padding: spacing.md }}>
                    <Row gap={spacing.sm}>
                      <View
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: 3,
                          backgroundColor: eventColor(log.eventType),
                        }}
                      />
                      <Txt variant="caption" color={eventColor(log.eventType)} style={{ flex: 1 }}>
                        {humanise(log.eventType)}
                      </Txt>
                      <Txt variant="caption" color={colors.textFaint}>
                        {log.rawTimestamp ?? formatDateTime(log.timestamp)}
                      </Txt>
                    </Row>
                    <Txt variant="mono" color={colors.textMuted} style={{ marginTop: spacing.xs }}>
                      {log.rawLog}
                    </Txt>
                  </View>
                </View>
              ))}
            </Card>
          </Section>
        ) : null}

        {info.notes.trim().length > 0 ? (
          <Section title="Notes">
            <Card>
              <Txt variant="body" color={colors.textMuted}>
                {info.notes}
              </Txt>
            </Card>
          </Section>
        ) : null}

        <Section title="Actions">
          <Row gap={spacing.sm} style={{ marginBottom: spacing.sm }}>
            <Button
              label="Log an attack"
              variant="secondary"
              full
              onPress={() => setLoggingAttack(true)}
            />
            <Button
              label="Edit"
              variant="secondary"
              full
              onPress={() => router.push(`/target/edit/${targetId}`)}
            />
          </Row>
          <Button label="Delete this target" variant="danger" onPress={handleDelete} />
        </Section>
      </Screen>

      {loggingAttack ? (
        <AttackSheet
          targetName={target.name}
          onClose={() => setLoggingAttack(false)}
          onSubmit={async (crypto) => {
            await logAttack(db, targetId, { crypto });
            setLoggingAttack(false);
            refresh();
          }}
        />
      ) : null}
    </>
  );
}

function CopyableAddress({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Pressable
      onPress={async () => {
        await Clipboard.setStringAsync(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      hitSlop={8}
      accessibilityLabel={`Copy ${value}`}
    >
      <Row gap={spacing.xs}>
        <Txt variant="mono">{value}</Txt>
        <Ionicons
          name={copied ? 'checkmark' : 'copy-outline'}
          size={13}
          color={copied ? colors.success : colors.textFaint}
        />
      </Row>
    </Pressable>
  );
}

function AddButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityLabel="Add">
      <Ionicons name="add-circle-outline" size={22} color={colors.accent} />
    </Pressable>
  );
}

function SparklineBlock({ data }: { data: number[] }) {
  const [width, setWidth] = useState(0);
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Sparkline data={data} width={width} />
    </View>
  );
}

function ExistingTags({ targetId, onAdded }: { targetId: number; onAdded: () => void }) {
  const db = useSQLiteContext();
  const { data } = useQuery((database) => listAllTags(database));

  if (!data || data.length === 0) return null;

  return (
    <Row gap={spacing.xs} wrap style={{ marginTop: spacing.md }}>
      {data.slice(0, 18).map((tag) => (
        <Chip
          key={tag.id}
          label={tag.name}
          size="sm"
          color={tag.color ?? colors.textMuted}
          onPress={async () => {
            await addTagToTarget(db, targetId, tag.id);
            onAdded();
          }}
        />
      ))}
    </Row>
  );
}

// Batch-add panel. Deliberately stays open after adding: closing collapsed the
// card and threw the ScrollView position back to the top on every add.
function SoftwarePanel({
  targetId,
  onAdded,
  onClose,
}: {
  targetId: number;
  onAdded: () => void;
  onClose: () => void;
}) {
  const db = useSQLiteContext();
  const { data: catalogue } = useQuery((database) => listSoftwareCatalogue(database));

  // name -> typed level; '' means level 1.
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [customName, setCustomName] = useState('');
  const [customLevel, setCustomLevel] = useState('');
  const [busy, setBusy] = useState(false);

  // Game's own order, not alphabetical — chips match the in-game list.
  const ordered = useMemo(
    () => [...(catalogue ?? [])].sort((a, b) => softwareSortIndex(a.name) - softwareSortIndex(b.name)),
    [catalogue],
  );

  const pickedNames = Object.keys(picked);
  const custom = customName.trim();
  const count = pickedNames.length + (custom ? 1 : 0);

  const toggle = (name: string) =>
    setPicked((current) => {
      if (name in current) {
        const { [name]: _removed, ...rest } = current;
        return rest;
      }
      return { ...current, [name]: '' };
    });

  const apply = async () => {
    if (count === 0) return;
    setBusy(true);
    try {
      const entries = pickedNames.map((name) => ({ name, level: Number(picked[name]) || 1 }));
      if (custom) entries.push({ name: custom, level: Number(customLevel) || 1 });

      for (const entry of entries) {
        const softwareId = await ensureSoftware(db, entry.name);
        await setInstalledSoftware(db, {
          targetId,
          softwareId,
          level: entry.level,
          owner: 'TARGET',
          source: 'MANUAL',
          overwrite: true,
        });
      }

      setPicked({});
      setCustomName('');
      setCustomLevel('');
      onAdded();
    } catch (error) {
      Alert.alert('Could not save', String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ marginBottom: spacing.sm }}>
      <Txt variant="caption" color={colors.textFaint} style={{ marginBottom: spacing.sm }}>
        Tap everything installed on this device, then add them together.
      </Txt>

      <Row gap={spacing.xs} wrap>
        {ordered.map((item) => (
          <Chip
            key={item.id}
            label={item.name}
            size="sm"
            color={item.category === 'DEFENSIVE' ? colors.danger : colors.info}
            selected={item.name in picked}
            onPress={() => toggle(item.name)}
          />
        ))}
      </Row>

      {pickedNames.length > 0 ? (
        <View style={{ marginTop: spacing.md }}>
          {pickedNames.map((name) => (
            <Row key={name} gap={spacing.sm} style={{ marginBottom: spacing.sm }}>
              <Txt variant="body" style={{ flex: 1 }} numberOfLines={1}>
                {name}
              </Txt>
              <Input
                value={picked[name]}
                onChangeText={(text) =>
                  setPicked((current) => ({ ...current, [name]: text.replace(/[^0-9]/g, '') }))
                }
                placeholder="Lv 1"
                keyboardType="numeric"
                style={{ marginBottom: 0, width: 84 }}
              />
              <Pressable
                onPress={() => toggle(name)}
                hitSlop={10}
                accessibilityLabel={`Remove ${name}`}
              >
                <Ionicons name="close" size={18} color={colors.textFaint} />
              </Pressable>
            </Row>
          ))}
        </View>
      ) : null}

      <Divider />

      <Row gap={spacing.sm} style={{ marginBottom: spacing.md }}>
        <View style={{ flex: 1 }}>
          <Input
            value={customName}
            onChangeText={setCustomName}
            placeholder="Something not listed above"
            style={{ marginBottom: 0 }}
          />
        </View>
        <Input
          value={customLevel}
          onChangeText={(text) => setCustomLevel(text.replace(/[^0-9]/g, ''))}
          placeholder="Lv 1"
          keyboardType="numeric"
          style={{ marginBottom: 0, width: 84 }}
        />
      </Row>

      <Row gap={spacing.sm}>
        <Button
          label={count === 0 ? 'Nothing selected' : `Add ${plural(count, 'software', 'software')}`}
          onPress={apply}
          disabled={count === 0}
          loading={busy}
          full
        />
        <Button label="Done" variant="ghost" onPress={onClose} />
      </Row>
    </Card>
  );
}

function AttackSheet({
  targetName,
  onClose,
  onSubmit,
}: {
  targetName: string;
  onClose: () => void;
  onSubmit: (crypto: number) => Promise<void>;
}) {
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (crypto: number) => {
    setBusy(true);
    try {
      await onSubmit(crypto);
    } catch (error) {
      Alert.alert('Could not log that', String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: '#000000AA', justifyContent: 'center' }}
        onPress={onClose}
        accessibilityLabel="Close"
      >
        {/* Swallow taps so pressing inside the card doesn't dismiss the modal. */}
        <Pressable onPress={() => {}} style={{ padding: spacing.lg }}>
          <Card>
            <Txt variant="heading">How much crypto did you take?</Txt>
            <Txt variant="caption" color={colors.textFaint} style={{ marginTop: 2 }}>
              From {targetName}. Leave it blank if the run came away with nothing.
            </Txt>

            <Input
              value={amount}
              onChangeText={(text) => setAmount(text.replace(/[^0-9.]/g, ''))}
              placeholder="0"
              keyboardType="decimal-pad"
              style={{ marginTop: spacing.lg, marginBottom: spacing.md }}
            />

            <Row gap={spacing.sm}>
              <Button
                label="Log the haul"
                onPress={() => submit(Number(amount) || 0)}
                disabled={amount.trim().length === 0}
                loading={busy}
                full
              />
              <Button label="None" variant="secondary" onPress={() => submit(0)} />
            </Row>
            <Button
              label="Cancel"
              variant="ghost"
              onPress={onClose}
              style={{ marginTop: spacing.sm }}
            />
          </Card>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
