const ACCENT_COLORS = ['#ffb703', '#fb8500', '#06d6a0', '#4cc9f0', '#f72585'];

export const deriveAccentColor = (seed: string) => {
  if (!seed) {
    return ACCENT_COLORS[0];
  }
  const hash = Array.from(seed).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return ACCENT_COLORS[hash % ACCENT_COLORS.length];
};
