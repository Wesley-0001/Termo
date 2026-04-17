import { type RefObject, useEffect, useRef } from "react";

type Node = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
};

type Edge = [number, number];

type PointerInfluence = {
  x: number;
  y: number;
  /** 0–1: opcional; 0 = só animação automática */
  weight: number;
};

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function wrap(v: number, max: number) {
  if (max < 1) return 0;
  let t = v % max;
  if (t < 0) t += max;
  return t;
}

function dist2(ax: number, ay: number, bx: number, by: number) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function computeBoosts(
  nodes: Node[],
  w: number,
  h: number,
  inf: PointerInfluence | null,
  out: number[]
): void {
  const n = nodes.length;
  if (!inf || inf.weight <= 0) {
    for (let i = 0; i < n; i++) out[i] = 0;
    return;
  }
  const hot = Math.min(w, h) * 0.26;
  const hot2 = hot * hot;
  for (let i = 0; i < n; i++) {
    const d2 = dist2(nodes[i].x, nodes[i].y, inf.x, inf.y);
    if (d2 >= hot2) {
      out[i] = 0;
    } else {
      const d = Math.sqrt(d2);
      out[i] = inf.weight * (1 - d / hot);
    }
  }
}

/**
 * Arestas por proximidade; raio efetivo por nó cresce perto do ponteiro (mais conexões na zona).
 */
