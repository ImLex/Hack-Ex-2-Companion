// Shared by the create and edit screens. The IP is the identity (still stored
// in `targets.name`); pre-existing non-IP names are accepted unchanged.

import { useState } from 'react';
import { View } from 'react-native';
import { ACTIVITY_STATES, type ActivityState } from '@/db/types';
import { DEVICES } from '@/logic/devices';
import { Button, Input, Row, SegmentedControl, Select, Txt } from '@/ui/components';
import { activityLabel, colors, spacing } from '@/ui/theme';

export interface TargetFormValues {
  /** The target's IP address. Stored in `targets.name`. */
  ip: string;
  device: string;
  level: string;
  /** Optional wallet, either printed form. Only offered when creating. */
  wallet: string;
  activity: ActivityState;
  notes: string;
}

export const emptyTargetForm: TargetFormValues = {
  ip: '',
  device: '',
  level: '',
  wallet: '',
  activity: 'REVIEW',
  notes: '',
};

export function TargetForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  busy,
  showWallet,
}: {
  initial: TargetFormValues;
  submitLabel: string;
  onSubmit: (values: TargetFormValues) => void;
  onCancel?: () => void;
  busy?: boolean;
  /** On for creating; editing manages wallets on the target's own screen. */
  showWallet?: boolean;
}) {
  const [values, setValues] = useState<TargetFormValues>(initial);

  const set = <K extends keyof TargetFormValues>(key: K, value: TargetFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const canSubmit = values.ip.trim().length > 0;

  return (
    <View>
      <Input
        label="IP address"
        value={values.ip}
        onChangeText={(text) => set('ip', text)}
        placeholder="216.22.206.218"
        hint="This is how the app recognises the target in your logs."
        autoFocus={initial.ip.length === 0}
      />

      {/* Chips rather than free text stops "Nova s"/"nova S"/"NovaS" becoming three devices. */}
      <Select
        label="Device"
        value={values.device}
        options={DEVICES}
        onChange={(device) => set('device', device)}
        allowCustom
        placeholder="Something not on the list"
      />

      <Input
        label="Level"
        value={values.level}
        onChangeText={(text) => set('level', text.replace(/[^0-9]/g, ''))}
        placeholder="0"
        keyboardType="numeric"
        hint="Leave at 0 if you have not seen it yet."
      />

      {showWallet ? (
        <Input
          label="Wallet address (optional)"
          value={values.wallet}
          onChangeText={(text) => set('wallet', text)}
          placeholder="hxcf6f...173a"
          autoCapitalize="none"
          hint="Either form works. Pasting a full address marks the wallet cracked."
        />
      ) : null}

      <Txt variant="label" color={colors.textMuted} style={{ marginBottom: spacing.xs }}>
        Activity
      </Txt>
      <SegmentedControl
        options={ACTIVITY_STATES}
        value={values.activity}
        onChange={(activity) => set('activity', activity)}
        labels={activityLabel}
      />
      <Txt variant="caption" color={colors.textFaint} style={{ marginBottom: spacing.lg }}>
        How fast they clear your virus. Gone within a day is active, still running after a
        week is inactive. Leave it on needs review until you have watched one.
      </Txt>

      <Input
        label="Notes"
        value={values.notes}
        onChangeText={(text) => set('notes', text)}
        placeholder="Anything worth remembering about this target"
        multiline
      />

      <Row gap={spacing.sm}>
        <Button
          label={submitLabel}
          onPress={() => onSubmit(values)}
          disabled={!canSubmit}
          loading={busy}
          full
        />
        {onCancel ? <Button label="Cancel" variant="ghost" onPress={onCancel} /> : null}
      </Row>
    </View>
  );
}
