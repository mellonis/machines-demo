import apply from '@tabler/icons/outline/corner-down-left.svg?raw';
import build from '@tabler/icons/outline/hammer.svg?raw';
import checkboxChecked from '@tabler/icons/outline/square-check.svg?raw';
import checkboxEmpty from '@tabler/icons/outline/square.svg?raw';
import chevronDown from '@tabler/icons/outline/chevron-down.svg?raw';
import chevronRight from '@tabler/icons/outline/chevron-right.svg?raw';
import clipboard from '@tabler/icons/outline/clipboard.svg?raw';
import copy from '@tabler/icons/outline/copy.svg?raw';
import deviceDesktop from '@tabler/icons/outline/device-desktop.svg?raw';
import eraser from '@tabler/icons/outline/eraser.svg?raw';
import examples from '@tabler/icons/outline/file-code.svg?raw';
import collapse from '@tabler/icons/outline/arrows-minimize.svg?raw';
import expand from '@tabler/icons/outline/arrows-maximize.svg?raw';
import github from '@tabler/icons/outline/brand-github.svg?raw';
import keep from '@tabler/icons/outline/keyframe-align-vertical.svg?raw';
import left from '@tabler/icons/outline/arrow-narrow-left.svg?raw';
import moon from '@tabler/icons/outline/moon.svg?raw';
import pause from '@tabler/icons/outline/player-pause.svg?raw';
import pencil from '@tabler/icons/outline/pencil.svg?raw';
import resetCode from '@tabler/icons/outline/arrow-back-up.svg?raw';
import right from '@tabler/icons/outline/arrow-narrow-right.svg?raw';
import run from '@tabler/icons/outline/player-play.svg?raw';
import saveFloppy from '@tabler/icons/outline/device-floppy.svg?raw';
import stay from '@tabler/icons/outline/keyframe-align-horizontal.svg?raw';
import step from '@tabler/icons/outline/player-skip-forward.svg?raw';
import stop from '@tabler/icons/outline/player-stop.svg?raw';
import sun from '@tabler/icons/outline/sun.svg?raw';
import target from '@tabler/icons/outline/target.svg?raw';
import takeControl from '@tabler/icons/outline/device-gamepad-2.svg?raw';
import xSmall from '@tabler/icons/outline/x.svg?raw';
import zoomIn from '@tabler/icons/outline/zoom-in.svg?raw';
import zoomOut from '@tabler/icons/outline/zoom-out.svg?raw';
import zoomReset from '@tabler/icons/outline/zoom-reset.svg?raw';

export const icons = {
  apply,
  build,
  checkboxChecked,
  checkboxEmpty,
  chevronDown,
  chevronRight,
  clipboard,
  collapse,
  copy,
  deviceDesktop,
  eraser,
  examples,
  expand,
  github,
  keep,
  left,
  moon,
  pause,
  pencil,
  resetCode,
  right,
  run,
  saveFloppy,
  stay,
  step,
  stop,
  sun,
  takeControl,
  target,
  xSmall,
  zoomIn,
  zoomOut,
  zoomReset,
} as const;

export type IconName = keyof typeof icons;
