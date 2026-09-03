import { useEffect, useState } from "react";
import { Pause, Play, SkipForward, X } from "lucide-react";
import { persistTourSeen, TOUR_STEPS } from "@/lib/rag/tour";
import { Button } from "@/components/ui/button";

const PAD = 10;

function measureTarget(target: string): DOMRect | null {
  const el = document.querySelector(`[data-tour="${target}"]`);
  if (!(el instanceof HTMLElement)) return null;
  return el.getBoundingClientRect();
}

export function ProductTour({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = TOUR_STEPS[index];

  const finish = () => {
    persistTourSeen();
    onClose();
  };

  useEffect(() => {
    if (!open) {
      setIndex(0);
      setPlaying(true);
      setRect(null);
      document.querySelectorAll(".ir-tour-active").forEach((n) => n.classList.remove("ir-tour-active"));
      return;
    }

    const apply = () => {
      document.querySelectorAll(".ir-tour-active").forEach((n) => n.classList.remove("ir-tour-active"));
      const el = document.querySelector(`[data-tour="${step.target}"]`);
      if (el instanceof HTMLElement) {
        el.classList.add("ir-tour-active");
        el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
      }
      const read = () => setRect(measureTarget(step.target));
      read();
      window.requestAnimationFrame(read);
    };

    apply();
    const afterScroll = window.setTimeout(apply, 380);
    const onWin = () => setRect(measureTarget(step.target));
    window.addEventListener("resize", onWin);
    window.addEventListener("scroll", onWin, true);
    return () => {
      window.clearTimeout(afterScroll);
      window.removeEventListener("resize", onWin);
      window.removeEventListener("scroll", onWin, true);
    };
  }, [open, step]);

  useEffect(() => {
    if (!open || !playing) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const t = window.setTimeout(() => {
      if (index >= TOUR_STEPS.length - 1) finish();
      else setIndex((i) => i + 1);
    }, step.ms);
    return () => window.clearTimeout(t);
  }, [open, playing, index, step.ms]);

  if (!open || !step) return null;

  const spot = rect
    ? {
        top: Math.max(6, rect.top - PAD),
        left: Math.max(6, rect.left - PAD),
        width: Math.min(window.innerWidth - 12, Math.max(48, rect.width + PAD * 2)),
        height: Math.max(36, rect.height + PAD * 2),
      }
    : null;

  const cardOnTop = spot ? spot.top + spot.height > window.innerHeight * 0.55 : false;
  const cardStyle = spot
    ? cardOnTop
      ? { bottom: Math.max(16, window.innerHeight - spot.top + 16), left: Math.min(spot.left, window.innerWidth - 420) }
      : { top: Math.min(window.innerHeight - 220, spot.top + spot.height + 16), left: Math.min(spot.left, window.innerWidth - 420) }
    : { bottom: 24, left: 24 };

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-label="Guided tour">
      {spot ? (
        <>
          <button
            type="button"
            aria-label="Skip tour"
            className="ir-tour-veil absolute left-0 right-0 top-0"
            style={{ height: spot.top }}
            onClick={finish}
          />
          <button
            type="button"
            aria-label="Skip tour"
            className="ir-tour-veil absolute bottom-0 left-0 right-0"
            style={{ top: spot.top + spot.height }}
            onClick={finish}
          />
          <button
            type="button"
            aria-label="Skip tour"
            className="ir-tour-veil absolute left-0"
            style={{ top: spot.top, height: spot.height, width: spot.left }}
            onClick={finish}
          />
          <button
            type="button"
            aria-label="Skip tour"
            className="ir-tour-veil absolute right-0"
            style={{ top: spot.top, height: spot.height, left: spot.left + spot.width }}
            onClick={finish}
          />
          <div
            className="ir-tour-spot pointer-events-none absolute"
            style={{
              top: spot.top,
              left: spot.left,
              width: spot.width,
              height: spot.height,
            }}
          />
        </>
      ) : (
        <button type="button" className="ir-tour-veil absolute inset-0" aria-label="Skip tour" onClick={finish} />
      )}

      <div
        className="absolute z-10 w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-primary/50 bg-surface p-4 shadow-[0_18px_60px_rgba(0,0,0,0.55)]"
        style={cardStyle}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-xs tabular-nums text-subtle">
              {String(index + 1).padStart(2, "0")} / {String(TOUR_STEPS.length).padStart(2, "0")} · looking at this control
            </p>
            <h2 className="mt-1 font-display text-xl tracking-[-0.02em] text-fg">{step.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{step.subtitle}</p>
          </div>
          <button type="button" className="size-11 shrink-0 text-muted hover:text-fg" onClick={finish} aria-label="Skip tour">
            <X className="size-5" />
          </button>
        </div>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-border">
          <span
            className="block h-full bg-primary transition-[width] duration-300"
            style={{ width: `${((index + 1) / TOUR_STEPS.length) * 100}%` }}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant="subtle"
            size="sm"
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? "Pause tour" : "Play tour"}
          >
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
            {playing ? "Pause" : "Play"}
          </Button>
          <Button variant="ghost" size="sm" disabled={index === 0} onClick={() => setIndex((i) => Math.max(0, i - 1))}>
            Back
          </Button>
          <Button
            size="sm"
            onClick={() => {
              if (index >= TOUR_STEPS.length - 1) finish();
              else setIndex((i) => i + 1);
            }}
          >
            {index >= TOUR_STEPS.length - 1 ? "Finish" : "Next"}
            <SkipForward className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function TourLauncher({ onStart }: { onStart: () => void }) {
  return (
    <Button onClick={onStart} className="min-h-11" data-tour="tour-launch">
      <Play className="size-4" />
      Watch the guided tour
    </Button>
  );
}
