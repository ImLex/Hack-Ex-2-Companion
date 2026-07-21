import { useMemo } from 'react';
import { RefreshControl, View } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@/db/useQuery';
import { getDashboardStats } from '@/db/repo/stats';
import {
  Button,
  Card,
  Chip,
  Divider,
  EmptyState,
  Loading,
  Row,
  Screen,
  Section,
  StatTile,
  Txt,
} from '@/ui/components';
import { BreakdownBar, DailyCryptoChart, RankBar } from '@/ui/Charts';
import { activityColor, activityLabel, colors, scoreColor, spacing } from '@/ui/theme';
import { formatCrypto, formatExact, plural, timeAgo } from '@/ui/format';
import { useTheme } from '@/components/ThemeProvider';
import { useAccounts } from '@/components/AccountProvider';
import type { ActivityState } from '@/db/types';

export default function DashboardScreen() {
  useTheme();
  const { activeAccount } = useAccounts();
  const router = useRouter();
  const { data, loading, refresh } = useQuery((db) => getDashboardStats(db));

  const activitySegments = useMemo(() => {
    if (!data) return [];
    const order: ActivityState[] = ['ACTIVE', 'SEMI_ACTIVE', 'REVIEW', 'INACTIVE'];
    return order.map((state) => ({
      label: activityLabel[state],
      value: data.activityCounts[state],
      color: activityColor[state],
    }));
  }, [data]);

  if (loading && !data) return <Loading label="Opening database…" />;
  if (!data) return null;

  const isEmpty = data.targetCount === 0;
  const maxEarned = Math.max(...data.topEarners.map((t) => t.extractedTotal), 1);

  return (
    <Screen
      refreshControl={
        <RefreshControl refreshing={false} onRefresh={refresh} tintColor={colors.accent} />
      }
    >
      <Row gap={spacing.xs} style={{ marginBottom: spacing.md }}>
        <Ionicons name="person-circle-outline" size={18} color={colors.accent} />
        <Txt variant="label" color={colors.textMuted}>
          {activeAccount.name ?? 'Account not named yet'}
        </Txt>
      </Row>

      {isEmpty ? (
        <Card style={{ marginBottom: spacing.xl }}>
          <EmptyState
            title="Nothing tracked yet"
            message="Turn on the game reader in Settings and just play — the database builds itself. Or paste logs by hand, or add a target to start."
            action={
              <Row gap={spacing.sm}>
                <Button label="Import logs" onPress={() => router.push('/import')} />
                <Button
                  label="Add target"
                  variant="secondary"
                  onPress={() => router.push('/target/new')}
                />
              </Row>
            }
          />
        </Card>
      ) : null}

      <Section
        title="Crypto earned"
        subtitle={`${plural(data.totals.eventCount, 'extraction')} recorded — hauls found in imported logs and attacks logged in the app`}
      >
        <Row gap={spacing.sm} style={{ marginBottom: spacing.md }}>
          <StatTile
            label="Today"
            value={formatCrypto(data.totals.extractedToday)}
            color={colors.crypto}
          />
          <StatTile label="7 days" value={formatCrypto(data.totals.extracted7Days)} />
          <StatTile label="All time" value={formatCrypto(data.totals.extractedTotal)} />
        </Row>

        <Card>
          <DailyCryptoChart data={data.daily} />
          {data.totals.eventCount > 0 ? (
            <>
              <Divider />
              <Row gap={spacing.lg} wrap>
                <Txt variant="caption" color={colors.textFaint}>
                  Average {formatCrypto(data.totals.averagePerActiveDay)} per active day
                </Txt>
                <Txt variant="caption" color={colors.textFaint}>
                  Last {timeAgo(data.totals.lastExtraction)}
                </Txt>
              </Row>
            </>
          ) : null}
        </Card>
      </Section>

      {data.topTargets.length > 0 ? (
        <Section
          title="Best targets"
          subtitle="Ranked by potential score"
          action={
            <Link href="/targets" asChild>
              <Txt variant="label" color={colors.accent}>
                See all
              </Txt>
            </Link>
          }
        >
          <Card padded={false}>
            {data.topTargets.map((target, index) => (
              <View key={target.id}>
                {index > 0 ? <Divider style={{ marginVertical: 0 }} /> : null}
                <Card
                  padded={false}
                  onPress={() => router.push(`/target/${target.id}`)}
                  style={{ borderWidth: 0, backgroundColor: 'transparent' }}
                >
                  <Row style={{ padding: spacing.md }} gap={spacing.md}>
                    <View
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 10,
                        backgroundColor: `${scoreColor(target.potentialScore)}1F`,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Txt variant="bodyStrong" color={scoreColor(target.potentialScore)}>
                        {Math.round(target.potentialScore)}
                      </Txt>
                    </View>

                    <View style={{ flex: 1 }}>
                      <Row gap={spacing.sm}>
                        <Txt variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
                          {target.name}
                        </Txt>
                        <Chip
                          label={activityLabel[target.activity]}
                          color={activityColor[target.activity]}
                          selected
                          size="sm"
                        />
                      </Row>
                      <Txt variant="caption" color={colors.textFaint} style={{ marginTop: 2 }}>
                        Level {target.level} · {formatCrypto(target.crypto)} held ·{' '}
                        {formatCrypto(target.extractedTotal)} taken
                      </Txt>
                    </View>

                    <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
                  </Row>
                </Card>
              </View>
            ))}
          </Card>
        </Section>
      ) : null}

      {data.topEarners.length > 0 ? (
        <Section title="Biggest earners" subtitle="Crypto taken, all time">
          <Card>
            {data.topEarners.map((target, index) => (
              <View key={target.id} style={{ marginTop: index > 0 ? spacing.md : 0 }}>
                <Row style={{ marginBottom: spacing.xs }}>
                  <Txt variant="label" style={{ flex: 1 }} numberOfLines={1}>
                    {target.name}
                  </Txt>
                  <Txt variant="label" color={colors.crypto}>
                    {formatExact(target.extractedTotal)}
                  </Txt>
                </Row>
                <RankBar value={target.extractedTotal} max={maxEarned} />
              </View>
            ))}
          </Card>
        </Section>
      ) : null}

      {data.targetCount > 0 ? (
        <Section title="Target activity">
          <Card>
            <BreakdownBar segments={activitySegments} />
            <Row wrap gap={spacing.md} style={{ marginTop: spacing.md }}>
              {activitySegments.map((segment) => (
                <Row key={segment.label} gap={spacing.xs}>
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: segment.color,
                    }}
                  />
                  <Txt variant="caption" color={colors.textMuted}>
                    {segment.label} {segment.value}
                  </Txt>
                </Row>
              ))}
            </Row>
          </Card>
        </Section>
      ) : null}

      <Section title="Database">
        <Row gap={spacing.sm} wrap>
          <StatTile
            label="Targets"
            value={data.targetCount}
            onPress={() => router.push('/targets')}
          />
          <StatTile label="IPs" value={data.ipCount} />
          <StatTile label="Wallets" value={data.walletCount} />
        </Row>
        <Row gap={spacing.sm} wrap style={{ marginTop: spacing.sm }}>
          <StatTile label="Logs" value={data.logCount} />
          <StatTile label="Software" value={data.softwareCount} />
          <StatTile
            label="Last log"
            value={data.lastActivityAt ? timeAgo(data.lastActivityAt) : '—'}
          />
        </Row>
      </Section>
    </Screen>
  );
}
