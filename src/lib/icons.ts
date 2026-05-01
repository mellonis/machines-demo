import arrowLeft from '@tabler/icons/outline/arrow-narrow-left.svg?raw';
import arrowRight from '@tabler/icons/outline/arrow-narrow-right.svg?raw';
import stay from '@tabler/icons/outline/keyframe-align-horizontal.svg?raw';
import keep from '@tabler/icons/outline/keyframe-align-vertical.svg?raw';
import apply from '@tabler/icons/outline/corner-down-left.svg?raw';
import load from '@tabler/icons/outline/reload.svg?raw';
import run from '@tabler/icons/outline/player-play.svg?raw';
import step from '@tabler/icons/outline/player-skip-forward.svg?raw';
import pause from '@tabler/icons/outline/player-pause.svg?raw';
import takeControl from '@tabler/icons/outline/device-gamepad-2.svg?raw';
import eraser from '@tabler/icons/outline/eraser.svg?raw';
import resetCode from '@tabler/icons/outline/arrow-back-up.svg?raw';
import github from '@tabler/icons/outline/brand-github.svg?raw';

export const icons = {
  left: arrowLeft,
  right: arrowRight,
  stay,
  keep,
  apply,
  load,
  run,
  step,
  pause,
  takeControl,
  eraser,
  resetCode,
  github,
} as const;

export type IconName = keyof typeof icons;
