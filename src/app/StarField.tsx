import { useEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';
import { cn } from '@/lib/cn';

interface Star {
  x: number;
  y: number;
  radius: number;
  alpha: number;
  phase: number;
  speed: number;
  tone: 'white' | 'violet' | 'gold';
}

function makeStars(count: number): Star[] {
  const stars: Star[] = [];
  for (let i = 0; i < count; i += 1) {
    const roll = Math.random();
    stars.push({
      x: Math.random(),
      y: Math.random(),
      radius: 0.35 + Math.random() * 1.25,
      alpha: 0.18 + Math.random() * 0.62,
      phase: Math.random() * Math.PI * 2,
      speed: 0.15 + Math.random() * 0.55,
      tone: roll > 0.93 ? 'gold' : roll > 0.82 ? 'violet' : 'white',
    });
  }
  return stars;
}

const TONES = {
  white: [235, 241, 250],
  violet: [185, 161, 232],
  gold: [240, 212, 156],
} as const;

/**
 * Fixed, decorative night sky. Renders a single static frame when the user
 * prefers reduced motion, and pauses while the tab is hidden.
 */
export function StarField({ className, intensity = 1 }: { className?: string; intensity?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    let stars: Star[] = [];
    let width = 0;
    let height = 0;
    let raf = 0;
    let lastDraw = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    const resize = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round(
        Math.min(220, Math.max(55, (width * height) / 14000)) * Math.max(0.4, Math.min(1.6, intensity)),
      );
      if (stars.length !== count) stars = makeStars(count);
      draw(performance.now());
    };

    const draw = (time: number) => {
      context.clearRect(0, 0, width, height);
      for (const star of stars) {
        const twinkle = reduced ? 1 : 0.72 + 0.28 * Math.sin(time * 0.00055 * star.speed + star.phase);
        const alpha = Math.min(0.95, star.alpha * twinkle);
        const drift = reduced ? 0 : Math.sin(time * 0.00008 + star.phase) * 3;
        const x = star.x * width + drift;
        const y = star.y * height;
        const [r, g, b] = TONES[star.tone];
        context.beginPath();
        context.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        context.arc(x, y, star.radius, 0, Math.PI * 2);
        context.fill();
        if (star.radius > 1.45) {
          context.beginPath();
          context.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha * 0.12})`;
          context.arc(x, y, star.radius * 4.2, 0, Math.PI * 2);
          context.fill();
        }
      }
    };

    const loop = (time: number) => {
      if (document.hidden) {
        raf = requestAnimationFrame(loop);
        return;
      }
      if (time - lastDraw > 40) {
        draw(time);
        lastDraw = time;
      }
      raf = requestAnimationFrame(loop);
    };

    resize();
    if (reduced) {
      draw(0);
    } else {
      raf = requestAnimationFrame(loop);
    }

    const onResize = () => {
      resize();
      if (reduced) draw(0);
    };
    const onVisibility = () => {
      if (!document.hidden && !reduced) draw(performance.now());
    };

    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intensity, reduced]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={cn('pointer-events-none fixed inset-0 z-0 size-full', className)}
    />
  );
}
