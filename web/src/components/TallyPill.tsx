import { Digits } from './Digits';

/**
 * Live tally pill (DESIGN §3): `● 4 running · ◐ 1 starting · ○ 3 stopped`.
 * Dots use status colors; counts cross-fade single digits on change. On very
 * narrow widths CSS collapses it to `●4 ◐1 ○3` (DESIGN §12).
 */
export function TallyPill({
  running,
  starting,
  stopped,
  scanning = false
}: {
  running: number;
  starting: number;
  stopped: number;
  scanning?: boolean;
}) {
  if (scanning) {
    return (
      <div className="tally-pill scanning" aria-label="scanning">
        <span className="tally-seg">
          <span className="tally-dot" data-kind="starting" /> scanning…
        </span>
      </div>
    );
  }
  return (
    <div
      className="tally-pill"
      aria-label={`${running} running, ${starting} starting, ${stopped} stopped`}
    >
      <span className="tally-seg">
        <span className="tally-dot" data-kind="running" />
        <Digits value={String(running)} />
        <span className="tally-word"> running</span>
      </span>
      <span className="tally-div">·</span>
      <span className="tally-seg">
        <span className="tally-dot" data-kind="starting" />
        <Digits value={String(starting)} />
        <span className="tally-word"> starting</span>
      </span>
      <span className="tally-div">·</span>
      <span className="tally-seg">
        <span className="tally-dot" data-kind="stopped" />
        <Digits value={String(stopped)} />
        <span className="tally-word"> stopped</span>
      </span>
    </div>
  );
}
