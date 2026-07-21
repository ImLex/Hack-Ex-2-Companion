// Your own virus deployments (spam + siphon), read automatically off the
// game's SPAM EARNINGS / SIPHON EARNINGS panels on the APPS screen.

import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import {
  getSiphonSummary,
  getSpamSummary,
  listVirusDeployments,
  type VirusDeployment,
} from '@/db/repo/virus';
import { useQuery } from '@/db/useQuery';
import { Card, Chip, Divider, Row, Screen, Section, StatTile, Txt } from '@/ui/components';
import { colors, spacing } from '@/ui/theme';
import { formatExact, plural, timeAgo } from '@/ui/format';
import { useTheme } from '@/components/ThemeProvider';

function ageLabel(ageDays: number | null): string {
  if (ageDays === null) return '';
  if (ageDays === 0) return 'today';
  if (ageDays < 1) return `${Math.round(ageDays * 24)}h`;
  return `${Math.round(ageDays)}d`;
}

function DeploymentRow({ deployment }: { deployment: VirusDeployment }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const muted = !deployment.active;

  const copyAddress = async () => {
    await Clipboard.setStringAsync(deployment.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const rateText =
    deployment.kind === 'SPAM'
      ? deployment.ratePerHour !== null
        ? `${formatExact(deployment.ratePerHour)}/hr`
        : ''
      : deployment.percent !== null
        ? `${deployment.percent}%`
        : '';

  const body = (
    <Row gap={spacing.sm}>
      <View style={{ flex: 1 }}>
        <Pressable
          onPress={copyAddress}
          hitSlop={8}
          accessibilityLabel={`Copy ${deployment.address}`}
        >
          <Row gap={spacing.xs}>
            <Txt
              variant="mono"
              color={muted ? colors.textFaint : colors.text}
              numberOfLines={1}
              style={{ flexShrink: 1 }}
            >
              {deployment.address}
            </Txt>
            <Ionicons
              name={copied ? 'checkmark' : 'copy-outline'}
              size={13}
              color={copied ? colors.success : colors.textFaint}
            />
          </Row>
        </Pressable>
        <Row gap={spacing.sm} style={{ marginTop: 2 }}>
          {deployment.targetName ? (
            <Txt variant="caption" color={colors.accent} numberOfLines={1}>
              {deployment.targetName}
            </Txt>
          ) : null}
          {deployment.level !== null ? (
            <Txt variant="caption" color={colors.textFaint}>
              LV.{deployment.level}
            </Txt>
          ) : null}
          <Txt variant="caption" color={colors.textFaint}>
            {muted ? `last seen ${timeAgo(deployment.lastSeen)}` : ageLabel(deployment.ageDays)}
          </Txt>
        </Row>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Txt variant="bodyStrong" color={muted ? colors.textFaint : colors.crypto}>
          {formatExact(deployment.earned)}
        </Txt>
        {rateText ? (
          <Txt variant="caption" color={colors.textFaint}>
            {rateText}
          </Txt>
        ) : null}
      </View>
      {deployment.targetId !== null ? (
        <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
      ) : null}
    </Row>
  );

  if (deployment.targetId === null) {
    return <View style={{ paddingVertical: spacing.sm }}>{body}</View>;
  }
  return (
    <Card
      padded={false}
      onPress={() => router.push(`/target/${deployment.targetId}`)}
      style={{ borderWidth: 0, backgroundColor: 'transparent' }}
    >
      <View style={{ paddingVertical: spacing.sm }}>{body}</View>
    </Card>
  );
}

function DeploymentList({
  deployments,
  emptyText,
}: {
  deployments: VirusDeployment[];
  emptyText: string;
}) {
  const active = deployments.filter((d) => d.active);
  const inactive = deployments.filter((d) => !d.active);

  return (
    <>
      <Card>
        {active.length === 0 ? (
          <Txt variant="caption" color={colors.textFaint}>
            {emptyText}
          </Txt>
        ) : (
          active.map((deployment, index) => (
            <View key={deployment.id}>
              {index > 0 ? <Divider style={{ marginVertical: 0 }} /> : null}
              <DeploymentRow deployment={deployment} />
            </View>
          ))
        )}
      </Card>
      {inactive.length > 0 ? (
        <>
          <Txt
            variant="label"
            color={colors.textFaint}
            style={{ marginTop: spacing.md, marginBottom: spacing.sm }}
          >
            No longer deployed — earnings stay on record
          </Txt>
          <Card>
            {inactive.map((deployment, index) => (
              <View key={deployment.id}>
                {index > 0 ? <Divider style={{ marginVertical: 0 }} /> : null}
                <DeploymentRow deployment={deployment} />
              </View>
            ))}
          </Card>
        </>
      ) : null}
    </>
  );
}

export default function VirusScreen() {
  useTheme();
  const { data: spamSummary } = useQuery((db) => getSpamSummary(db));
  const { data: siphonSummary } = useQuery((db) => getSiphonSummary(db));
  const { data: spam } = useQuery((db) => listVirusDeployments(db, 'SPAM'));
  const { data: siphon } = useQuery((db) => listVirusDeployments(db, 'SIPHON'));

  const nothingYet =
    spamSummary === null &&
    siphonSummary === null &&
    (spam?.length ?? 0) === 0 &&
    (siphon?.length ?? 0) === 0;

  if (nothingYet) {
    return (
      <Screen>
        <Section title="Virus deployments">
          <Card>
            <Row gap={spacing.md}>
              <Ionicons name="bug" size={24} color={colors.textMuted} />
              <Txt variant="body" style={{ flex: 1 }}>
                Nothing captured yet. In the game, open APPS and tap the Spam or Siphon row so its
                earnings panel unfolds — the reader takes it from there.
              </Txt>
            </Row>
          </Card>
        </Section>
      </Screen>
    );
  }

  const spamActive = (spam ?? []).filter((d) => d.active);
  const siphonActive = (siphon ?? []).filter((d) => d.active);

  return (
    <Screen>
      <Section
        title="Spam"
        subtitle={spamSummary ? `As of ${timeAgo(spamSummary.capturedAt)}` : undefined}
        action={<Chip label={plural(spamActive.length, 'device')} size="sm" />}
      >
        {spamSummary ? (
          <>
            <Row gap={spacing.sm} wrap style={{ marginBottom: spacing.md }}>
              <StatTile
                label="Deployed"
                value={
                  spamSummary.slotsUsed !== null && spamSummary.slotsTotal !== null
                    ? `${spamSummary.slotsUsed}/${spamSummary.slotsTotal}`
                    : (spamSummary.deployed ?? spamActive.length)
                }
                hint={spamSummary.botnet ?? undefined}
              />
              <StatTile
                label="Rate"
                value={
                  spamSummary.ratePerHour !== null
                    ? `${formatExact(spamSummary.ratePerHour)}/hr`
                    : '—'
                }
                color={colors.accent}
              />
              <StatTile
                label="Daily"
                value={spamSummary.dailyRate !== null ? formatExact(spamSummary.dailyRate) : '—'}
                color={colors.crypto}
                hint={
                  spamSummary.dailyFees !== null
                    ? `- ${formatExact(spamSummary.dailyFees)} fees`
                    : undefined
                }
              />
            </Row>
            {spamSummary.totalEarned !== null ? (
              <Card style={{ marginBottom: spacing.md }}>
                <Row>
                  <Txt variant="body" style={{ flex: 1 }}>
                    Earned by current deployments
                  </Txt>
                  <Txt variant="bodyStrong" color={colors.crypto}>
                    {formatExact(spamSummary.totalEarned)}
                  </Txt>
                </Row>
                {spamSummary.feePercent !== null ? (
                  <Txt variant="caption" color={colors.textFaint} style={{ marginTop: spacing.xs }}>
                    {spamSummary.botnet ? `Botnet ${spamSummary.botnet} takes` : 'The botnet takes'}{' '}
                    {spamSummary.feePercent}% of everything collected.
                  </Txt>
                ) : null}
              </Card>
            ) : null}
          </>
        ) : null}
        <DeploymentList
          deployments={spam ?? []}
          emptyText="No spam captured yet — open the SPAM EARNINGS panel in the game."
        />
      </Section>

      <Section
        title="Siphon"
        subtitle={siphonSummary ? `As of ${timeAgo(siphonSummary.capturedAt)}` : undefined}
        action={<Chip label={plural(siphonActive.length, 'device')} size="sm" />}
      >
        {siphonSummary ? (
          <Row gap={spacing.sm} wrap style={{ marginBottom: spacing.md }}>
            <StatTile label="Deployed" value={siphonSummary.deployed ?? siphonActive.length} />
            <StatTile
              label="Total siphoned"
              value={
                siphonSummary.totalSiphoned !== null
                  ? formatExact(siphonSummary.totalSiphoned)
                  : '—'
              }
              color={colors.crypto}
            />
          </Row>
        ) : null}
        <DeploymentList
          deployments={siphon ?? []}
          emptyText="No siphons captured yet — open the SIPHON EARNINGS panel in the game."
        />
      </Section>

      <Txt variant="caption" color={colors.textFaint} style={{ textAlign: 'center' }}>
        Tap a row to open its target. Devices behind a full proxy mask cannot be tracked.
      </Txt>
    </Screen>
  );
}
