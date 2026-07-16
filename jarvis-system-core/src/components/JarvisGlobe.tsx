import React, { useEffect, useRef } from "react";

/* Cinematic JARVIS energy-sphere — one self-contained Canvas, no libraries.
 * ~680 points on a slowly rotating, tilted Fibonacci sphere with a pulsing core,
 * a soft radial glow, a tilted orbital ring with a moving marker, three dashed HUD
 * arcs spinning at different speeds, and an outer tick ring. It gently "breathes"
 * when idle and pulses harder + faster while JARVIS is speaking.
 *
 * Free, dependency-free, retina-aware, and pauses its animation when off-screen /
 * the tab is hidden so it costs nothing on the free tier when you're not looking.
 */

interface Props {
  speaking?: boolean;         // drives the harder/faster pulse
  level?: React.MutableRefObject<number>;  // live audio envelope 0..1 (or <0 = no signal → synthetic)
  size?: number;              // CSS px (square); defaults to the container width
  className?: string;
}

const CYAN = { r: 138, g: 235, b: 255 };
const POINTS = 680;

// Precomputed unit-sphere points via the Fibonacci spiral (even distribution).
function fibonacciSphere(n: number): [number, number, number][] {
  const pts: [number, number, number][] = [];
  const phi = Math.PI * (3 - Math.sqrt(5)); // golden angle
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2; // 1 → -1
    const r = Math.sqrt(1 - y * y);
    const theta = phi * i;
    pts.push([Math.cos(theta) * r, y, Math.sin(theta) * r]);
  }
  return pts;
}

export default function JarvisGlobe({ speaking = false, level, size, className = "" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const speakingRef = useRef(speaking);

  useEffect(() => { speakingRef.current = speaking; }, [speaking]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const sphere = fibonacciSphere(POINTS);
    let raf = 0;
    let t = 0;
    let cssSize = size || wrap.clientWidth || 320;
    let visible = true;

    const dpr = () => Math.min(window.devicePixelRatio || 1, 2); // cap at 2 for perf

    const resize = () => {
      cssSize = size || wrap.clientWidth || 320;
      const ratio = dpr();
      canvas.width = Math.round(cssSize * ratio);
      canvas.height = Math.round(cssSize * ratio);
      canvas.style.width = `${cssSize}px`;
      canvas.style.height = `${cssSize}px`;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // Pause the loop when scrolled off-screen or the tab is hidden.
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0.05 });
    io.observe(wrap);

    const rgba = (a: number) => `rgba(${CYAN.r},${CYAN.g},${CYAN.b},${a})`;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (!visible || document.hidden) return;
      t += 1;

      const S = cssSize;
      const cx = S / 2;
      const cy = S / 2;
      const baseR = S * 0.30;

      // Breathing / speaking pulse envelope.
      const spk = speakingRef.current;
      const live = level?.current ?? -1; // >=0 → real audio envelope; <0 → no signal
      let pulse: number;
      if (spk && live >= 0) {
        pulse = 0.4 + live * 1.0; // real audio envelope (louder → bigger)
      } else if (spk) {
        // synthetic "speech" envelope — layered sines so it feels like cadence
        pulse = 0.55 + 0.28 * Math.abs(Math.sin(t * 0.13)) + 0.18 * Math.abs(Math.sin(t * 0.37 + 1));
      } else {
        pulse = 0.42 + 0.06 * Math.sin(t * 0.03); // slow idle breathe
      }
      const R = baseR * (1 + (spk ? 0.06 : 0.02) * Math.sin(t * (spk ? 0.18 : 0.04)));

      ctx.clearRect(0, 0, S, S);

      // Soft radial glow behind the sphere.
      const glow = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 2.1);
      glow.addColorStop(0, rgba(0.16 + pulse * 0.14));
      glow.addColorStop(0.5, rgba(0.05));
      glow.addColorStop(1, rgba(0));
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, S, S);

      // Outer tick ring.
      const ticks = 72;
      ctx.strokeStyle = rgba(0.22);
      ctx.lineWidth = 1;
      for (let i = 0; i < ticks; i++) {
        const a = (i / ticks) * Math.PI * 2 + t * 0.0015;
        const r1 = R * 1.85, r2 = R * 1.85 + (i % 6 === 0 ? 9 : 4);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
        ctx.stroke();
      }

      // Three dashed concentric HUD arcs at different speeds.
      const arcs = [
        { r: R * 1.55, speed: 0.010, span: 1.7, w: 1.5, a: 0.5 },
        { r: R * 1.42, speed: -0.016, span: 1.1, w: 1, a: 0.35 },
        { r: R * 1.68, speed: 0.006, span: 0.7, w: 2, a: 0.6 },
      ];
      ctx.setLineDash([6, 8]);
      for (const arc of arcs) {
        ctx.beginPath();
        ctx.strokeStyle = rgba(arc.a);
        ctx.lineWidth = arc.w;
        const start = t * arc.speed;
        ctx.arc(cx, cy, arc.r, start, start + arc.span);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Rotation angles (tilted, slowly spinning).
      const ay = t * 0.006;             // yaw
      const tilt = 0.42;                // fixed forward tilt
      const cosY = Math.cos(ay), sinY = Math.sin(ay);
      const cosT = Math.cos(tilt), sinT = Math.sin(tilt);

      // Project + draw sphere points, brighter/larger toward the viewer.
      for (let i = 0; i < sphere.length; i++) {
        let [x, y, z] = sphere[i];
        // yaw around Y
        const x1 = x * cosY - z * sinY;
        const z1 = x * sinY + z * cosY;
        // tilt around X
        const y2 = y * cosT - z1 * sinT;
        const z2 = y * sinT + z1 * cosT;
        const depth = (z2 + 1) / 2; // 0 (back) .. 1 (front)
        const px = cx + x1 * R;
        const py = cy + y2 * R;
        const rad = 0.6 + depth * 1.7;
        const alpha = 0.15 + depth * (0.55 + pulse * 0.4);
        ctx.beginPath();
        ctx.fillStyle = rgba(alpha);
        ctx.arc(px, py, rad, 0, Math.PI * 2);
        ctx.fill();
      }

      // Tilted orbital ring (ellipse) with a glowing marker riding it.
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-0.5);
      ctx.strokeStyle = rgba(0.3);
      ctx.lineWidth = 1.2;
      const orx = R * 1.35, ory = R * 0.5;
      ctx.beginPath();
      ctx.ellipse(0, 0, orx, ory, 0, 0, Math.PI * 2);
      ctx.stroke();
      const ma = t * 0.02;
      const mx = Math.cos(ma) * orx, my = Math.sin(ma) * ory;
      const mg = ctx.createRadialGradient(mx, my, 0, mx, my, 7);
      mg.addColorStop(0, rgba(0.95));
      mg.addColorStop(1, rgba(0));
      ctx.fillStyle = mg;
      ctx.beginPath();
      ctx.arc(mx, my, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Bright pulsing core.
      const coreR = R * (0.16 + pulse * 0.14);
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
      core.addColorStop(0, `rgba(255,255,255,${0.9})`);
      core.addColorStop(0.35, rgba(0.85));
      core.addColorStop(1, rgba(0));
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fill();
    };

    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); };
  }, [size]);

  return (
    <div ref={wrapRef} className={`relative w-full aspect-square ${className}`}>
      <canvas ref={canvasRef} className="block w-full h-full" />
    </div>
  );
}
