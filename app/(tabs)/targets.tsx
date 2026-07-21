import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@/db/useQuery';
import { listTargetSummaries, type TargetSort } from '@/db/repo/targets';
import { Card, Chip, EmptyState, Input, Loading, Row, Txt } from '@/ui/components';
import {
  activityColor,
  activityLabel,
  colors,
  radius,
  recommendationColor,
  recommendationLabel,
  scoreColor,
  spacing,
  tierColor,
  trendColor,
} from '@/ui/theme';
import { formatCrypto, plural, timeAgo } from '@/ui/format';
import { useTheme } from '@/components/ThemeProvider';
import type { ActivityState, TargetSummary } from '@/db/types';

const SORTS: { key: TargetSort; label: string }[] = [
  { key: 'score', label: 'Score' },
  { key: 'crypto', label: 'Crypto' },
  { key: 'extracted', label: 'Earned' },
  { key: 'level', label: 'Level' },
  { key: 'recent', label: 'Recent' },
  { key: 'name', label: 'A–Z' },
];

const ACTIVITIES: ActivityState[] = ['ACTIVE', 'SEMI_ACTIVE', 'REVIEW', 'INACTIVE'];

export default function TargetsScreen() {
  useTheme();
  const router = useRouter();
  const [sort, setSort] = useState<TargetSort>('score');
  const [activity, setActivity] = useState<ActivityState | null>(null);
  const [query, setQuery] = useState('');

  const { data, loading, refresh } = useQuery(
    (db) => listTargetSummaries(db, { sort, activity, query }),
    [sort, activity, query],
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ padding: spacing.lg, paddingBottom: spacing.sm }}>
        <Input
          value={query}
          onChangeText={setQuery}
          placeholder="Filter by name or device"
          autoCapitalize="none"
          style={{ marginBottom: spacing.md }}
        />

        <Row gap={spacing.xs} wrap style={{ marginBottom: spacing.sm }}>
          {SORTS.map((option) => (
            <Chip
              key={option.key}
              label={option.label}
              size="sm"
              color={colors.accent}
              selected={sort === option.key}
              onPress={() => setSort(option.key)}
            />
          ))}
        </Row>

        <Row gap={spacing.xs} wrap>
          <Chip
            label="All"
            size="sm"
            color={colors.textMuted}
            selected={activity === null}
            onPress={() => setActivity(null)}
          />
          {ACTIVITIES.map((state) => (
            <Chip
              key={state}
              label={activityLabel[state]}
              size="sm"
              color={activityColor[state]}
              selected={activity === state}
              onPress={() => setActivity(activity === state ? null : state)}
            />
          ))}
        </Row>
      </View>

      {loading && !data ? (
        <Loading />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{
            paddingHorizontal: spacing.lg,
            paddingBottom: spacing.xxl * 2,
            gap: spacing.sm,
          }}
          refreshControl={
            <RefreshControl refreshing={false} onRefresh={refresh} tintColor={colors.accent} />
          }
          renderItem={({ item }) => (
            <TargetRow target={item} onPress={() => router.push(`/target/${item.id}`)} />
          )}
          ListEmptyComponent={
            <EmptyState
              title={query || activity ? 'Nothing matches' : 'No targets yet'}
              message={
                query || activity
                  ? 'Try clearing the filters above.'
                  : 'Import your logs or tap + to add a target by hand.'
              }
            />
          }
          ListHeaderComponent={
            data && data.length > 0 ? (
              <Txt variant="caption" color={colors.textFaint} style={{ marginBottom: spacing.xs }}>
                {plural(data.length, 'target')}
              </Txt>
            ) : null
          }
        />
      )}

      <Pressable
        onPress={() => router.push('/target/new')}
        accessibilityLabel="Add a target"
        accessibilityRole="button"
        style={({ pressed }) => ({
          position: 'absolute',
          right: spacing.lg,
          bottom: spacing.lg,
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: colors.accent,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.8 : 1,
          // Android uses elevation; iOS ignores it and needs the explicit shadow.
          elevation: 4,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.35,
          shadowRadius: 5,
        })}
      >
        <Ionicons name="add" size={28} color={colors.accentText} />
      </Pressable>
    </View>
  );
}

function TargetRow({ target, onPress }: { target: TargetSummary; onPress: () => void }) {
  const tier = target.yieldTier;
  const trending = target.trendDirection === 'RISING' || target.trendDirection === 'DECLINING';

  return (
    <Card onPress={onPress} padded={false}>
      <View style={{ padding: spacing.md }}>
        <Row gap={spacing.md}>
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: radius.md,
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
            <Row gap={spacing.sm} wrap>
              <Txt variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
                {target.name}
              </Txt>
              {tier ? <Chip label={tier} color={tierColor[tier]} selected size="sm" /> : null}
              <Chip
                label={recommendationLabel[target.recommendation]}
                color={recommendationColor[target.recommendation]}
                selected
                size="sm"
              />
            </Row>

            {target.ip ? (
              <Txt
                variant="mono"
                color={colors.textFaint}
                numberOfLines={1}
                style={{ marginTop: 2, fontSize: 12 }}
              >
                {target.ip}
              </Txt>
            ) : null}

            <Row gap={spacing.md} style={{ marginTop: 3 }} wrap>
              <Txt variant="caption" color={colors.textFaint}>
                Lv {target.level}
              </Txt>
              <Txt variant="caption" color={colors.crypto}>
                {formatCrypto(target.crypto)} held
              </Txt>
              {target.extractedTotal > 0 ? (
                <Txt variant="caption" color={colors.textFaint}>
                  {formatCrypto(target.extractedTotal)} taken
                </Txt>
              ) : null}
              {trending ? (
                <Txt variant="caption" color={trendColor(target.trendDirection)}>
                  {target.trendPercent > 0 ? `+${target.trendPercent}` : target.trendPercent}%
                </Txt>
              ) : null}
            </Row>
          </View>

          <View style={{ alignItems: 'flex-end' }}>
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: activityColor[target.activity],
              }}
            />
            <Txt variant="caption" color={colors.textFaint} style={{ marginTop: spacing.xs }}>
              {timeAgo(target.lastActivityAt ?? target.dateAdded)}
            </Txt>
          </View>
        </Row>

        {target.tags.length > 0 || target.ipCount > 0 ? (
          <Row gap={spacing.xs} wrap style={{ marginTop: spacing.sm }}>
            {target.tags.slice(0, 4).map((tag) => (
              <Chip
                key={tag.id}
                label={tag.name}
                color={tag.color ?? colors.textMuted}
                selected
                size="sm"
              />
            ))}
            {target.tags.length > 4 ? (
              <Txt variant="caption" color={colors.textFaint}>
                +{target.tags.length - 4}
              </Txt>
            ) : null}
            {target.ipCount > 0 ? (
              <Txt variant="caption" color={colors.textFaint}>
                {plural(target.ipCount, 'IP')}
              </Txt>
            ) : null}
            {target.softwareCount > 0 ? (
              <Txt variant="caption" color={colors.textFaint}>
                · {plural(target.softwareCount, 'app')}
              </Txt>
            ) : null}
          </Row>
        ) : null}
      </View>
    </Card>
  );
}
