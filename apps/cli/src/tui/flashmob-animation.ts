export interface AccentAnimationOptions {
  from: number;
  to: number;
  isCurrent: () => boolean;
  setProgress: (value: number) => void;
  render: () => void;
  wait: (milliseconds: number) => Promise<void>;
}

export async function animateAccentProgress(options: AccentAnimationOptions): Promise<boolean> {
  const steps = 12;
  for (let step = 1; step <= steps; step += 1) {
    if (!options.isCurrent()) return false;
    options.setProgress(options.from + ((options.to - options.from) * step) / steps);
    options.render();
    await options.wait(18);
  }
  if (!options.isCurrent()) return false;
  options.setProgress(options.to);
  options.render();
  return true;
}
