import { useEffect, useRef } from "react";
import { clamp01, damp, decayFromHalfLife } from "./curves";

const reducedMotion = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A one-shot, time-based scene. `render(p)` draws the frame for progress p in
 * [0, 1]; the scene plays once over `duration` ms when it first scrolls into
 * view, then rests on its final frame. `replay()` plays it again.
 * Reduced motion: the final frame, immediately.
 */
export function useTimeline<T extends HTMLElement>(duration: number, render: (p: number) => void) {
  const ref = useRef<T>(null);
  const renderRef = useRef(render);
  renderRef.current = render;
  const play = useRef<() => void>(() => {});

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    let start = 0;
    const tick = (now: number) => {
      if (!start) start = now;
      const p = clamp01((now - start) / duration);
      renderRef.current(p);
      frame = p < 1 ? requestAnimationFrame(tick) : 0;
    };
    play.current = () => {
      cancelAnimationFrame(frame);
      if (reducedMotion()) { renderRef.current(1); return; }
      start = 0;
      frame = requestAnimationFrame(tick);
    };
    renderRef.current(0);
    if (typeof IntersectionObserver === "undefined") { play.current(); return () => cancelAnimationFrame(frame); }
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting) { io.disconnect(); play.current(); }
    }, { threshold: 0.35 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(frame); };
  }, [duration]);

  return { ref, replay: () => play.current() };
}

function scrollParent(el: HTMLElement): HTMLElement | Window {
  for (let n = el.parentElement; n; n = n.parentElement) {
    const o = getComputedStyle(n).overflowY;
    if ((o === "auto" || o === "scroll") && n.scrollHeight > n.clientHeight) return n;
  }
  return window;
}

/**
 * A scroll-pinned scene: a tall section with a sticky stage, drawn as a pure
 * function of how far the section has been scrolled through (works inside a
 * scrolling panel as well as the window). Progress is smoothed with a 70 ms
 * half-life; under reduced motion it follows the scrollbar exactly.
 */
export function useScrollScene<T extends HTMLElement>(render: (p: number, size: { w: number; h: number }) => void) {
  const ref = useRef<T>(null);
  const renderRef = useRef(render);
  renderRef.current = render;

  useEffect(() => {
    const section = ref.current;
    if (!section) return;
    const reduced = reducedMotion();
    const decay = decayFromHalfLife(0.07);
    const scroller = scrollParent(section);
    const viewport = () => (scroller === window ? { top: 0, h: window.innerHeight } : (() => { const r = (scroller as HTMLElement).getBoundingClientRect(); return { top: r.top, h: r.height }; })());
    let shown = -1, frame = 0, last = 0;
    let size = { w: 0, h: 0 };
    const measure = () => {
      const stage = section.firstElementChild as HTMLElement | null;
      size = { w: stage?.clientWidth ?? 0, h: stage?.clientHeight ?? 0 };
    };
    const read = () => {
      const r = section.getBoundingClientRect();
      const v = viewport();
      const travel = r.height - v.h;
      return travel <= 0 ? 0 : clamp01((v.top - r.top) / travel);
    };
    const tick = (now: number) => {
      frame = 0;
      const dt = last ? Math.min(0.064, (now - last) / 1000) : 1 / 60;
      last = now;
      const target = read();
      const next = reduced || shown < 0 ? target : damp(shown, target, decay, dt);
      const settled = Math.abs(next - target) < 0.0004;
      shown = settled ? target : next;
      renderRef.current(shown, size);
      if (!settled) frame = requestAnimationFrame(tick); else last = 0;
    };
    const wake = () => { if (!frame) frame = requestAnimationFrame(tick); };
    const resize = () => { measure(); shown = -1; wake(); };
    measure();
    wake();
    const target: EventTarget = scroller;
    target.addEventListener("scroll", wake, { passive: true });
    window.addEventListener("resize", resize);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    ro?.observe(section);
    return () => {
      cancelAnimationFrame(frame);
      target.removeEventListener("scroll", wake);
      window.removeEventListener("resize", resize);
      ro?.disconnect();
    };
  }, []);

  return ref;
}
