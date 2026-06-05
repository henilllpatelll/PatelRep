import { Platform } from 'react-native';

export const C = {
  paper: '#f7f4ee',
  surface: '#ffffff',
  surface2: '#fbf9f4',
  surface3: '#f1ede4',
  line: '#e6dfd1',
  line2: '#efe9dc',
  ink: '#1a1815',
  ink2: '#4a4640',
  ink3: '#807a70',
  ink4: '#a8a195',
  accent: '#b8431c',
  accentSoft: '#fbe9df',
  accentLine: '#f0c8b3',
  ready: '#0c6e63',
  readySoft: '#d6eae5',
  readyLine: '#a4cfc7',
  caution: '#a16207',
  cautionSoft: '#f5e9cf',
  cautionLine: '#e0c890',
  alert: '#a6263c',
  alertSoft: '#f5d8de',
  alertLine: '#e8a8b3',
  info: '#265d8a',
  infoSoft: '#d8e6f0',
  infoLine: '#a8c2d8',
  ai: '#4a2c8f',
  aiSoft: '#ece4f8',
  aiLine: '#c8b8e3',
} as const;

export const R = { sm: 6, md: 10, lg: 14, xl: 20 } as const;

export const monoFont = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
}) as string;

// Instrument Serif fallback — Georgia is universally available
export const displayFont = 'Georgia';
