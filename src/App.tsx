import "./index.css";

import { useEffect, useRef, useState } from "react";

type TimeslotRange = {
  start: number; // inclusive, 0..86399
  end: number; // inclusive, 0..86399
  meta: {
    name: string;
    [key: string]: unknown;
  };
};

type TimeslotsStore = {
  date: [number, number, number];
  timeslots: TimeslotRange[];
  [key: string]: unknown;
};

function getTodayArray(now: Date): [number, number, number] {
  return [now.getDate(), now.getMonth(), now.getFullYear()];
}

function isSameDate(a: unknown, b: [number, number, number]): boolean {
  if (!Array.isArray(a) || a.length !== 3) return false;
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function makeDefaultTimeslots(now: Date): TimeslotsStore {
  return {
    date: getTodayArray(now),
    timeslots: [],
  };
}

function getSecondsSinceMidnight(now: Date): number {
  return now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
}

function getDayProgressPercent(now: Date): number {
  const secondsSinceMidnight = getSecondsSinceMidnight(now);
  const percent = (secondsSinceMidnight / 86400) * 100;
  return Math.max(0, Math.min(100, percent));
}

function getDayRemainingPercent(now: Date): number {
  return 100 - getDayProgressPercent(now);
}

function getRemainingSeconds(now: Date): number {
  const secondsSinceMidnight = getSecondsSinceMidnight(now);
  return Math.max(0, 86400 - secondsSinceMidnight);
}

function formatHhMmSs(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function formatHhMmSsParts(totalSeconds: number): {
  hh: string;
  mm: string;
  ss: string;
} {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return {
    hh: String(hours).padStart(2, "0"),
    mm: String(minutes).padStart(2, "0"),
    ss: String(seconds).padStart(2, "0"),
  };
}

function normalizeRange(start: number, end: number): { start: number; end: number } {
  let s = start;
  let e = end;
  if (s > e) [s, e] = [e, s];
  s = Math.max(0, Math.min(86399, s));
  e = Math.max(0, Math.min(86399, e));
  return { start: s, end: e };
}

// deterministic color from meta.name
function colorFromName(name: string, isPast: boolean, isRunning?: boolean): string {
  // stable string → hue
  let h = 5381;
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) + h) ^ name.charCodeAt(i);
  }

  const hue = Math.abs(h) % 360;

  // tuning knobs
  const saturation = isRunning ? 5 : isPast ? 15 : 70;
  const lightness = isRunning ? 30 : isPast ? 25 : 55;
  const alpha = isRunning ? 0.8 : isPast ? 0.35 : 0.7;

  return `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha})`;
}

// non-overlapping invariant; merges contiguous neighbors with same meta.name
function addRangeNoOverlap(
  list: TimeslotRange[],
  start: number,
  end: number,
  meta: TimeslotRange["meta"],
): TimeslotRange[] {
  if (!meta || typeof meta.name !== "string") {
    throw new TypeError("meta must be an object with meta.name (string)");
  }

  const { start: s, end: e } = normalizeRange(start, end);

  // find insert position: first item with start > s
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].start <= s) lo = mid + 1;
    else hi = mid;
  }
  let pos = lo;

  // overlap checks
  if (pos > 0 && list[pos - 1].end >= s) throw new Error("overlap with previous range");
  if (pos < list.length && list[pos].start <= e) throw new Error("overlap with next range");

  const next = list.slice();
  next.splice(pos, 0, { start: s, end: e, meta });

  // merge left if contiguous and same meta.name
  if (pos > 0) {
    const a = next[pos - 1];
    const b = next[pos];
    if (a.end + 1 === b.start && a.meta?.name === b.meta?.name) {
      a.end = b.end;
      next.splice(pos, 1);
      pos--;
    }
  }

  // merge right if contiguous and same meta.name
  if (pos < next.length - 1) {
    const a = next[pos];
    const b = next[pos + 1];
    if (a.end + 1 === b.start && a.meta?.name === b.meta?.name) {
      a.end = b.end;
      next.splice(pos + 1, 1);
    }
  }

  return next;
}

