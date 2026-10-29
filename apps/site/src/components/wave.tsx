/**
 * A wavy section edge, the way a torn-paper edge separates color blocks on other sites. `top` puts the wave on
 * the upper edge of a tinted section (the tint fills below the line); `bottom` puts it on the lower edge.
 */
export function Wave({ edge }: { edge: 'top' | 'bottom' }) {
  const d = edge === 'top' ? 'M0 90 V46 C 180 6, 360 86, 540 46 S 900 6, 1080 46 S 1320 78, 1440 40 V90 Z' : 'M0 0 V44 C 180 84, 360 4, 540 44 S 900 84, 1080 44 S 1320 12, 1440 50 V0 Z';
  return (
    <svg viewBox="0 0 1440 90" preserveAspectRatio="none" aria-hidden="true" className="block h-12 w-full fill-wash sm:h-20">
      <path d={d} />
    </svg>
  );
}
