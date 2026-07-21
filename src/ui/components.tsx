import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { colors, radius, spacing, typography } from './theme';
import { AuroraBackground } from './AuroraBackground';

type TextVariant = keyof typeof typography;

export function Txt({
  children,
  variant = 'body',
  color = colors.text,
  style,
  numberOfLines,
  selectable,
}: {
  children: ReactNode;
  variant?: TextVariant;
  color?: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  selectable?: boolean;
}) {
  return (
    <Text
      style={[typography[variant], { color }, style]}
      numberOfLines={numberOfLines}
      selectable={selectable}
    >
      {children}
    </Text>
  );
}

export function Card({
  children,
  style,
  onPress,
  padded = true,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  padded?: boolean;
}) {
  const content = (
    <View style={[styles.card, padded && { padding: spacing.lg }, style]}>{children}</View>
  );

  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
      {content}
    </Pressable>
  );
}

export function Section({
  title,
  subtitle,
  action,
  children,
  style,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ marginBottom: spacing.xl }, style]}>
      <View style={styles.sectionHeader}>
        <View style={{ flex: 1 }}>
          <Txt variant="heading">{title}</Txt>
          {subtitle ? (
            <Txt variant="caption" color={colors.textFaint} style={{ marginTop: 2 }}>
              {subtitle}
            </Txt>
          ) : null}
        </View>
        {action}
      </View>
      {children}
    </View>
  );
}

