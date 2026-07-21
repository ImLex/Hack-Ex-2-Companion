import { useState } from 'react';
import { Alert, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSQLiteContext } from 'expo-sqlite';
import { parseLogText, type ParsedLine } from '@/logic/parser';
import { ingestParsedLines, previewIngest, type IngestPreview, type IngestReport } from '@/logic/ingest';
import { findExistingHashes } from '@/db/repo/logs';
import { getTarget } from '@/db/repo/targets';
import {
  Button,
  Card,
  Chip,
  Divider,
  Input,
  Row,
  Screen,
  Section,
  StatTile,
  Txt,
} from '@/ui/components';
import { colors, eventColor, humanise, spacing } from '@/ui/theme';
import { formatExact, plural } from '@/ui/format';
import { useTheme } from '@/components/ThemeProvider';

export default function ImportScreen() {
  useTheme();
  const db = useSQLiteContext();
  const router = useRouter();

  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<ParsedLine[] | null>(null);
  const [preview, setPreview] = useState<IngestPreview | null>(null);
  const [targetNames, setTargetNames] = useState<Record<number, string>>({});
  const [report, setReport] = useState<IngestReport | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setText('');
    setParsed(null);
    setPreview(null);
    setReport(null);
    setTargetNames({});
  };

  const handlePreview = async () => {
    if (text.trim().length === 0) return;
    setBusy(true);
    try {
      const result = parseLogText(text);
      const existing = await findExistingHashes(
        db,
        result.lines.map((l) => l.hash),
      );
      const built = await previewIngest(db, result.lines, existing);

      const names: Record<number, string> = {};
      for (const entry of built.knownTargets) {
        const target = await getTarget(db, entry.targetId);
        if (target) names[entry.targetId] = target.name;
      }

      setParsed(result.lines);
      setPreview(built);
      setTargetNames(names);
      setReport(null);
    } catch (error) {
      Alert.alert('Could not read those logs', String(error));
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async () => {
    if (!parsed) return;
    setBusy(true);
    try {
      const result = await ingestParsedLines(db, parsed);
      setReport(result);
      setPreview(null);
      setParsed(null);
      setText('');
    } catch (error) {
      Alert.alert('Import failed', String(error));
    } finally {
      setBusy(false);
    }
  };

  if (report) {
    return (
      <Screen>
        <Card style={{ marginBottom: spacing.lg }}>
          <Row gap={spacing.md}>
            <Ionicons name="checkmark-circle" size={28} color={colors.success} />
            <View style={{ flex: 1 }}>
              <Txt variant="heading">Import finished</Txt>
              <Txt variant="caption" color={colors.textFaint} style={{ marginTop: 2 }}>
                {plural(report.logsInserted, 'new log line')} stored
                {report.duplicatesSkipped > 0
                  ? `, ${report.duplicatesSkipped} already had`
                  : ''}
              </Txt>
            </View>
          </Row>
        </Card>

        <Row gap={spacing.sm} wrap style={{ marginBottom: spacing.lg }}>
          <StatTile
            label="Crypto recorded"
            value={formatExact(report.cryptoTotalAdded)}
            color={colors.crypto}
            hint={plural(report.cryptoEventsAdded, 'event')}
          />
          <StatTile label="IPs" value={report.ipsRecorded} />
          <StatTile
            label="Wallets"
            value={report.walletsRecorded}
            hint={report.walletsCracked > 0 ? `${report.walletsCracked} cracked` : undefined}
          />
        </Row>

        {report.targetsCreated.length > 0 ? (
          <Section
            title="New targets"
            subtitle="Created from addresses that belonged to nobody you track. Each is marked for review."
          >
            <Card padded={false}>
              {report.targetsCreated.map((entry, index) => (
                <View key={entry.targetId}>
                  {index > 0 ? <Divider style={{ marginVertical: 0 }} /> : null}
                  <Card
                    padded={false}
                    onPress={() => router.push(`/target/${entry.targetId}`)}
                    style={{ borderWidth: 0, backgroundColor: 'transparent' }}
                  >
                    <Row style={{ padding: spacing.md }} gap={spacing.sm}>
                      <Txt variant="mono" style={{ flex: 1 }} numberOfLines={1}>
                        {entry.name}
                      </Txt>
                      <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
                    </Row>
                  </Card>
                </View>
              ))}
            </Card>
          </Section>
        ) : null}

        {report.reviewsRaised > 0 ? (
          <Card style={{ marginBottom: spacing.lg }} onPress={() => router.push('/review')}>
            <Row gap={spacing.md}>
              <Ionicons name="alert-circle" size={24} color={colors.warning} />
              <View style={{ flex: 1 }}>
                <Txt variant="bodyStrong">{plural(report.reviewsRaised, 'item')} needs review</Txt>
                <Txt variant="caption" color={colors.textFaint} style={{ marginTop: 2 }}>
                  {report.unassignedWallets.length > 0
                    ? `${plural(report.unassignedWallets.length, 'wallet')} with no known owner. Assign them and their crypto is credited automatically.`
                    : 'Some lines could not be matched to a target.'}
                </Txt>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textFaint} />
            </Row>
          </Card>
        ) : null}

        <Row gap={spacing.sm}>
          <Button label="Import more" onPress={reset} full />
          <Button
            label="See targets"
            variant="secondary"
            onPress={() => router.push('/targets')}
            full
          />
        </Row>
      </Screen>
    );
  }

  if (preview && parsed) {
    const nothingNew = preview.newLines === 0;

    return (
      <Screen>
        <Section title="Ready to import" subtitle="Nothing has been saved yet">
          <Row gap={spacing.sm} wrap>
            <StatTile label="New lines" value={preview.newLines} color={colors.accent} />
            <StatTile
              label="Duplicates"
              value={preview.duplicateLines}
              hint={preview.duplicateLines > 0 ? 'will be skipped' : undefined}
            />
            <StatTile
              label="Crypto"
              value={formatExact(preview.cryptoTotal)}
              color={colors.crypto}
            />
          </Row>
        </Section>

        {nothingNew ? (
          <Card style={{ marginBottom: spacing.lg }}>
            <Row gap={spacing.md}>
              <Ionicons name="information-circle" size={24} color={colors.info} />
              <Txt variant="body" style={{ flex: 1 }}>
                Every one of these lines is already in your database. Importing again would change
                nothing.
              </Txt>
            </Row>
          </Card>
        ) : null}

        {Object.keys(preview.byEventType).length > 0 ? (
          <Section title="What is in these logs">
            <Card>
              {Object.entries(preview.byEventType)
                .sort((a, b) => b[1] - a[1])
                .map(([eventType, count], index) => (
                  <View key={eventType}>
                    {index > 0 ? <Divider style={{ marginVertical: spacing.sm }} /> : null}
                    <Row>
                      <View
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 4,
                          backgroundColor: eventColor(eventType),
                          marginRight: spacing.sm,
                        }}
                      />
                      <Txt variant="body" style={{ flex: 1 }}>
                        {humanise(eventType)}
                      </Txt>
                      <Txt variant="bodyStrong" color={colors.textMuted}>
                        {count}
                      </Txt>
                    </Row>
                  </View>
                ))}
            </Card>
          </Section>
        ) : null}

        {preview.knownTargets.length > 0 ? (
          <Section title="Targets these logs belong to">
            <Card>
              {preview.knownTargets.map((entry, index) => (
                <View key={entry.targetId}>
                  {index > 0 ? <Divider style={{ marginVertical: spacing.sm }} /> : null}
                  <Row>
                    <Txt variant="body" style={{ flex: 1 }} numberOfLines={1}>
                      {targetNames[entry.targetId] ?? `Target ${entry.targetId}`}
                    </Txt>
                    <Txt variant="caption" color={colors.textFaint}>
                      {plural(entry.lines, 'line')}
                    </Txt>
                  </Row>
                </View>
              ))}
            </Card>
          </Section>
        ) : null}

        {preview.targetsToCreate.length > 0 ? (
          <Section
            title="New targets"
            subtitle="An IP belonging to nobody you track becomes a target of its own, named after the address and marked for review"
          >
            <Card>
              <Txt variant="label" color={colors.textMuted}>
                {plural(preview.targetsToCreate.length, 'target')} will be created
              </Txt>
              <Row gap={spacing.xs} wrap style={{ marginTop: spacing.sm }}>
                {preview.targetsToCreate.slice(0, 12).map((ip) => (
                  <Chip key={ip} label={ip} size="sm" color={colors.info} />
                ))}
                {preview.targetsToCreate.length > 12 ? (
                  <Txt variant="caption" color={colors.textFaint}>
                    +{preview.targetsToCreate.length - 12} more
                  </Txt>
                ) : null}
              </Row>
              <Txt variant="caption" color={colors.textFaint} style={{ marginTop: spacing.sm }}>
                Rename them once you know who they are. Everything found on the same lines —
                software, crypto, attack counts — is attached to them straight away.
              </Txt>
            </Card>
          </Section>
        ) : null}

        {preview.unknownWallets.length > 0 ? (
          <Section
            title="Wallets that need an owner"
            subtitle="Sent to the review inbox rather than guessed at"
          >
            <Card>
              <Txt variant="label" color={colors.textMuted}>
                {plural(preview.unknownWallets.length, 'unknown wallet')}
              </Txt>
              <Txt variant="caption" color={colors.textFaint} style={{ marginTop: 2 }}>
                Crypto lines never contain an IP. Most are matched to a target by their timestamp;
                these are the ones where more than one target shares that timestamp, so you get to
                decide.
              </Txt>
              <Row gap={spacing.xs} wrap style={{ marginTop: spacing.sm }}>
                {preview.unknownWallets.slice(0, 12).map((wallet) => (
                  <Chip key={wallet} label={wallet} size="sm" color={colors.crypto} />
                ))}
                {preview.unknownWallets.length > 12 ? (
                  <Txt variant="caption" color={colors.textFaint}>
                    +{preview.unknownWallets.length - 12} more
                  </Txt>
                ) : null}
              </Row>
            </Card>
          </Section>
        ) : null}

        {preview.lowConfidence > 0 ? (
          <Card style={{ marginBottom: spacing.lg }}>
            <Row gap={spacing.md}>
              <Ionicons name="help-circle" size={22} color={colors.warning} />
              <Txt variant="caption" color={colors.textMuted} style={{ flex: 1 }}>
                {plural(preview.lowConfidence, 'line')} could not be read confidently. They will be
                stored but not applied, so you can decide what to do with them.
              </Txt>
            </Row>
          </Card>
        ) : null}

        <Row gap={spacing.sm}>
          <Button
            label={nothingNew ? 'Nothing to import' : `Import ${preview.newLines} lines`}
            onPress={handleImport}
            loading={busy}
            disabled={nothingNew}
            full
          />
          <Button label="Back" variant="secondary" onPress={() => setPreview(null)} />
        </Row>
      </Screen>
    );
  }

  return (
    <Screen>
      <Section
        title="Paste your logs"
        subtitle="Copy them straight out of the game — the format is understood as-is"
      >
        <Input
          value={text}
          onChangeText={setText}
          multiline
          autoCapitalize="none"
          placeholder={'[7-18 19:00] Uploaded Lv3 Siphon to 216.22.206.218\n[7-18 18:00] Stole 172 Crypto from hx84d9...762d'}
          hint="Duplicate lines are detected automatically, so it is safe to paste overlapping logs."
        />
        <Button
          label="Read these logs"
          onPress={handlePreview}
          loading={busy}
          disabled={text.trim().length === 0}
        />
      </Section>

      <Section title="What gets picked up">
        <Card>
          {[
            ['Accessed device at …', 'Links the IP to a target'],
            ['Cracked / failed password', 'Records the attempt and any encryptor'],
            ['Bypassed firewall on …', 'Proves the target runs a firewall'],
            ['Uploaded Lv3 Siphon to …', 'Records the software and its level'],
            ['Stole 172 Crypto from …', 'Adds to crypto history via the wallet'],
          ].map(([pattern, meaning], index) => (
            <View key={pattern}>
              {index > 0 ? <Divider style={{ marginVertical: spacing.sm }} /> : null}
              <Txt variant="mono" color={colors.textMuted}>
                {pattern}
              </Txt>
              <Txt variant="caption" color={colors.textFaint} style={{ marginTop: 2 }}>
                {meaning}
              </Txt>
            </View>
          ))}
        </Card>
      </Section>
    </Screen>
  );
}
