import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSQLiteContext } from 'expo-sqlite';
import { useQuery } from '@/db/useQuery';
import {
  listOpenReviews,
  parseReviewPayload,
  resolveReviewsForWallet,
  setReviewStatus,
} from '@/db/repo/reviews';
import { assignWalletToTarget, listUnassignedWallets, upsertWallet, addIp } from '@/db/repo/intel';
import { listTargetSummaries, recalculateScore, createTarget } from '@/db/repo/targets';
import { listUnassignedLogs, assignLogToTarget } from '@/db/repo/logs';
import {
  Button,
  Card,
  Chip,
  Divider,
  EmptyState,
  Input,
  Loading,
  Row,
  Screen,
  Section,
  Txt,
} from '@/ui/components';
import { colors, humanise, radius, spacing } from '@/ui/theme';
import { formatExact, plural, timeAgo } from '@/ui/format';

interface Assignment {
  kind: 'wallet' | 'ip' | 'log';
  /** The wallet address, IP address, or log id being assigned. */
  value: string;
  logId?: number;
  reviewId?: number;
  label: string;
}

export default function ReviewScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [assigning, setAssigning] = useState<Assignment | null>(null);

  const { data: wallets, refresh: refreshWallets } = useQuery((database) =>
    listUnassignedWallets(database),
  );
  const { data: reviews, refresh: refreshReviews } = useQuery((database) =>
    listOpenReviews(database),
  );
  const { data: orphanLogs, refresh: refreshLogs } = useQuery((database) =>
    listUnassignedLogs(database, 50),
  );

  const refreshAll = () => {
    refreshWallets();
    refreshReviews();
    refreshLogs();
  };

  if (!wallets || !reviews || !orphanLogs) return <Loading />;

  // Wallet reviews already surface via the wallet list; don't list them twice.
  const otherReviews = reviews.filter((r) => r.kind !== 'UNRESOLVED_WALLET');
  const nothingToDo =
    wallets.length === 0 && otherReviews.length === 0 && orphanLogs.length === 0;

  const handleAssigned = () => {
    setAssigning(null);
    refreshAll();
  };

  return (
    <Screen>
      {nothingToDo ? (
        <EmptyState
          title="Nothing to review"
          message="Every log line has found an owner. New IP addresses become targets by themselves, so this inbox now only fills up when a wallet turns up that could belong to more than one of them."
          action={<Button label="Back" onPress={() => router.back()} />}
        />
      ) : null}

      {wallets.length > 0 ? (
        <Section
          title="Wallets with no owner"
          subtitle="Timestamps could not tie these to a single target. Assign one and its crypto is credited straight away."
        >
          {wallets.map((wallet) => (
            <Card key={wallet.id} style={{ marginBottom: spacing.sm }}>
              <Row gap={spacing.md}>
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: radius.sm,
                    backgroundColor: `${colors.crypto}1F`,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name="wallet" size={18} color={colors.crypto} />
                </View>
                <View style={{ flex: 1 }}>
                  <Txt variant="mono" color={colors.crypto} selectable>
                    {wallet.fullAddress ?? wallet.displayAddress}
                  </Txt>
                  <Txt variant="caption" color={colors.textFaint} style={{ marginTop: 2 }}>
                    found {timeAgo(wallet.discoveredAt)}
                  </Txt>
                </View>
              </Row>
              <Button
                label="Assign to a target"
                variant="secondary"
                style={{ marginTop: spacing.md }}
                onPress={() =>
                  setAssigning({
                    kind: 'wallet',
                    value: wallet.displayAddress,
                    label: wallet.fullAddress ?? wallet.displayAddress,
                  })
                }
              />
            </Card>
          ))}
        </Section>
      ) : null}

      {orphanLogs.length > 0 ? (
        <Section
          title="Log lines with no target"
          subtitle="Lines carrying no IP and no wallet the parser could place. Rare, now that new addresses become targets on their own."
        >
          {orphanLogs.slice(0, 20).map((log) => {
            const firstIp = log.extractedIps.split(',')[0]?.trim();
            return (
              <Card key={log.id} style={{ marginBottom: spacing.sm }}>
                <Row style={{ marginBottom: spacing.xs }}>
                  <Txt variant="caption" color={colors.textMuted} style={{ flex: 1 }}>
                    {humanise(log.eventType)}
                  </Txt>
                  <Txt variant="caption" color={colors.textFaint}>
                    {log.rawTimestamp ?? timeAgo(log.timestamp)}
                  </Txt>
                </Row>
                <Txt variant="mono" color={colors.textMuted}>
                  {log.rawLog}
                </Txt>
                {firstIp ? (
                  <Button
                    label={`Assign ${firstIp} to a target`}
                    variant="secondary"
                    style={{ marginTop: spacing.md }}
                    onPress={() =>
                      setAssigning({
                        kind: 'ip',
                        value: firstIp,
                        logId: log.id,
                        label: firstIp,
                      })
                    }
                  />
                ) : (
                  <Button
                    label="Assign this line to a target"
                    variant="secondary"
                    style={{ marginTop: spacing.md }}
                    onPress={() =>
                      setAssigning({
                        kind: 'log',
                        value: String(log.id),
                        logId: log.id,
                        label: log.rawLog,
                      })
                    }
                  />
                )}
              </Card>
            );
          })}
          {orphanLogs.length > 20 ? (
            <Txt variant="caption" color={colors.textFaint}>
              {orphanLogs.length - 20} more not shown. Assigning an IP usually clears several at
              once.
            </Txt>
          ) : null}
        </Section>
      ) : null}

      {otherReviews.length > 0 ? (
        <Section title="Other items" subtitle={plural(otherReviews.length, 'item')}>
          {otherReviews.map((review) => {
            const payload = parseReviewPayload<{ raw?: string; address?: string }>(review);
            return (
              <Card key={review.id} style={{ marginBottom: spacing.sm }}>
                <Row style={{ marginBottom: spacing.xs }}>
                  <Chip label={humanise(review.kind)} size="sm" color={colors.warning} selected />
                  <View style={{ flex: 1 }} />
                  <Txt variant="caption" color={colors.textFaint}>
                    {timeAgo(review.createdAt)}
                  </Txt>
                </Row>
                <Txt variant="body">{review.reason}</Txt>
                {payload?.raw ? (
                  <Txt variant="mono" color={colors.textFaint} style={{ marginTop: spacing.xs }}>
                    {payload.raw}
                  </Txt>
                ) : null}

                <Row gap={spacing.sm} style={{ marginTop: spacing.md }}>
                  {payload?.address ? (
                    <Button
                      label={`Assign ${payload.address}`}
                      variant="secondary"
                      full
                      onPress={() =>
                        setAssigning({
                          kind: 'ip',
                          value: payload.address!,
                          reviewId: review.id,
                          label: payload.address!,
                        })
                      }
                    />
                  ) : null}
                  <Button
                    label="Dismiss"
                    variant="ghost"
                    onPress={async () => {
                      await setReviewStatus(db, review.id, 'IGNORED');
                      refreshAll();
                    }}
                  />
                </Row>
              </Card>
            );
          })}
        </Section>
      ) : null}

      {assigning ? (
        <AssignSheet
          assignment={assigning}
          onClose={() => setAssigning(null)}
          onAssigned={handleAssigned}
        />
      ) : null}
    </Screen>
  );
}

