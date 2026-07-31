export type Rgb = Readonly<{
  red: number;
  green: number;
  blue: number;
}>;

export type Rgba = Rgb &
  Readonly<{
    alpha: number;
  }>;

const HEX_COLOR = /^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i;
const RGB_COLOR = /^rgba?\((.+)\)$/i;

function parseChannel(value: string): number {
  const channel = Number(value.trim());
  if (!Number.isFinite(channel) || channel < 0 || channel > 255) {
    throw new Error(`Invalid RGB channel: ${value}`);
  }
  return channel;
}

function parseAlpha(value: string | undefined): number {
  if (value === undefined) return 1;

  const alpha = Number(value.trim());
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
    throw new Error(`Invalid alpha channel: ${value}`);
  }
  return alpha;
}

export function parseColor(color: string): Rgba {
  const normalized = color.trim();
  const hexMatch = normalized.match(HEX_COLOR);

  if (hexMatch) {
    const value = hexMatch[1];
    if (value.length === 3) {
      return {
        red: Number.parseInt(value[0] + value[0], 16),
        green: Number.parseInt(value[1] + value[1], 16),
        blue: Number.parseInt(value[2] + value[2], 16),
        alpha: 1,
      };
    }

    return {
      red: Number.parseInt(value.slice(0, 2), 16),
      green: Number.parseInt(value.slice(2, 4), 16),
      blue: Number.parseInt(value.slice(4, 6), 16),
      alpha: value.length === 8 ? Number.parseInt(value.slice(6, 8), 16) / 255 : 1,
    };
  }

  const rgbMatch = normalized.match(RGB_COLOR);
  if (rgbMatch) {
    const channels = rgbMatch[1].split(",");
    const expectedChannelCount = normalized.toLowerCase().startsWith("rgba") ? 4 : 3;
    if (channels.length !== expectedChannelCount) {
      throw new Error(`Invalid RGB color: ${color}`);
    }

    return {
      red: parseChannel(channels[0]),
      green: parseChannel(channels[1]),
      blue: parseChannel(channels[2]),
      alpha: parseAlpha(channels[3]),
    };
  }

  throw new Error(`Unsupported color format: ${color}`);
}

export function composite(foreground: string | Rgba, background: string | Rgba): Rgb {
  const foregroundColor = typeof foreground === "string" ? parseColor(foreground) : foreground;
  const backgroundColor = typeof background === "string" ? parseColor(background) : background;

  if (backgroundColor.alpha !== 1) {
    throw new Error("Contrast backgrounds must be opaque before compositing");
  }

  const inverseAlpha = 1 - foregroundColor.alpha;
  return {
    red: foregroundColor.red * foregroundColor.alpha + backgroundColor.red * inverseAlpha,
    green: foregroundColor.green * foregroundColor.alpha + backgroundColor.green * inverseAlpha,
    blue: foregroundColor.blue * foregroundColor.alpha + backgroundColor.blue * inverseAlpha,
  };
}

function linearize(channel: number): number {
  const srgb = channel / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(color: Rgb): number {
  return (
    0.2126 * linearize(color.red) +
    0.7152 * linearize(color.green) +
    0.0722 * linearize(color.blue)
  );
}

export function contrastRatio(foreground: string | Rgb, background: string | Rgb): number {
  const foregroundColor =
    typeof foreground === "string" ? composite(foreground, "#000000") : foreground;
  const backgroundColor =
    typeof background === "string" ? composite(background, "#000000") : background;
  const foregroundLuminance = relativeLuminance(foregroundColor);
  const backgroundLuminance = relativeLuminance(backgroundColor);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

export function compositedContrastRatio(
  foreground: string,
  translucentBackground: string,
  opaqueBase: string,
): number {
  return contrastRatio(foreground, composite(translucentBackground, opaqueBase));
}