export function Row({
  children,
  gap = spacing.sm,
  style,
  wrap,
}: {
  children: ReactNode;
  gap?: number;
  style?: StyleProp<ViewStyle>;
  wrap?: boolean;
}) {
  return (
    <View
      style={[
        { flexDirection: 'row', alignItems: 'center', gap },
        wrap && { flexWrap: 'wrap' },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.divider, style]} />;
}

export function Field({
  label,
  value,
  color = colors.text,
  mono,
}: {
  label: string;
  value: ReactNode;
  color?: string;
  mono?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Txt variant="caption" color={colors.textFaint}>
        {label}
      </Txt>
      {typeof value === 'string' || typeof value === 'number' ? (
        <Txt variant={mono ? 'mono' : 'bodyStrong'} color={color} style={{ marginTop: 2 }}>
          {value}
        </Txt>
      ) : (
        <View style={{ marginTop: 2 }}>{value}</View>
      )}
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
  full,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  full?: boolean;
}) {
  const palette = {
    primary: { bg: colors.accent, fg: colors.accentText, border: 'transparent' },
    secondary: { bg: colors.surfaceHigh, fg: colors.text, border: colors.border },
    ghost: { bg: 'transparent', fg: colors.textMuted, border: colors.border },
    danger: { bg: 'transparent', fg: colors.danger, border: colors.danger },
  }[variant];

  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: palette.bg,
          borderColor: palette.border,
          opacity: isDisabled ? 0.45 : pressed ? 0.75 : 1,
        },
        full && { flex: 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={palette.fg} />
      ) : (
        <Text style={[typography.bodyStrong, { color: palette.fg }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Chip({
  label,
  color = colors.textMuted,
  selected,
  onPress,
  onRemove,
  size = 'md',
}: {
  label: string;
  color?: string;
  selected?: boolean;
  onPress?: () => void;
  onRemove?: () => void;
  size?: 'sm' | 'md';
}) {
  const body = (
    <View
      style={[
        styles.chip,
        size === 'sm' && { paddingVertical: 2, paddingHorizontal: spacing.sm },
        {
          borderColor: selected ? color : colors.border,
          backgroundColor: selected ? `${color}22` : colors.surfaceHigh,
        },
      ]}
    >
      <Text
        style={[
          size === 'sm' ? typography.caption : typography.label,
          { color: selected ? color : colors.textMuted },
        ]}
      >
        {label}
      </Text>
      {onRemove ? (
        <Pressable onPress={onRemove} hitSlop={8} accessibilityLabel={`Remove ${label}`}>
          <Text style={[typography.label, { color: colors.textFaint }]}>  ×</Text>
        </Pressable>
      ) : null}
    </View>
  );

  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      {body}
    </Pressable>
  );
}

export function Input({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  multiline,
  autoFocus,
  hint,
  style,
  autoCapitalize,
}: {
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad';
  multiline?: boolean;
  autoFocus?: boolean;
  hint?: string;
  style?: StyleProp<ViewStyle>;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}) {
  return (
    <View style={[{ marginBottom: spacing.lg }, style]}>
      {label ? (
        <Txt variant="label" color={colors.textMuted} style={{ marginBottom: spacing.xs }}>
          {label}
        </Txt>
      ) : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        keyboardType={keyboardType}
        multiline={multiline}
        autoFocus={autoFocus}
        autoCapitalize={autoCapitalize}
        accessibilityLabel={label}
        style={[
          styles.input,
          multiline && { minHeight: 120, textAlignVertical: 'top', paddingTop: spacing.md },
        ]}
      />
      {hint ? (
        <Txt variant="caption" color={colors.textFaint} style={{ marginTop: spacing.xs }}>
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  labels,
}: {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  labels?: Record<string, string>;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((option) => {
        const active = option === value;
        return (
          <Pressable
            key={option}
            onPress={() => onChange(option)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[styles.segment, active && { backgroundColor: colors.accent }]}
          >
            <Text
              style={[
                typography.label,
                { color: active ? colors.accentText : colors.textMuted },
              ]}
              numberOfLines={1}
            >
              {labels?.[option] ?? option}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Chip-based select with a custom-text escape hatch. Unrecognised values fall
 * through to the text field so they survive an edit-and-save round trip.
 */
export function Select({
  label,
  value,
  options,
  onChange,
  allowCustom,
  placeholder,
}: {
  label?: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  allowCustom?: boolean;
  placeholder?: string;
}) {
  const trimmed = value.trim();
  const matched =
    options.find((option) => option.toLowerCase() === trimmed.toLowerCase()) ?? null;

  // Sticky: keeps the text field open while it is still empty.
  const [customOpen, setCustomOpen] = useState(false);
  const showCustom = !!allowCustom && (customOpen || (trimmed.length > 0 && matched === null));

  return (
    <View style={{ marginBottom: spacing.lg }}>
      {label ? (
        <Txt variant="label" color={colors.textMuted} style={{ marginBottom: spacing.sm }}>
          {label}
        </Txt>
      ) : null}

      <Row gap={spacing.xs} wrap>
        {options.map((option) => (
          <Chip
            key={option}
            label={option}
            size="sm"
            color={colors.accent}
            selected={matched === option}
            onPress={() => {
              // Re-tapping the selected chip clears it — unless the custom
              // field is open, where a chip tap always means "use this one".
              const clearing = matched === option && !showCustom;
              setCustomOpen(false);
              onChange(clearing ? '' : option);
            }}
          />
        ))}
        {allowCustom ? (
          <Chip
            label="Other"
            size="sm"
            color={colors.textMuted}
            selected={showCustom}
            onPress={() => {
              // Toggling either way discards the old value; keeping a hidden
              // stale value would be worse.
              onChange('');
              setCustomOpen(!showCustom);
            }}
          />
        ) : null}
      </Row>

      {showCustom ? (
        <Input
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          style={{ marginTop: spacing.sm, marginBottom: 0 }}
        />
      ) : null}
    </View>
  );
}

export function StatTile({
  label,
  value,
  color = colors.text,
  hint,
  onPress,
}: {
  label: string;
  value: string | number;
  color?: string;
  hint?: string;
  onPress?: () => void;
}) {
  return (
    <Card style={styles.statTile} onPress={onPress} padded={false}>
      <View style={{ padding: spacing.md }}>
        <Txt variant="caption" color={colors.textFaint}>
          {label}
        </Txt>
        <Txt variant="title" color={color} style={{ marginTop: spacing.xs }} numberOfLines={1}>
          {value}
        </Txt>
        {hint ? (
          <Txt variant="caption" color={colors.textFaint} style={{ marginTop: 2 }}>
            {hint}
          </Txt>
        ) : null}
      </View>
    </Card>
  );
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.empty}>
      <Txt variant="bodyStrong" color={colors.textMuted}>
        {title}
      </Txt>
      <Txt
        variant="caption"
        color={colors.textFaint}
        style={{ textAlign: 'center', marginTop: spacing.xs, lineHeight: 18 }}
      >
        {message}
      </Txt>
      {action ? <View style={{ marginTop: spacing.lg }}>{action}</View> : null}
    </View>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.accent} />
      <Txt variant="caption" color={colors.textFaint} style={{ marginTop: spacing.sm }}>
        {label}
      </Txt>
    </View>
  );
}

export function ProgressBar({
  progress,
  color = colors.accent,
  height = 6,
}: {
  progress: number;
  color?: string;
  height?: number;
}) {
  const clamped = Math.max(0, Math.min(1, progress));
  return (
    <View style={[styles.progressTrack, { height, borderRadius: height / 2 }]}>
      <View
        style={{
          width: `${clamped * 100}%`,
          height: '100%',
          backgroundColor: color,
          borderRadius: height / 2,
        }}
      />
    </View>
  );
}

export function Screen({
  children,
  scroll = true,
  refreshControl,
}: {
  children: ReactNode;
  scroll?: boolean;
  refreshControl?: React.ComponentProps<typeof ScrollView>['refreshControl'];
}) {
  // The aurora sits behind the (transparent) scroll view so it does not
  // scroll away with the content.
  return (
    <View style={styles.screen}>
      <AuroraBackground />
      {scroll ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.screenContent}
          keyboardShouldPersistTaps="handled"
          refreshControl={refreshControl}
        >
          {children}
        </ScrollView>
      ) : (
        children
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  screenContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl * 2,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pressed: {
    opacity: 0.7,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  field: {
    marginBottom: spacing.md,
    minWidth: 90,
  },
  button: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  input: {
    backgroundColor: colors.surfaceHigh,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.text,
    fontSize: 15,
    minHeight: 46,
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceHigh,
    borderRadius: radius.md,
    padding: 3,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  segment: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  statTile: {
    flex: 1,
    minWidth: 100,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  progressTrack: {
    backgroundColor: colors.surfaceHigh,
    overflow: 'hidden',
    width: '100%',
  },
});