function readStoreForToday(now: Date): TimeslotsStore {
  const today = getTodayArray(now);
  const reset = () => makeDefaultTimeslots(now);

  try {
    const raw = localStorage.getItem("timeslots");
    if (!raw) return reset();

    const parsed = JSON.parse(raw) as Partial<TimeslotsStore>;
    if (!isSameDate(parsed?.date, today)) return reset();

    const timeslots = Array.isArray((parsed as any)?.timeslots)
      ? ((parsed as any).timeslots as TimeslotRange[])
      : [];

    return {
      ...(parsed as TimeslotsStore),
      date: today,
      timeslots,
    };
  } catch {
    return reset();
  }
}

function writeStore(
  store: TimeslotsStore,
  setTimeslotsDebug: (s: string) => void,
  setTimeslots: (t: TimeslotRange[]) => void,
) {
  const raw = JSON.stringify(store);
  localStorage.setItem("timeslots", raw);
  setTimeslotsDebug(raw);
  setTimeslots(store.timeslots ?? []);
}

function toTimeStringHHMM(seconds: number): string {
  const s = Math.max(0, Math.min(86399, seconds));
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  return `${hh}:${mm}`;
}

function fromTimeStringHHMM(value: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  if (!m) return 0;
  const hh = Math.max(0, Math.min(23, Number(m[1])));
  const mm = Math.max(0, Math.min(59, Number(m[2])));
  return hh * 3600 + mm * 60;
}

function findActiveSlot(timeslots: TimeslotRange[], nowSeconds: number): TimeslotRange | null {
  // assumes non-overlapping; linear scan is fine for small counts
  for (const r of timeslots) {
    if (r.start <= nowSeconds && nowSeconds <= r.end) return r;
  }
  return null;
}

