import { useState } from 'react';
import { Pressable, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';
import { chartColors, colors, spacing } from './theme';
import { formatCrypto, formatDate } from './format';
import { Txt } from './components';

// Rounds only the top corners; rounding the bottom would lift the bar off the baseline and misread the value.
function barPath(x: number, y: number, width: number, height: number, radius: number): string {
  const r = Math.min(radius, width / 2, Math.max(height, 0));
  if (height <= 0) return '';
  return [
    `M ${x} ${y + height}`,
    `L ${x} ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    `L ${x + width - r} ${y}`,
    `Q ${x + width} ${y} ${x + width} ${y + r}`,
    `L ${x + width} ${y + height}`,
    'Z',
  ].join(' ');
}

export interface DailyPoint {
  day: number;
  amount: number;
}

export function DailyCryptoChart({
  data,
  height = 140,
}: {
  data: DailyPoint[];
  height?: number;
}) {
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);

  const onLayout = (event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  };

  const max = Math.max(...data.map((d) => d.amount), 1);
  const peakIndex = data.reduce((best, d, i) => (d.amount > data[best].amount ? i : best), 0);
  const hasAnyData = data.some((d) => d.amount > 0);

  const topPadding = 18;
  const bottomPadding = 16;
  const plotHeight = height - topPadding - bottomPadding;

  const gap = 2;
  const barWidth = data.length > 0 ? Math.max(2, (width - gap * (data.length - 1)) / data.length) : 0;

  const active = selected !== null ? data[selected] : null;

  return (
    <View onLayout={onLayout}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs }}>
        <Txt variant="caption" color={colors.textFaint}>
          {active ? formatDate(active.day) : `Last ${data.length} days`}
        </Txt>
        <Txt variant="caption" color={active ? colors.crypto : colors.textFaint}>
          {active ? `${formatCrypto(active.amount)} crypto` : `peak ${formatCrypto(max)}`}
        </Txt>
      </View>

      {width > 0 ? (
        <Svg width={width} height={height}>
          <Line
            x1={0}
            y1={topPadding + plotHeight}
            x2={width}
            y2={topPadding + plotHeight}
            stroke={chartColors.axis}
            strokeWidth={1}
          />

          {data.map((point, index) => {
            const barHeight = hasAnyData ? (point.amount / max) * plotHeight : 0;
            const x = index * (barWidth + gap);
            const y = topPadding + plotHeight - barHeight;
            const isSelected = selected === index;

            return (
              <Path
                key={point.day}
                d={barPath(x, y, barWidth, barHeight, 4)}
                fill={isSelected ? colors.crypto : chartColors.crypto}
                opacity={selected === null || isSelected ? 1 : 0.45}
              />
            );
          })}
        </Svg>
      ) : (
        <View style={{ height }} />
      )}

      {/* Full-height touch targets — a short bar is too small to hit directly. */}
      {width > 0 ? (
        <View style={{ position: 'absolute', top: 18, left: 0, right: 0, height, flexDirection: 'row' }}>
          {data.map((point, index) => (
            <Pressable
              key={point.day}
              onPress={() => setSelected(selected === index ? null : index)}
              style={{ flex: 1, height: '100%' }}
              accessibilityLabel={`${formatDate(point.day)}: ${Math.round(point.amount)} crypto`}
            />
          ))}
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs }}>
        <Txt variant="caption" color={colors.textFaint}>
          {data.length > 0 ? formatDate(data[0].day) : ''}
        </Txt>
        {hasAnyData ? (
          <Txt variant="caption" color={colors.textFaint}>
            best day {formatDate(data[peakIndex].day)}
          </Txt>
        ) : null}
        <Txt variant="caption" color={colors.textFaint}>
          {data.length > 0 ? formatDate(data[data.length - 1].day) : ''}
        </Txt>
      </View>
    </View>
  );
}

export function Sparkline({
  data,
  width,
  height = 32,
  color = chartColors.crypto,
}: {
  data: number[];
  width: number;
  height?: number;
  color?: string;
}) {
  if (data.length < 2 || width <= 0) return <View style={{ height }} />;

  const max = Math.max(...data, 1);
  const step = width / (data.length - 1);
  const points = data.map((value, index) => ({
    x: index * step,
    y: height - (value / max) * height,
  }));

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const area = `${line} L ${width} ${height} L 0 ${height} Z`;

  return (
    <Svg width={width} height={height}>
      <Path d={area} fill={color} opacity={0.15} />
      <Path d={line} stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" />
    </Svg>
  );
}

export function BreakdownBar({
  segments,
  height = 10,
}: {
  segments: { label: string; value: number; color: string }[];
  height?: number;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) {
    return (
      <View
        style={{
          height,
          borderRadius: height / 2,
          backgroundColor: colors.surfaceHigh,
        }}
      />
    );
  }

  const visible = segments.filter((s) => s.value > 0);

  return (
    <View style={{ flexDirection: 'row', height, gap: 2 }}>
      {/* Destructured to `weight`: reanimated's dev check false-positives on `.value` in inline styles. */}
      {visible.map(({ label, value: weight, color }, index) => (
        <View
          key={label}
          style={{
            flex: weight,
            backgroundColor: color,
            borderTopLeftRadius: index === 0 ? height / 2 : 0,
            borderBottomLeftRadius: index === 0 ? height / 2 : 0,
            borderTopRightRadius: index === visible.length - 1 ? height / 2 : 0,
            borderBottomRightRadius: index === visible.length - 1 ? height / 2 : 0,
          }}
        />
      ))}
    </View>
  );
}

export function RankBar({
  value,
  max,
  color = chartColors.crypto,
  height = 4,
}: {
  value: number;
  max: number;
  color?: string;
  height?: number;
}) {
  const fraction = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <View
      style={{
        height,
        backgroundColor: chartColors.grid,
        borderRadius: height / 2,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          width: `${fraction * 100}%`,
          height: '100%',
          backgroundColor: color,
          borderRadius: height / 2,
        }}
      />
    </View>
  );
}
