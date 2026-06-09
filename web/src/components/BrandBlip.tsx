/**
 * Brand mark (DESIGN §3): a rounded-square accent tile with a mission-control
 * "blip" — a small accent-contrast dot that pings (scale + fading ring) every
 * ~8s. Pure CSS animation; suppressed under reduced-motion.
 */
export function BrandBlip() {
  return (
    <span className="brand-tile" aria-hidden>
      <span className="brand-blip" />
    </span>
  );
}