function setFaviconSquare(bg: string) {
  // simple rounded square SVG favicon
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">
      <rect x="8" y="8" width="48" height="48" rx="10" ry="10" fill="${bg}"/>
    </svg>
  `.trim();

  const url = `data:image/svg+xml,${encodeURIComponent(svg)}`;

  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }

  // some browsers cache aggressively; forcing update via href replacement helps
  link.type = "image/svg+xml";
  link.href = url;
}

export function App() {
  const [dayRemainingPercent, setDayRemainingPercent] = useState(() =>
    getDayRemainingPercent(new Date())
  );

  const [timeslotsDebug, setTimeslotsDebug] = useState<string>("{}");
  const [timeslots, setTimeslots] = useState<TimeslotRange[]>([]);

  const [isIslandExpanded, setIsIslandExpanded] = useState(false);
  const barRef = useRef<HTMLDivElement | null>(null);
  const islandRef = useRef<HTMLDivElement | null>(null);

  const [remainingLabel, setRemainingLabel] = useState(() =>
    formatHhMmSs(getRemainingSeconds(new Date()))
  );

  const [remainingSecondsValue, setRemainingSecondsValue] = useState(() =>
    getRemainingSeconds(new Date())
  );

  const [remainingParts, setRemainingParts] = useState(() =>
    formatHhMmSsParts(getRemainingSeconds(new Date()))
  );

  const [nowSeconds, setNowSeconds] = useState(() =>
    getSecondsSinceMidnight(new Date())
  );

  const [pickerStart, setPickerStart] = useState(() => toTimeStringHHMM(0));
  const [pickerEnd, setPickerEnd] = useState(() => toTimeStringHHMM(0));

  const VIEWPORT_START_6 = 6 * 3600;

  // viewport toggle: default is "start at 06:00" (not persisted)
  const [startAtSix, setStartAtSix] = useState(true);
  const viewStartSeconds = startAtSix ? 6 * 3600 : 0; // 06:00 vs 00:00
  const viewSpanSeconds = 86400 - viewStartSeconds;

  // viewport progress (only meaningful when using 06:00 start)
  const viewportProgressPercent = Math.max(
    0,
    Math.min(
      100,
      ((nowSeconds - VIEWPORT_START_6) / (86400 - VIEWPORT_START_6)) * 100
    )
  );
  const viewportRemainingPercent = 100 - viewportProgressPercent;

  useEffect(() => {
    const now = new Date();

    const fresh = readStoreForToday(now);
    writeStore(fresh, setTimeslotsDebug, setTimeslots);

    const id = window.setInterval(() => {
      const now = new Date();
      setDayRemainingPercent(getDayRemainingPercent(now));

      const remainingSeconds = getRemainingSeconds(now);
      setRemainingSecondsValue(remainingSeconds);
      setRemainingLabel(formatHhMmSs(remainingSeconds));
      setRemainingParts(formatHhMmSsParts(remainingSeconds));

      setNowSeconds(getSecondsSinceMidnight(now));
    }, 1000);

    return () => window.clearInterval(id);
  }, []);

  const activeSlot = (() => {
  for (const r of timeslots) {
    if (r.start <= nowSeconds && nowSeconds <= r.end) return r;
  }
  return null;
})();

const activeSlotKey = activeSlot
  ? `${activeSlot.start}-${activeSlot.end}-${activeSlot.meta.name}`
  : null;

  useEffect(() => {
  const color = activeSlot
    ? colorFromName(activeSlot.meta.name, false).replace(/,\s*0\.7\)/, ", 1)")
    : "rgba(120,120,120,0.9)";

  setFaviconSquare(color);

  if (activeSlot) {
    document.title = `${activeSlot.meta.name} · ${toTimeStringHHMM(activeSlot.start)}–${toTimeStringHHMM(activeSlot.end)}`;
  } else {
    document.title = "Timeslots";
  }
}, [activeSlotKey]);

  const resetTimeslots = () => {
    const fresh = makeDefaultTimeslots(new Date());
    writeStore(fresh, setTimeslotsDebug, setTimeslots);
  };

  const createFromPickers = () => {
    const nameRaw = window.prompt("Name for this timeslot?");
    const name = (nameRaw ?? "").trim();
    if (!name) return;

    const startSeconds = fromTimeStringHHMM(pickerStart);
    
    // Treat pickerEnd as an exclusive boundary, store inclusive end = -1 sec.
    const endExclusive = fromTimeStringHHMM(pickerEnd);

    // If user picks the same time (or earlier), it would become invalid after -1.
    if (endExclusive <= startSeconds) {
      window.alert("End time must be after start time.");
      return;
    }

    const endSeconds = Math.max(0, endExclusive - 1);

    try {
      const store = readStoreForToday(new Date());
      const updated: TimeslotsStore = {
        ...store,
        timeslots: addRangeNoOverlap(
          store.timeslots ?? [],
          startSeconds,
          endSeconds,
          {
            name,
          }
        ),
      };
      writeStore(updated, setTimeslotsDebug, setTimeslots);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      window.alert(msg);
    }
  };

  useEffect(() => {
    if (!isIslandExpanded) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;

      const barEl = barRef.current;
      const islandEl = islandRef.current;
      const clickedInside =
        (barEl?.contains(target) ?? false) ||
        (islandEl?.contains(target) ?? false);

      if (!clickedInside) setIsIslandExpanded(false);
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [isIslandExpanded]);

  return (
    <div className="w-full h-full flex flex-col page-diagonal-bg">
      <div className="fixed z-30 top-0 left-1/2 -translate-x-1/2 w-full h-6 overflow-hidden bg-indigo-800/70" />
      <div
        id="island"
        ref={islandRef}
        className={`fixed z-40 top-0 left-1/2 -translate-x-1/2 w-[75%] border-b rounded-b-3xl overflow-hidden bg-neutral-900/90 transition-all duration-200 ease-out motion-reduce:transition-none ${
          isIslandExpanded
            ? "h-100 border-neutral-800"
            : "h-5 border-neutral-900"
        }`}
        onMouseEnter={() => setIsIslandExpanded(true)}
      >
        {isIslandExpanded && (
          <div className="w-full h-full mt-7 z-60 px-2 text-[10px] leading-none font-mono text-white/40 overflow-hidden">
            <div className="flex items-center gap-2 mb-2">
              <input
                type="time"
                step={60}
                className="bg-neutral-800/80 border border-neutral-700 rounded px-1 py-0.5 text-white/70"
                value={pickerStart}
                onChange={(e) => setPickerStart(e.target.value)}
              />
              <input
                type="time"
                step={60}
                className="bg-neutral-800/80 border border-neutral-700 rounded px-1 py-0.5 text-white/70"
                value={pickerEnd}
                onChange={(e) => setPickerEnd(e.target.value)}
              />
              <button
                type="button"
                className="bg-neutral-800/80 border border-neutral-700 rounded px-2 py-0.5 text-white/70"
                onClick={createFromPickers}
              >
                create
              </button>
            </div>

            {timeslotsDebug}
            <div className="mt-1">{remainingSecondsValue}</div>
          </div>
        )}
      </div>
      <div
        id="bar"
        ref={barRef}
        className="fixed z-50 top-0 left-1/2 -translate-x-1/2 w-[90%] h-5 rounded-b-3xl overflow-hidden bg-neutral-900 flex items-center gap-2 px-2"
        onMouseEnter={() => setIsIslandExpanded(true)}
      >
        <button
          id="reset"
          type="button"
          aria-label="Button 1"
          className="size-3 rounded-sm bg-neutral-600/90 px-3 mx-3 text-xs font-mono flex items-center justify-center text-neutral-300/90"
          onClick={resetTimeslots}
        >
          re
        </button>

        {/* viewport toggle (default: 06:00 start) */}
        <label className="flex items-center gap-1 text-[10px] font-mono text-neutral-300/80 select-none">
          <input
            type="checkbox"
            className="accent-neutral-300"
            checked={startAtSix}
            onChange={(e) => setStartAtSix(e.target.checked)}
          />
          {startAtSix ? "06" : "00"}
        </label>
      </div>

      <div className="h-5 shrink-0" aria-hidden />

      <div className="content relative w-full flex-1 overflow-hidden">
        {/* timeslot windows overlay */}
        <div className="absolute inset-0 pointer-events-none z-35">
          {timeslots.map((r, idx) => {
            const isPast = r.end < nowSeconds;

            // clip/shift to viewport
            const clipStart = Math.max(r.start, viewStartSeconds);
            const clipEnd = Math.min(r.end, 86399);
            if (clipEnd < viewStartSeconds) return null;

            const leftPct =
              ((clipStart - viewStartSeconds) / viewSpanSeconds) * 100;
            const widthPct =
              ((clipEnd - clipStart + 1) / viewSpanSeconds) * 100;

            return (
              <div
                key={`${r.start}-${r.end}-${r.meta.name}-${idx}`}
                className={`absolute ${isPast ? "inset-y-0" : ""}`}
                style={{
                  left: `${leftPct}%`,
                  width: `${widthPct}%`,
                  backgroundColor: "transparent",
                  top: isPast ? "10%" : "3%",
                  height: isPast ? "100%" : "80%",
                }}
              >
                {/* slot body */}
                <div
                  className="z-35 w-[calc(100%-0.125rem)] h-[calc(100%-0.125rem)] rounded-4xl m-[0.0625rem] overflow-hidden relative"
                  style={{
                    backgroundColor: colorFromName(r.meta.name, isPast),
                  }}
                >
                  {/* active progress overlay: only while slot is running */}
                  {r.start <= nowSeconds && nowSeconds < r.end && (
                    <div
                      className="absolute inset-y-0 left-0"
                      style={{
                        width: `${Math.max(
                          0,
                          Math.min(
                            100,
                            ((nowSeconds - r.start) / (r.end - r.start + 1)) *
                              100
                          )
                        )}%`,
                        backgroundColor: colorFromName(r.meta.name, true, true),
                      }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="absolute inset-y-0 right-0 z-0 w-full">
          {/* viewport progress bar (only when using 06:00 start) */}
          {startAtSix && (
            <div
              className="absolute inset-y-0 right-0 bg-neutral-700/40"
              style={{ width: `${viewportRemainingPercent}%` }}
            />
          )}

          {/* main day progress bar (always) */}
          <div
            className="absolute inset-y-0 right-0 bg-neutral-800/90 select-none"
            style={{ width: `${dayRemainingPercent}%` }}
          >
            <div
              className={`absolute font-mono bottom-0 p-1 flex flex-col leading-none text-white/20 text-3xl ${
                startAtSix
                  ? "right-0 items-end text-right"
                  : "left-0 items-start text-left"
              }`}
              aria-label={remainingLabel}
            >
              <div className="whitespace-nowrap">{remainingParts.hh}</div>
              <div className="whitespace-nowrap">{remainingParts.mm}</div>
              <div className="whitespace-nowrap">{remainingParts.ss}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
