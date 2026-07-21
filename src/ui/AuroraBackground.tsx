// Calm aurora: three soft accent-coloured glows drifting behind the content.
// SVG radial gradients instead of blur — expo-blur is expensive on Android,
// a gradient that fades to transparent looks the same at this opacity.

import { useEffect } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';
import { colors } from './theme';
import { useTheme } from '@/components/ThemeProvider';

interface BlobSpec {
  size: number;
  opacity: number;
  /** Start position as a fraction of the screen. */
  x: number;
  y: number;
  /** Drift amplitude in px and full loop duration in ms. */
  driftX: number;
  driftY: number;
  duration: number;
}

const BLOBS: BlobSpec[] = [
  { size: 340, opacity: 0.2, x: -0.2, y: -0.1, driftX: 150, driftY: 100, duration: 12000 },
  { size: 300, opacity: 0.16, x: 0.75, y: 0.35, driftX: -140, driftY: 150, duration: 16000 },
  { size: 380, opacity: 0.14, x: 0.2, y: 0.85, driftX: 120, driftY: -120, duration: 20000 },
];

function Blob({ spec }: { spec: BlobSpec }) {
  const { width, height } = useWindowDimensions();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, { duration: spec.duration, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [progress, spec.duration]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: progress.value * spec.driftX },
      { translateY: progress.value * spec.driftY },
      // A slow breathe alongside the drift makes the motion readable even
      // when a blob sits half off-screen.
      { scale: 1 + progress.value * 0.25 },
    ],
  }));

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: width * spec.x,
          top: height * spec.y,
          width: spec.size,
          height: spec.size,
          opacity: spec.opacity,
        },
        style,
      ]}
    >
      <Svg width={spec.size} height={spec.size}>
        <Defs>
          <RadialGradient id="glow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={colors.accent} stopOpacity="1" />
            <Stop offset="70%" stopColor={colors.accent} stopOpacity="0.35" />
            <Stop offset="100%" stopColor={colors.accent} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Ellipse
          cx={spec.size / 2}
          cy={spec.size / 2}
          rx={spec.size / 2}
          ry={spec.size / 2}
          fill="url(#glow)"
        />
      </Svg>
    </Animated.View>
  );
}

export function AuroraBackground() {
  // Subscribe so the glow follows theme switches.
  useTheme();

  return (
    <Animated.View style={StyleSheet.absoluteFill} pointerEvents="none">
      {BLOBS.map((spec, index) => (
        <Blob key={index} spec={spec} />
      ))}
    </Animated.View>
  );
}
