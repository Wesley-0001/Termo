import { type RefObject, useEffect, useRef } from "react";

type Particle = {
  x: number;
  y: number;
  vx: number;
  r: number;
  a: number;
  wobbleOmega: number;
  wobblePhase: number;
};

const INITIAL_COUNT = 162;
const MAX_PARTICLES = 400;
const SPAWN_MIN = 4;
const SPAWN_MAX = 7;
const VX_MIN = 0.12;
const VX_MAX = 0.48;
const WOBBLE_AMP = 0.38;

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function randInt(min: number, max: number) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function createParticle(w: number, h: number, nearX?: number, nearY?: number): Particle {
  const cluster = nearX !== undefined && nearY !== undefined;
  const x = cluster ? wrap(nearX + rand(-42, 42), w) : Math.random() * w;
  const y = cluster ? wrap(nearY + rand(-32, 32), h) : Math.random() * h;
  return {
    x,
    y,
    vx: rand(VX_MIN, VX_MAX),
    r: Math.random() < 0.78 ? rand(1.1, 1.55) : rand(1.75, 2.2),
    a: rand(0.13, 0.3),
    wobbleOmega: rand(0.0009, 0.0024),
    wobblePhase: rand(0, Math.PI * 2),
  };
}

function wrap(v: number, max: number) {
  if (max < 1) return 0;
  let t = v % max;
  if (t < 0) t += max;
  return t;
}

/**
 * Ignora cliques que não são “área vazia”: tabuleiro, teclado, botões, links e controles.
 */
function shouldIgnoreParticleSpawn(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null;
  if (!el) return true;
  if (el.closest(".verbo__board-shell, .verbo__grid, .verbo__keyboard")) return true;
  if (
    el.closest(
      'button, a[href], input, textarea, select, summary, iframe, [role="button"], [role="link"], [contenteditable="true"]'
    )
  ) {
    return true;
  }
  return false;
}

type Props = {
  containerRef: RefObject<HTMLDivElement | null>;
};

/**
 * Fundo em Canvas 2D (atrás do TERMO): partículas discretas, drift horizontal, spawn em área vazia.
 * O canvas tem `pointer-events: none`; cliques são observados no `containerRef`.
 */
export default function TermoStarfield({ containerRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const sizeRef = useRef({ w: 0, h: 0 });
  const reducedRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let raf = 0;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedRef.current = mq.matches;

    function renderFrame(tMs: number) {
      const w = sizeRef.current.w;
      const h = sizeRef.current.h;
      const list = particlesRef.current;
      if (w < 1 || h < 1) return;

      ctx.clearRect(0, 0, w, h);
      const reduced = reducedRef.current;

      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        const wob = reduced ? 0 : Math.sin(tMs * p.wobbleOmega + p.wobblePhase) * WOBBLE_AMP;
        const yRender = p.y + wob;
        ctx.fillStyle = `rgba(168, 207, 240, ${p.a})`;
        ctx.beginPath();
        ctx.arc(p.x, yRender, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function tick(tMs: number) {
      const w = sizeRef.current.w;
      const h = sizeRef.current.h;
      const list = particlesRef.current;
      if (w >= 1 && h >= 1 && list.length && !reducedRef.current) {
        for (let i = 0; i < list.length; i++) {
          const p = list[i];
          p.x += p.vx;
          if (p.x > w + 2) p.x -= w + 4;
        }
      }
      renderFrame(tMs);
      raf = requestAnimationFrame(tick);
    }

    const spawnBurst = (cx: number, cy: number) => {
      const w = sizeRef.current.w;
      const h = sizeRef.current.h;
      if (w < 1 || h < 1) return;
      const n = randInt(SPAWN_MIN, SPAWN_MAX);
      const list = particlesRef.current;
      while (list.length + n > MAX_PARTICLES) {
        list.shift();
      }
      for (let i = 0; i < n; i++) {
        list.push(createParticle(w, h, cx, cy));
      }
      renderFrame(performance.now());
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (shouldIgnoreParticleSpawn(e.target)) return;
      spawnBurst(e.clientX, e.clientY);
    };

    container.addEventListener("pointerdown", onPointerDown);

    const onMq = () => {
      reducedRef.current = mq.matches;
      cancelAnimationFrame(raf);
      raf = 0;
      renderFrame(performance.now());
      if (!mq.matches) {
        raf = requestAnimationFrame(tick);
      }
    };
    mq.addEventListener("change", onMq);

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = window.innerWidth;
      const h = window.innerHeight;
      sizeRef.current.w = w;
      sizeRef.current.h = h;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const next: Particle[] = [];
      for (let i = 0; i < INITIAL_COUNT; i++) {
        next.push(createParticle(w, h));
      }
      particlesRef.current = next;
      renderFrame(performance.now());
    };

    window.addEventListener("resize", resize);
    resize();

    if (reducedRef.current) {
      renderFrame(performance.now());
    } else {
      raf = requestAnimationFrame(tick);
    }

    return () => {
      mq.removeEventListener("change", onMq);
      window.removeEventListener("resize", resize);
      container.removeEventListener("pointerdown", onPointerDown);
      cancelAnimationFrame(raf);
    };
  }, [containerRef]);

  return <canvas ref={canvasRef} className="verbo__starfield" aria-hidden />;
}