function buildProximityEdges(
  nodes: Node[],
  w: number,
  h: number,
  boost: number[],
  baseMaxR: number,
  maxPer: number
): Edge[] {
  const n = nodes.length;
  const edges: Edge[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < n; i++) {
    const ri = baseMaxR * (1 + 0.42 * boost[i]);
    const dists: { j: number; d2: number }[] = [];
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const rj = baseMaxR * (1 + 0.42 * boost[j]);
      const cap = 0.5 * (ri + rj);
      const cap2 = cap * cap;
      const d2 = dist2(nodes[i].x, nodes[i].y, nodes[j].x, nodes[j].y);
      if (d2 <= cap2) dists.push({ j, d2 });
    }
    dists.sort((a, b) => a.d2 - b.d2);
    const take = Math.min(maxPer, dists.length);
    for (let k = 0; k < take; k++) {
      const j = dists[k].j;
      const a = Math.min(i, j);
      const b = Math.max(i, j);
      const key = `${a},${b}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push([a, b]);
      }
    }
  }
  return edges;
}

function createNodes(count: number, w: number, h: number): Node[] {
  const nodes: Node[] = [];
  for (let i = 0; i < count; i++) {
    nodes.push({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: rand(-0.1, 0.1),
      vy: rand(-0.08, 0.08),
      phase: rand(0, Math.PI * 2),
    });
  }
  return nodes;
}

type Props = {
  containerRef: RefObject<HTMLDivElement | null>;
};

/**
 * Fundo decorativo: malha de pontos e linhas (teia / vetores), canvas atrás do jogo.
 * Animação automática (flutuação + proximidade); mouse/toque opcionais influenciam via `containerRef`.
 * Canvas mantém `pointer-events: none` — eventos no container.
 */
export default function VerboWebField({ containerRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<Node[]>([]);
  const edgesRef = useRef<Edge[]>([]);
  const boostScratchRef = useRef<number[]>([]);
  const sizeRef = useRef({ w: 0, h: 0 });
  const reducedRef = useRef(false);
  const mobileRef = useRef(false);
  const influenceRef = useRef<PointerInfluence>({ x: 0, y: 0, weight: 0 });
  const pointerInContainerRef = useRef(false);
  const pointerDownRef = useRef(false);
  const pointerCoordsValidRef = useRef(false);
  const lastPointerTypeRef = useRef<"touch" | "other">("other");
  const frameIdxRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let raf = 0;
    const mqReduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedRef.current = mqReduce.matches;

    function nodeCountForViewport(w: number) {
      mobileRef.current = w < 640;
      if (w < 420) return 20;
      if (w < 640) return 28;
      return 38;
    }

    function baseLinkRadius(w: number, h: number) {
      return Math.min(w, h) * 0.118;
    }

    function maxEdgesPerNode() {
      return influenceRef.current.weight > 0.25 ? 4 : 3;
    }

    /** Mouse/caneta: hover no container. Touch: só com dedo pressionado (pointerdown…up). */
    function influenceWeightNow(): number {
      if (!pointerInContainerRef.current) return 0;
      if (lastPointerTypeRef.current === "touch") {
        return pointerDownRef.current && pointerCoordsValidRef.current ? 1 : 0;
      }
      return pointerCoordsValidRef.current ? 1 : 0;
    }

    function rebuildEdgesIfDue() {
      const w = sizeRef.current.w;
      const h = sizeRef.current.h;
      const nodes = nodesRef.current;
      if (w < 1 || h < 1 || !nodes.length) return;

      const mobile = mobileRef.current;
      frameIdxRef.current++;
      const period = mobile ? 2 : 1;
      if (frameIdxRef.current % period !== 0) return;

      const boosts = boostScratchRef.current;
      if (boosts.length < nodes.length) {
        boostScratchRef.current = new Array(nodes.length).fill(0);
      }
      const b = boostScratchRef.current;
      const inf = influenceRef.current;
      computeBoosts(nodes, w, h, inf.weight > 0 ? inf : null, b);

      const br = baseLinkRadius(w, h);
      edgesRef.current = buildProximityEdges(nodes, w, h, b, br, maxEdgesPerNode());
    }

    function renderFrame(tMs: number) {
      const w = sizeRef.current.w;
      const h = sizeRef.current.h;
      const nodes = nodesRef.current;
      const edges = edgesRef.current;
      if (w < 1 || h < 1 || !nodes.length) return;

      ctx.clearRect(0, 0, w, h);
      const reduced = reducedRef.current;
      const mobile = mobileRef.current;

      const lineBase = mobile ? 0.085 : 0.095;
      const breathe = reduced ? 0 : Math.sin(tMs * 0.00032) * 0.018;

      for (let i = 0; i < edges.length; i++) {
        const [ia, ib] = edges[i];
        const a = nodes[ia];
        const b = nodes[ib];
        if (!a || !b) continue;
        const pulse = reduced ? 0.12 : lineBase + breathe + Math.sin(tMs * 0.00035 + ia * 0.2) * 0.028;
        ctx.strokeStyle = `rgba(120, 162, 208, ${pulse})`;
        ctx.lineWidth = mobile ? 0.5 : 0.58;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      const nodeAlpha = mobile ? 0.19 : 0.24;
      const nodeR = mobile ? 1.0 : 1.1;
      for (let i = 0; i < nodes.length; i++) {
        const p = nodes[i];
        const wob = reduced ? 0 : Math.sin(tMs * 0.00052 + p.phase) * 0.32;
        ctx.fillStyle = `rgba(175, 200, 230, ${nodeAlpha + wob * 0.05})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, nodeR, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function tick(tMs: number) {
      const w = sizeRef.current.w;
      const h = sizeRef.current.h;
      const nodes = nodesRef.current;
      if (w >= 1 && h >= 1 && nodes.length && !reducedRef.current) {
        const s = mobileRef.current ? 0.62 : 1;
        const ft = tMs * 0.00034;

        influenceRef.current.weight = influenceWeightNow();

        const inf = influenceRef.current;
        const attractR = Math.min(w, h) * 0.3;
        const attractR2 = attractR * attractR;
        const pullMul = (mobileRef.current ? 0.014 : 0.017) * inf.weight;

        for (let i = 0; i < nodes.length; i++) {
          const p = nodes[i];
          p.x += p.vx * s;
          p.y += p.vy * s;
          p.x += Math.cos(ft + p.phase) * 0.1 * s;
          p.y += Math.sin(ft * 0.88 + p.phase * 1.2) * 0.085 * s;

          if (inf.weight > 0 && pullMul > 0) {
            const dx = inf.x - p.x;
            const dy = inf.y - p.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < attractR2 && d2 > 2) {
              const t = 1 - Math.sqrt(d2) / attractR;
              const pull = pullMul * t * t;
              p.x += dx * pull;
              p.y += dy * pull;
            }
          }

          p.x = wrap(p.x, w);
          p.y = wrap(p.y, h);
        }

        rebuildEdgesIfDue();
      } else if (nodes.length) {
        rebuildEdgesIfDue();
      }

      renderFrame(tMs);
      raf = requestAnimationFrame(tick);
    }

    const onMq = () => {
      reducedRef.current = mqReduce.matches;
      cancelAnimationFrame(raf);
      raf = 0;
      renderFrame(performance.now());
      if (!mqReduce.matches) {
        raf = requestAnimationFrame(tick);
      }
    };
    mqReduce.addEventListener("change", onMq);

    const setPointerClient = (clientX: number, clientY: number) => {
      influenceRef.current.x = clientX;
      influenceRef.current.y = clientY;
    };

    const onPointerEnter = (e: PointerEvent) => {
      pointerInContainerRef.current = true;
      pointerCoordsValidRef.current = false;
      if (e.pointerType) {
        lastPointerTypeRef.current = e.pointerType === "touch" ? "touch" : "other";
      }
    };

    const onPointerLeave = () => {
      pointerInContainerRef.current = false;
      pointerDownRef.current = false;
      pointerCoordsValidRef.current = false;
      influenceRef.current.weight = 0;
    };

    const onPointerDown = (e: PointerEvent) => {
      lastPointerTypeRef.current = e.pointerType === "touch" ? "touch" : "other";
      pointerDownRef.current = true;
      pointerCoordsValidRef.current = true;
      setPointerClient(e.clientX, e.clientY);
    };

    const onPointerMove = (e: PointerEvent) => {
      lastPointerTypeRef.current = e.pointerType === "touch" ? "touch" : "other";
      if (e.pointerType === "touch" && !pointerDownRef.current) return;
      pointerCoordsValidRef.current = true;
      setPointerClient(e.clientX, e.clientY);
    };

    const onPointerUp = () => {
      pointerDownRef.current = false;
    };

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

      const n = nodeCountForViewport(w);
      const next = createNodes(n, w, h);
      nodesRef.current = next;
      boostScratchRef.current = new Array(n).fill(0);
      frameIdxRef.current = 0;
      computeBoosts(next, w, h, influenceRef.current, boostScratchRef.current);
      edgesRef.current = buildProximityEdges(
        next,
        w,
        h,
        boostScratchRef.current,
        baseLinkRadius(w, h),
        maxEdgesPerNode()
      );
      renderFrame(performance.now());
    };

    window.addEventListener("resize", resize);

    container.addEventListener("pointerenter", onPointerEnter);
    container.addEventListener("pointerleave", onPointerLeave);
    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerup", onPointerUp);
    container.addEventListener("pointercancel", onPointerUp);

    resize();

    if (reducedRef.current) {
      renderFrame(performance.now());
    } else {
      raf = requestAnimationFrame(tick);
    }

    return () => {
      mqReduce.removeEventListener("change", onMq);
      window.removeEventListener("resize", resize);
      container.removeEventListener("pointerenter", onPointerEnter);
      container.removeEventListener("pointerleave", onPointerLeave);
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("pointercancel", onPointerUp);
      cancelAnimationFrame(raf);
    };
  }, [containerRef]);

  return <canvas ref={canvasRef} className="verbo__webfield" aria-hidden />;
}
