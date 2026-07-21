import { useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSQLiteContext } from 'expo-sqlite';
import { searchEverything, type SearchResult, type SearchResultKind } from '@/db/repo/search';
import { Card, Chip, EmptyState, Input, Loading, Row, Txt } from '@/ui/components';
import { colors, radius, spacing } from '@/ui/theme';
import { plural } from '@/ui/format';
import { useTheme } from '@/components/ThemeProvider';

const KIND_ICON: Record<SearchResultKind, keyof typeof Ionicons.glyphMap> = {
  TARGET: 'person',
  IP: 'globe',
  WALLET: 'wallet',
  SOFTWARE: 'cube',
  LOG: 'document-text',
  NOTE: 'create',
  TAG: 'pricetag',
};

// A function, not a constant: colors.accent changes with the theme.
const kindColor = (kind: SearchResultKind): string =>
  ({
    TARGET: colors.accent,
    IP: colors.info,
    WALLET: colors.crypto,
    SOFTWARE: colors.purple,
    LOG: colors.textMuted,
    NOTE: colors.orange,
    TAG: colors.pink,
  })[kind];

const FILTERS: (SearchResultKind | 'ALL')[] = [
  'ALL',
  'TARGET',
  'IP',
  'WALLET',
  'SOFTWARE',
  'LOG',
];

export default function SearchScreen() {
  useTheme();
  const db = useSQLiteContext();
  const router = useRouter();

  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<SearchResultKind | 'ALL'>('ALL');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (query.trim().length === 0) {
      setResults([]);
      return;
    }

    let cancelled = false;
    setSearching(true);

    const timer = setTimeout(async () => {
      try {
        const found = await searchEverything(db, query);
        if (!cancelled) setResults(found);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, db]);

  const visible = kind === 'ALL' ? results : results.filter((r) => r.kind === kind);

  const openResult = (result: SearchResult) => {
    if (result.targetId !== null) router.push(`/target/${result.targetId}`);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ padding: spacing.lg, paddingBottom: spacing.sm }}>
        <Input
          value={query}
          onChangeText={setQuery}
          placeholder="Search anything: name, IP, wallet, software, log text…"
          autoCapitalize="none"
          autoFocus
          style={{ marginBottom: spacing.md }}
        />

        {results.length > 0 ? (
          <Row gap={spacing.xs} wrap>
            {FILTERS.map((option) => {
              const count =
                option === 'ALL'
                  ? results.length
                  : results.filter((r) => r.kind === option).length;
              if (count === 0 && option !== 'ALL') return null;
              return (
                <Chip
                  key={option}
                  label={option === 'ALL' ? `All ${count}` : `${option} ${count}`}
                  size="sm"
                  color={option === 'ALL' ? colors.textMuted : kindColor(option)}
                  selected={kind === option}
                  onPress={() => setKind(option)}
                />
              );
            })}
          </Row>
        ) : null}
      </View>

      {searching && results.length === 0 ? (
        <Loading label="Searching…" />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item, index) => `${item.kind}-${item.title}-${index}`}
          contentContainerStyle={{
            paddingHorizontal: spacing.lg,
            paddingBottom: spacing.xxl * 2,
            gap: spacing.sm,
          }}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <Card onPress={item.targetId !== null ? () => openResult(item) : undefined} padded={false}>
              <Row style={{ padding: spacing.md }} gap={spacing.md}>
                <View
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: radius.sm,
                    backgroundColor: `${kindColor(item.kind)}1F`,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name={KIND_ICON[item.kind]} size={16} color={kindColor(item.kind)} />
                </View>

                <View style={{ flex: 1 }}>
                  <Txt
                    variant={item.kind === 'LOG' ? 'mono' : 'bodyStrong'}
                    numberOfLines={item.kind === 'LOG' ? 2 : 1}
                  >
                    {item.title}
                  </Txt>
                  <Txt
                    variant="caption"
                    color={colors.textFaint}
                    style={{ marginTop: 2 }}
                    numberOfLines={1}
                  >
                    {item.subtitle}
                  </Txt>
                </View>

                {item.targetId !== null ? (
                  <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
                ) : null}
              </Row>
            </Card>
          )}
          ListHeaderComponent={
            visible.length > 0 ? (
              <Txt variant="caption" color={colors.textFaint} style={{ marginBottom: spacing.xs }}>
                {plural(visible.length, 'result')}
              </Txt>
            ) : null
          }
          ListEmptyComponent={
            query.trim().length === 0 ? (
              <EmptyState
                title="Search everything"
                message="One box covers target names, devices, IP addresses, wallet addresses, installed software, tags, notes and the raw text of every log line you have imported. Numbers match levels, crypto amounts and scores."
              />
            ) : (
              <EmptyState
                title="Nothing found"
                message={`No matches for "${query}".`}
              />
            )
          }
        />
      )}
    </View>
  );
}