// The list must be a ScrollView with flexShrink (the sheet has a maxHeight) and
// keyboardShouldPersistTaps, or taps get eaten dismissing the search keyboard.
function AssignSheet({
  assignment,
  onClose,
  onAssigned,
}: {
  assignment: Assignment;
  onClose: () => void;
  onAssigned: () => void;
}) {
  const db = useSQLiteContext();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  const { data: targets } = useQuery(
    (database) => listTargetSummaries(database, { query, sort: 'score', limit: 40 }),
    [query],
  );

  const assignTo = async (targetId: number) => {
    setBusy(true);
    try {
      if (assignment.kind === 'wallet') {
        const walletId = await upsertWallet(db, { displayAddress: assignment.value });
        const credited = await assignWalletToTarget(db, walletId, targetId);
        await resolveReviewsForWallet(db, assignment.value);
        await recalculateScore(db, targetId);
        Alert.alert(
          'Wallet assigned',
          credited > 0
            ? `${plural(credited, 'past crypto event')} credited to this target.`
            : 'Future crypto from this wallet will be credited automatically.',
        );
      } else if (assignment.kind === 'ip') {
        await addIp(db, {
          targetId,
          address: assignment.value,
          status: 'ACTIVE',
          source: 'MANUAL',
        });
        if (assignment.logId) await assignLogToTarget(db, assignment.logId, targetId);
        if (assignment.reviewId) await setReviewStatus(db, assignment.reviewId, 'RESOLVED');
        await recalculateScore(db, targetId);
      } else if (assignment.logId) {
        await assignLogToTarget(db, assignment.logId, targetId);
        await recalculateScore(db, targetId);
      }
      onAssigned();
    } catch (error) {
      Alert.alert('Could not assign', String(error));
    } finally {
      setBusy(false);
    }
  };

  const createAndAssign = async () => {
    const name = query.trim();
    if (!name) return;
    setBusy(true);
    try {
      const targetId = await createTarget(db, { name });
      await assignTo(targetId);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: '#000000AA' }}
        onPress={onClose}
        accessibilityLabel="Close"
      />
      <View
        style={{
          backgroundColor: colors.surface,
          borderTopLeftRadius: radius.xl,
          borderTopRightRadius: radius.xl,
          padding: spacing.lg,
          maxHeight: '75%',
          borderTopWidth: 1,
          borderColor: colors.border,
        }}
      >
        <Txt variant="heading">Assign to</Txt>
        <Txt variant="mono" color={colors.crypto} style={{ marginTop: 2, marginBottom: spacing.md }}>
          {assignment.label}
        </Txt>

        <Input
          value={query}
          onChangeText={setQuery}
          placeholder="Search or type a new target name"
          autoFocus
        />

        <ScrollView
          style={{ flexShrink: 1 }}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: spacing.sm }}
        >
          {(targets ?? []).map((target) => (
            <View key={target.id}>
              <Pressable
                onPress={() => assignTo(target.id)}
                disabled={busy}
                style={({ pressed }) => ({
                  paddingVertical: spacing.md,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Row>
                  <View style={{ flex: 1 }}>
                    <Txt variant="bodyStrong">{target.name}</Txt>
                    <Txt variant="caption" color={colors.textFaint} style={{ marginTop: 2 }}>
                      Level {target.level} · {formatExact(target.crypto)} held ·{' '}
                      {plural(target.ipCount, 'IP')}
                    </Txt>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
                </Row>
              </Pressable>
              <Divider style={{ marginVertical: 0 }} />
            </View>
          ))}
        </ScrollView>

        {query.trim().length > 0 && (targets ?? []).length === 0 ? (
          <Button
            label={`Create "${query.trim()}" and assign`}
            onPress={createAndAssign}
            loading={busy}
            style={{ marginTop: spacing.md }}
          />
        ) : null}

        <Button
          label="Cancel"
          variant="ghost"
          onPress={onClose}
          style={{ marginTop: spacing.md }}
        />
      </View>
    </Modal>
  );
}
