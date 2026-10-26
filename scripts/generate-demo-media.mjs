#!/usr/bin/env node
/**
 * Generates the six fictional OURVERSE demo media assets.
 *
 * Everything is rendered locally with a seeded PRNG inside headless Chromium.
 * No network access, no remote assets, no real people or places.
 *
 * Usage:
 *   node scripts/generate-demo-media.mjs
 */

import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const outputDir = join(repoRoot, 'src', 'assets', 'demo');
const screenshotDir = join(repoRoot, 'artifacts', 'screenshots');

const ASSETS = {
  sea: 'sea-sunset.jpg',
  rain: 'rain-street.webp',
  mountain: 'mountain-stars.png',
  train: 'night-train.jpg',
  audio: 'room-tone.mp3',
  video: 'balcony-moon.webm',
};

const require = createRequire(import.meta.url);
const TAU = Math.PI * 2;

function smoothstep(edge0, edge1, value) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function formatBytes(bytes) {
  return new Intl.NumberFormat('en-US').format(bytes) + ' B';
}

function findCachedChromium() {
  const candidates = [];
  try {
    const expected = chromium.executablePath();
    if (expected) candidates.push(expected);
  } catch {
    // Playwright may not know where the browser lives until it is downloaded.
  }

  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, 'ms-playwright')
      : null,
    process.env.USERPROFILE
      ? join(process.env.USERPROFILE, 'AppData', 'Local', 'ms-playwright')
      : null,
    process.env.HOME ? join(process.env.HOME, '.cache', 'ms-playwright') : null,
    process.env.HOME
      ? join(process.env.HOME, 'Library', 'Caches', 'ms-playwright')
      : null,
  ].filter(Boolean);

  const seen = new Set();
  for (const root of roots) {
    if (seen.has(root) || !existsSync(root)) continue;
    seen.add(root);

    let entries = [];
    try {
      entries = readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }

    const revisions = entries
      .filter((entry) => entry.isDirectory() && /^chromium-\d+$/.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));

    for (const revision of revisions) {
      const base = join(root, revision);
      candidates.push(
        join(base, 'chrome-win64', 'chrome.exe'),
        join(base, 'chrome-win', 'chrome.exe'),
        join(base, 'chrome-linux', 'chrome'),
        join(base, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
        join(base, 'chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
      );
    }
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  throw new Error(
    'No installed Playwright Chromium executable was found. ' +
      'Install one with `npx playwright install chromium` (no download is attempted by this script).',
  );
}

function launchOptions(executablePath) {
  return {
    executablePath,
    headless: true,
    args: [
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--autoplay-policy=no-user-gesture-required',
    ],
  };
}

/**
 * Browser-side rendering runtime. This function is serialized into Chromium;
 * it must not reference anything from Node.
 */
function installPageRuntime() {
  const TAU = Math.PI * 2;
  const W = 1600;
  const H = 1000;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function smoothstep(edge0, edge1, value) {
    const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function mulberry32(seed) {
    let state = seed >>> 0;
    return function random() {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), 1 | t);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeCanvas(width, height, opaque = false) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return {
      canvas,
      ctx: canvas.getContext('2d', { alpha: !opaque }),
    };
  }

  function rgba(hex, alpha) {
    const value = parseInt(hex.slice(1), 16);
    return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
  }

  function roundRectPath(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function addGrain(ctx, width, height, seed, options = {}) {
    const {
      alpha = 0.032,
      scale = 1,
      mode = 'overlay',
    } = options;
    const nw = Math.max(1, Math.round(width / scale));
    const nh = Math.max(1, Math.round(height / scale));
    const { canvas, ctx: nctx } = makeCanvas(nw, nh, false);
    const image = nctx.createImageData(nw, nh);
    const data = image.data;
    const random = mulberry32(seed);

    for (let i = 0; i < data.length; i += 4) {
      const v = Math.round(128 + (random() * 2 - 1) * 112);
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
    nctx.putImageData(image, 0, 0);

    ctx.save();
    ctx.globalCompositeOperation = mode;
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(canvas, 0, 0, width, height);
    ctx.restore();
  }

  function addVignette(ctx, width, height, strength = 0.42, warmth = '#02060C') {
    const gradient = ctx.createRadialGradient(
      width * 0.5,
      height * 0.46,
      Math.min(width, height) * 0.22,
      width * 0.5,
      height * 0.5,
      Math.hypot(width, height) * 0.56,
    );
    gradient.addColorStop(0, rgba(warmth, 0));
    gradient.addColorStop(0.56, rgba(warmth, strength * 0.06));
    gradient.addColorStop(0.82, rgba(warmth, strength * 0.42));
    gradient.addColorStop(1, rgba(warmth, strength));
    ctx.save();
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  function drawSoftEllipse(ctx, x, y, rx, ry, color, blur) {
    ctx.save();
    ctx.filter = `blur(${blur}px)`;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(1, rx), Math.max(1, ry), 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function addFineDither(ctx, width, height, seed, alpha = 0.016) {
    const { canvas, ctx: nctx } = makeCanvas(96, 60, false);
    const image = nctx.createImageData(96, 60);
    const random = mulberry32(seed);
    for (let i = 0; i < image.data.length; i += 4) {
      const v = random() > 0.5 ? 255 : 0;
      image.data[i] = v;
      image.data[i + 1] = v;
      image.data[i + 2] = v;
      image.data[i + 3] = 255;
    }
    nctx.putImageData(image, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(canvas, 0, 0, width, height);
    ctx.restore();
  }

  function drawBokeh(ctx, x, y, radius, hex, alpha) {
    const gradient = ctx.createRadialGradient(x, y, radius * 0.02, x, y, radius);
    gradient.addColorStop(0, rgba(hex, alpha * 0.56));
    gradient.addColorStop(0.38, rgba(hex, alpha * 0.09));
    gradient.addColorStop(0.7, rgba(hex, alpha * 0.18));
    gradient.addColorStop(0.89, rgba(hex, alpha * 0.72));
    gradient.addColorStop(1, rgba(hex, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.fill();

    if (radius < 30) {
      const core = ctx.createRadialGradient(x, y, 0, x, y, radius * 0.42);
      core.addColorStop(0, rgba(hex, alpha * 0.7));
      core.addColorStop(0.6, rgba(hex, alpha * 0.2));
      core.addColorStop(1, rgba(hex, 0));
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(x, y, radius * 0.42, 0, TAU);
      ctx.fill();
    }
  }

  function drawStar(ctx, x, y, radius, hex, alpha, flare = false) {
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius * 5.5);
    glow.addColorStop(0, rgba(hex, alpha));
    glow.addColorStop(0.18, rgba(hex, alpha * 0.55));
    glow.addColorStop(0.5, rgba(hex, alpha * 0.08));
    glow.addColorStop(1, rgba(hex, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, radius * 5.5, 0, TAU);
    ctx.fill();

    ctx.fillStyle = rgba(hex, Math.min(1, alpha * 1.5));
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.fill();

    if (flare) {
      const length = radius * 7;
      const line = ctx.createLinearGradient(x - length, y, x + length, y);
      line.addColorStop(0, rgba(hex, 0));
      line.addColorStop(0.5, rgba(hex, alpha * 0.48));
      line.addColorStop(1, rgba(hex, 0));
      ctx.strokeStyle = line;
      ctx.lineWidth = Math.max(0.6, radius * 0.45);
      ctx.beginPath();
      ctx.moveTo(x - length, y);
      ctx.lineTo(x + length, y);
      ctx.stroke();

      const vertical = ctx.createLinearGradient(x, y - length, x, y + length);
      vertical.addColorStop(0, rgba(hex, 0));
      vertical.addColorStop(0.5, rgba(hex, alpha * 0.3));
      vertical.addColorStop(1, rgba(hex, 0));
      ctx.strokeStyle = vertical;
      ctx.beginPath();
      ctx.moveTo(x, y - length);
      ctx.lineTo(x, y + length);
      ctx.stroke();
    }
  }

  function renderSeaSunset() {
    const { canvas, ctx } = makeCanvas(W, H, true);
    const random = mulberry32(0x51ea5a7);
    const horizon = 612;
    const sunX = 1002;
    const sunY = horizon - 7;

    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#050A15');
    sky.addColorStop(0.2, '#081326');
    sky.addColorStop(0.44, '#101D36');
    sky.addColorStop(0.63, '#1C2742');
    sky.addColorStop(0.78, '#302F48');
    sky.addColorStop(0.9, '#483F50');
    sky.addColorStop(1, '#655254');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, horizon);

    const upperHaze = ctx.createRadialGradient(1190, 240, 0, 1190, 240, 700);
    upperHaze.addColorStop(0, 'rgba(128,110,152,0.10)');
    upperHaze.addColorStop(0.5, 'rgba(80,80,130,0.04)');
    upperHaze.addColorStop(1, 'rgba(80,80,130,0)');
    ctx.fillStyle = upperHaze;
    ctx.fillRect(0, 0, W, horizon);

    const halo = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 760);
    halo.addColorStop(0, 'rgba(255,232,186,0.34)');
    halo.addColorStop(0.12, 'rgba(244,205,145,0.20)');
    halo.addColorStop(0.34, 'rgba(222,163,107,0.10)');
    halo.addColorStop(0.68, 'rgba(172,116,96,0.035)');
    halo.addColorStop(1, 'rgba(172,116,96,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, horizon);

    const highClouds = [
      [335, 276, 360, 15, 22, 'rgba(27,39,64,0.36)', 25],
      [870, 302, 300, 10, 17, 'rgba(36,44,70,0.24)', 24],
      [1210, 391, 380, 14, 19, 'rgba(35,40,64,0.34)', 28],
      [505, 477, 430, 18, 24, 'rgba(45,44,67,0.38)', 27],
      [1120, 500, 330, 16, 21, 'rgba(56,49,69,0.30)', 25],
      [420, 561, 310, 12, 17, 'rgba(55,50,70,0.28)', 20],
      [840, 574, 470, 13, 14, 'rgba(83,65,76,0.24)', 24],
    ];
    for (const [x, y, rx, ry, puffs, color, blur] of highClouds) {
      for (let i = 0; i < puffs; i += 1) {
        const dx = (random() - 0.5) * rx * 1.25;
        const dy = (random() - 0.5) * ry * 1.7;
        drawSoftEllipse(
          ctx,
          x + dx,
          y + dy,
          rx * (0.22 + random() * 0.36),
          ry * (0.55 + random() * 0.7),
          color,
          blur,
        );
      }
    }

    // A restrained, slightly veiled sun near the horizon.
    const sunDisc = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 62);
    sunDisc.addColorStop(0, 'rgba(255,246,220,0.98)');
    sunDisc.addColorStop(0.38, 'rgba(255,227,177,0.72)');
    sunDisc.addColorStop(0.72, 'rgba(240,195,132,0.20)');
    sunDisc.addColorStop(1, 'rgba(240,195,132,0)');
    ctx.fillStyle = sunDisc;
    ctx.beginPath();
    ctx.arc(sunX, sunY, 62, 0, TAU);
    ctx.fill();

    const sunCore = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 23);
    sunCore.addColorStop(0, 'rgba(255,249,229,1)');
    sunCore.addColorStop(0.64, 'rgba(255,231,185,0.94)');
    sunCore.addColorStop(1, 'rgba(255,214,157,0.2)');
    ctx.fillStyle = sunCore;
    ctx.beginPath();
    ctx.arc(sunX, sunY, 23, 0, TAU);
    ctx.fill();

    // Thin foreground cloud streaks give the disc some atmosphere.
    const frontClouds = [
      [895, 588, 250, 5.5, 'rgba(240,212,156,0.13)', 7],
      [1060, 571, 205, 7, 'rgba(153,117,101,0.22)', 11],
      [735, 601, 260, 4, 'rgba(236,200,153,0.11)', 6],
      [1230, 553, 180, 8, 'rgba(91,80,98,0.22)', 14],
    ];
    for (const [x, y, rx, ry, color, blur] of frontClouds) {
      drawSoftEllipse(ctx, x, y, rx, ry, color, blur);
    }

    const horizonGlow = ctx.createLinearGradient(
      sunX - 700,
      horizon - 22,
      sunX + 700,
      horizon + 10,
    );
    horizonGlow.addColorStop(0, 'rgba(240,190,126,0)');
    horizonGlow.addColorStop(0.42, 'rgba(240,190,126,0.045)');
    horizonGlow.addColorStop(0.6, 'rgba(255,220,165,0.24)');
    horizonGlow.addColorStop(0.75, 'rgba(240,190,126,0.05)');
    horizonGlow.addColorStop(1, 'rgba(240,190,126,0)');
    ctx.fillStyle = horizonGlow;
    ctx.fillRect(0, horizon - 22, W, 34);

    const water = ctx.createLinearGradient(0, horizon, 0, H);
    water.addColorStop(0, '#302D41');
    water.addColorStop(0.09, '#1A253A');
    water.addColorStop(0.3, '#0F1A2D');
    water.addColorStop(0.64, '#08111E');
    water.addColorStop(1, '#030812');
    ctx.fillStyle = water;
    ctx.fillRect(0, horizon, W, H - horizon);

    const waterHorizontal = ctx.createLinearGradient(0, 0, W, 0);
    waterHorizontal.addColorStop(0, 'rgba(2,7,15,0.28)');
    waterHorizontal.addColorStop(0.36, 'rgba(2,7,15,0)');
    waterHorizontal.addColorStop(0.7, 'rgba(2,7,15,0.05)');
    waterHorizontal.addColorStop(1, 'rgba(2,7,15,0.36)');
    ctx.fillStyle = waterHorizontal;
    ctx.fillRect(0, horizon, W, H - horizon);

    // Broad warm reflection, then individual broken glints.
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.filter = 'blur(18px)';
    const reflection = ctx.createLinearGradient(0, horizon, 0, H);
    reflection.addColorStop(0, 'rgba(240,189,116,0.34)');
    reflection.addColorStop(0.17, 'rgba(220,156,95,0.16)');
    reflection.addColorStop(0.52, 'rgba(139,104,94,0.07)');
    reflection.addColorStop(1, 'rgba(139,104,94,0)');
    ctx.fillStyle = reflection;
    ctx.beginPath();
    ctx.moveTo(sunX - 72, horizon);
    ctx.lineTo(sunX + 72, horizon);
    ctx.lineTo(sunX + 390, H);
    ctx.lineTo(sunX - 390, H);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';
    for (let i = 0; i < 285; i += 1) {
      const depth = Math.pow(random(), 1.55);
      const y = horizon + 4 + depth * (H - horizon - 10);
      const spread = 40 + depth * 570;
      const x = sunX + (random() - 0.5) * spread * 1.8;
      const length = (7 + depth * 120) * (0.35 + random() * 0.95);
      const warm = random() < 0.74;
      const alpha = (0.025 + (1 - depth) * 0.13) * (0.45 + random() * 0.8);
      ctx.strokeStyle = warm
        ? `rgba(240,212,156,${alpha})`
        : `rgba(169,184,203,${alpha * 0.5})`;
      ctx.lineWidth = 0.6 + depth * 2.2;
      ctx.beginPath();
      ctx.moveTo(x - length / 2, y);
      ctx.quadraticCurveTo(x, y + (random() - 0.5) * 2.2, x + length / 2, y);
      ctx.stroke();
    }

    // A few cooler glints elsewhere keep the water from reading as one glow.
    for (let i = 0; i < 58; i += 1) {
      const y = horizon + 18 + Math.pow(random(), 1.3) * (H - horizon - 35);
      const x = random() * W;
      const length = 8 + random() * 70;
      const alpha = 0.015 + random() * 0.055;
      ctx.strokeStyle = `rgba(185,161,232,${alpha})`;
      ctx.lineWidth = 0.6 + random() * 1.6;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + length, y + (random() - 0.5) * 1.5);
      ctx.stroke();
    }
    ctx.restore();

    // Quiet dark troughs add photographic surface texture.
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    for (let i = 0; i < 70; i += 1) {
      const depth = Math.pow(random(), 0.8);
      const y = horizon + 22 + depth * (H - horizon - 40);
      const length = 50 + random() * 420;
      const x = random() * W;
      ctx.strokeStyle = `rgba(3,8,16,${0.06 + random() * 0.20})`;
      ctx.lineWidth = 1 + depth * 5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + length * 0.5, y + (random() - 0.5) * 5, x + length, y);
      ctx.stroke();
    }
    ctx.restore();

    addFineDither(ctx, W, H, 0x51ea5a8, 0.022);
    addVignette(ctx, W, H, 0.5, '#02060D');
    addGrain(ctx, W, H, 0x51ea5a9, { alpha: 0.034, scale: 1 });

    return canvas.toDataURL('image/jpeg', 0.82);
  }

  function renderRainStreet() {
    const { canvas, ctx } = makeCanvas(W, H, true);
    const random = mulberry32(0x5a17b0);
    const horizon = 615;

    const base = ctx.createLinearGradient(0, 0, 0, H);
    base.addColorStop(0, '#060E1B');
    base.addColorStop(0.34, '#0B182A');
    base.addColorStop(0.61, '#0A1726');
    base.addColorStop(0.76, '#06101C');
    base.addColorStop(1, '#02060C');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, W, H);

    const coolHaze = ctx.createRadialGradient(870, 280, 0, 870, 280, 760);
    coolHaze.addColorStop(0, 'rgba(130,197,207,0.11)');
    coolHaze.addColorStop(0.42, 'rgba(73,110,145,0.05)');
    coolHaze.addColorStop(1, 'rgba(73,110,145,0)');
    ctx.fillStyle = coolHaze;
    ctx.fillRect(0, 0, W, H);

    const warmHaze = ctx.createRadialGradient(250, 460, 0, 250, 460, 560);
    warmHaze.addColorStop(0, 'rgba(240,190,111,0.12)');
    warmHaze.addColorStop(0.5, 'rgba(197,130,75,0.045)');
    warmHaze.addColorStop(1, 'rgba(197,130,75,0)');
    ctx.fillStyle = warmHaze;
    ctx.fillRect(0, 0, W, H);

    // Blurred lamps: clusters are deliberately uneven rather than evenly spaced.
    const clusters = [
      { x: 277, y: 342, sx: 178, sy: 160, count: 11, rMin: 13, rMax: 84, warm: 0.88 },
      { x: 1138, y: 313, sx: 210, sy: 150, count: 12, rMin: 10, rMax: 71, warm: 0.82 },
      { x: 754, y: 456, sx: 255, sy: 155, count: 15, rMin: 7, rMax: 50, warm: 0.94 },
      { x: 1386, y: 546, sx: 125, sy: 100, count: 6, rMin: 9, rMax: 42, warm: 0.7 },
    ];

    const lights = [];
    for (const cluster of clusters) {
      for (let i = 0; i < cluster.count; i += 1) {
        const x = clamp(cluster.x + (random() - 0.5) * cluster.sx * 2, 18, W - 18);
        const y = clamp(cluster.y + (random() - 0.5) * cluster.sy * 2, 90, 615);
        const radius = cluster.rMin + Math.pow(random(), 1.5) * (cluster.rMax - cluster.rMin);
        const isWarm = random() < cluster.warm;
        const hex = isWarm
          ? ['#F0D49C', '#E8B56F', '#D59A5A'][Math.floor(random() * 3)]
          : ['#82C5CF', '#B9A1E8', '#A9B8CB'][Math.floor(random() * 3)];
        const alpha = 0.17 + random() * (radius > 55 ? 0.26 : 0.4);
        lights.push({ x, y, radius, hex, alpha, isWarm });
      }
    }

    lights.push(
      { x: 165, y: 208, radius: 126, hex: '#82C5CF', alpha: 0.10, isWarm: false },
      { x: 1450, y: 250, radius: 98, hex: '#F0D49C', alpha: 0.09, isWarm: true },
      { x: 596, y: 625, radius: 36, hex: '#F0D49C', alpha: 0.14, isWarm: true },
    );

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (const light of lights) {
      drawBokeh(ctx, light.x, light.y, light.radius, light.hex, light.alpha);
    }
    ctx.restore();

    // Wet asphalt plane. It starts softly so the image stays atmospheric.
    const asphalt = ctx.createLinearGradient(0, 560, 0, H);
    asphalt.addColorStop(0, 'rgba(3,10,18,0)');
    asphalt.addColorStop(0.2, 'rgba(4,11,20,0.55)');
    asphalt.addColorStop(0.58, 'rgba(3,8,15,0.92)');
    asphalt.addColorStop(1, 'rgba(1,4,9,1)');
    ctx.fillStyle = asphalt;
    ctx.fillRect(0, 560, W, H - 560);

    const asphaltSheen = ctx.createLinearGradient(0, 615, 0, 900);
    asphaltSheen.addColorStop(0, 'rgba(76,104,132,0.055)');
    asphaltSheen.addColorStop(0.28, 'rgba(123,151,177,0.025)');
    asphaltSheen.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = asphaltSheen;
    ctx.fillRect(0, 600, W, 360);

    // Vertical, uneven reflection columns from the brightest bokeh.
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const reflected = lights
      .filter((light) => light.y > 240 && light.radius > 18)
      .slice(0, 26);
    for (const light of reflected) {
      const width = light.radius * (0.5 + random() * 0.5);
      const length = 50 + random() * 270 + light.radius;
      const x = light.x + (random() - 0.5) * 22;
      const top = 610 + random() * 70;
      const gradient = ctx.createLinearGradient(0, top, 0, top + length);
      gradient.addColorStop(0, rgba(light.hex, 0));
      gradient.addColorStop(0.1, rgba(light.hex, light.alpha * 0.82));
      gradient.addColorStop(0.46, rgba(light.hex, light.alpha * 0.32));
      gradient.addColorStop(1, rgba(light.hex, 0));
      ctx.save();
      ctx.filter = 'blur(9px)';
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.ellipse(x, top + length / 2, width, length / 2, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    // Fine low horizontal ripples on the road.
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 95; i += 1) {
      const y = horizon + 12 + Math.pow(random(), 1.25) * 360;
      const x = random() * W;
      const length = 30 + random() * 280;
      const alpha = 0.012 + random() * 0.04;
      ctx.strokeStyle = `rgba(154,188,209,${alpha})`;
      ctx.lineWidth = 0.5 + random() * 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + length, y + (random() - 0.5) * 2);
      ctx.stroke();
    }
    ctx.restore();

    // Diagonal rain, thin enough to read as glass rather than scratch lines.
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 260; i += 1) {
      const x = random() * W + 40;
      const y = random() * H - 100;
      const length = 34 + random() * 210;
      const slip = length * 0.17;
      const alpha = 0.014 + random() * 0.068;
      ctx.strokeStyle = `rgba(194,218,235,${alpha})`;
      ctx.lineWidth = 0.45 + random() * 1.35;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + slip, y + length);
      ctx.stroke();
    }
    ctx.restore();

    const mist = ctx.createLinearGradient(0, H - 260, 0, H);
    mist.addColorStop(0, 'rgba(169,184,203,0)');
    mist.addColorStop(0.7, 'rgba(169,184,203,0.025)');
    mist.addColorStop(1, 'rgba(8,17,31,0.22)');
    ctx.fillStyle = mist;
    ctx.fillRect(0, H - 260, W, 260);

    addFineDither(ctx, W, H, 0x5a17b1, 0.02);
    addVignette(ctx, W, H, 0.56, '#02060C');
    addGrain(ctx, W, H, 0x5a17b2, { alpha: 0.035, scale: 1 });

    return canvas.toDataURL('image/webp', 0.85);
  }

  function buildRidge(seed, baseY, peaks, detail) {
    const random = mulberry32(seed);
    const points = [];
    for (let x = 0; x <= W; x += 4) {
      let elevation = 0;
      for (const peak of peaks) {
        const dx = Math.abs((x - peak.x) / peak.spread);
        elevation = Math.max(
          elevation,
          peak.height * Math.exp(-Math.pow(dx, 1.65)),
        );
      }
      elevation += Math.sin(x * 0.0042 + seed * 0.01) * 3;
      elevation += (random() - 0.5) * detail;
      points.push([x, baseY - elevation]);
    }
    return points;
  }

  function drawRidge(ctx, points, color, rimColor, rimAlpha) {
    ctx.beginPath();
    ctx.moveTo(0, H + 8);
    for (const [x, y] of points) ctx.lineTo(x, y);
    ctx.lineTo(W, H + 8);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();

    if (rimAlpha > 0) {
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i += 1) {
        ctx.lineTo(points[i][0], points[i][1]);
      }
      ctx.strokeStyle = rgba(rimColor, rimAlpha);
      ctx.lineWidth = 1.1;
      ctx.stroke();
    }
  }

  function renderMountainStars() {
    const { canvas, ctx } = makeCanvas(W, H, true);
    const random = mulberry32(0x57a25);

    const sky = ctx.createLinearGradient(0, 0, 0, 790);
    sky.addColorStop(0, '#040914');
    sky.addColorStop(0.24, '#071124');
    sky.addColorStop(0.48, '#0A1730');
    sky.addColorStop(0.68, '#111F3B');
    sky.addColorStop(0.84, '#1A2947');
    sky.addColorStop(1, '#293A58');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, 790);

    const violetHaze = ctx.createRadialGradient(1120, 440, 0, 1120, 440, 710);
    violetHaze.addColorStop(0, 'rgba(185,161,232,0.085)');
    violetHaze.addColorStop(0.44, 'rgba(141,125,183,0.035)');
    violetHaze.addColorStop(1, 'rgba(141,125,183,0)');
    ctx.fillStyle = violetHaze;
    ctx.fillRect(0, 0, W, H);

    const cyanHaze = ctx.createRadialGradient(400, 690, 0, 400, 690, 700);
    cyanHaze.addColorStop(0, 'rgba(130,197,207,0.105)');
    cyanHaze.addColorStop(0.5, 'rgba(75,128,153,0.035)');
    cyanHaze.addColorStop(1, 'rgba(75,128,153,0)');
    ctx.fillStyle = cyanHaze;
    ctx.fillRect(0, 0, W, H);

    // Diagonal Milky Way band. Soft nebular light plus dark dust lanes.
    const bandX = 800;
    const bandY = 407;
    const bandAngle = -0.545;
    ctx.save();
    ctx.translate(bandX, bandY);
    ctx.rotate(bandAngle);
    const band = ctx.createLinearGradient(0, -290, 0, 290);
    band.addColorStop(0, 'rgba(185,161,232,0)');
    band.addColorStop(0.3, 'rgba(185,161,232,0.024)');
    band.addColorStop(0.46, 'rgba(213,197,238,0.066)');
    band.addColorStop(0.52, 'rgba(238,222,213,0.045)');
    band.addColorStop(0.64, 'rgba(130,197,207,0.034)');
    band.addColorStop(0.8, 'rgba(130,197,207,0.012)');
    band.addColorStop(1, 'rgba(130,197,207,0)');
    ctx.fillStyle = band;
    ctx.fillRect(-1050, -300, 2100, 600);

    ctx.filter = 'blur(38px)';
    for (let i = 0; i < 11; i += 1) {
      const x = -820 + random() * 1640;
      const y = (random() - 0.5) * 210;
      ctx.fillStyle = `rgba(3,8,18,${0.10 + random() * 0.1})`;
      ctx.beginPath();
      ctx.ellipse(x, y, 80 + random() * 230, 12 + random() * 35, 0, 0, TAU);
      ctx.fill();
    }
    ctx.filter = 'none';
    ctx.restore();

    const starColors = ['#F5F7FA', '#F0D49C', '#A9B8CB', '#B9A1E8', '#82C5CF'];
    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    const starCount = 1180;
    for (let i = 0; i < starCount; i += 1) {
      const x = random() * W;
      const y = Math.pow(random(), 1.08) * 770;
      const bright = random() < 0.035;
      const radius = bright ? 1.1 + random() * 1.4 : 0.34 + Math.pow(random(), 2.1) * 0.95;
      const hex = starColors[Math.floor(random() * starColors.length)];
      const alpha = bright ? 0.56 + random() * 0.4 : 0.14 + random() * 0.54;
      drawStar(ctx, x, y, radius, hex, alpha, bright);
    }

    // Dense, small stars concentrated along the diagonal band.
    for (let i = 0; i < 760; i += 1) {
      const along = (random() - 0.5) * 1650;
      const offset =
        ((random() + random() + random() + random() - 2) / 2) * 128;
      const localX = along;
      const localY = offset;
      const x = bandX + Math.cos(bandAngle) * localX - Math.sin(bandAngle) * localY;
      const y = bandY + Math.sin(bandAngle) * localX + Math.cos(bandAngle) * localY;
      if (y < 0 || y > 760 || x < -20 || x > W + 20) continue;
      const bright = random() < 0.018;
      const radius = bright ? 0.9 + random() * 1.1 : 0.28 + Math.pow(random(), 2.4) * 0.7;
      const hex = starColors[Math.floor(random() * starColors.length)];
      const alpha = bright ? 0.38 + random() * 0.4 : 0.09 + random() * 0.42;
      drawStar(ctx, x, y, radius, hex, alpha, bright);
    }

    // A dozen brighter anchors.
    for (let i = 0; i < 12; i += 1) {
      const x = 80 + random() * (W - 160);
      const y = 65 + random() * 570;
      const hex = i % 4 === 0 ? '#F0D49C' : i % 3 === 0 ? '#82C5CF' : '#F5F7FA';
      drawStar(ctx, x, y, 1.4 + random() * 1.6, hex, 0.72 + random() * 0.24, true);
    }
    ctx.restore();

    const horizonHaze = ctx.createLinearGradient(0, 580, 0, 790);
    horizonHaze.addColorStop(0, 'rgba(130,197,207,0)');
    horizonHaze.addColorStop(0.58, 'rgba(130,197,207,0.055)');
    horizonHaze.addColorStop(1, 'rgba(185,161,232,0.075)');
    ctx.fillStyle = horizonHaze;
    ctx.fillRect(0, 580, W, 210);

    const farRidge = buildRidge(
      0x1001,
      760,
      [
        { x: 112, height: 92, spread: 125 },
        { x: 398, height: 172, spread: 92 },
        { x: 703, height: 128, spread: 158 },
        { x: 1002, height: 208, spread: 102 },
        { x: 1288, height: 146, spread: 154 },
        { x: 1535, height: 106, spread: 118 },
      ],
      3.4,
    );
    drawRidge(ctx, farRidge, '#192943', '#82C5CF', 0.1);

    let fog = ctx.createLinearGradient(0, 600, 0, 830);
    fog.addColorStop(0, 'rgba(130,197,207,0)');
    fog.addColorStop(0.55, 'rgba(130,197,207,0.055)');
    fog.addColorStop(1, 'rgba(185,161,232,0)');
    ctx.fillStyle = fog;
    ctx.fillRect(0, 600, W, 230);

    const midRidge = buildRidge(
      0x2002,
      818,
      [
        { x: 48, height: 146, spread: 165 },
        { x: 355, height: 238, spread: 118 },
        { x: 650, height: 184, spread: 174 },
        { x: 955, height: 293, spread: 138 },
        { x: 1298, height: 222, spread: 184 },
        { x: 1540, height: 158, spread: 132 },
      ],
      5,
    );
    drawRidge(ctx, midRidge, '#101E35', '#B9A1E8', 0.08);

    fog = ctx.createLinearGradient(0, 690, 0, 900);
    fog.addColorStop(0, 'rgba(185,161,232,0)');
    fog.addColorStop(0.54, 'rgba(185,161,232,0.038)');
    fog.addColorStop(1, 'rgba(130,197,207,0)');
    ctx.fillStyle = fog;
    ctx.fillRect(0, 690, W, 210);

    const nearRidge = buildRidge(
      0x3003,
      888,
      [
        { x: -45, height: 170, spread: 205 },
        { x: 298, height: 136, spread: 218 },
        { x: 604, height: 232, spread: 168 },
        { x: 1005, height: 170, spread: 225 },
        { x: 1440, height: 250, spread: 165 },
      ],
      7,
    );
    drawRidge(ctx, nearRidge, '#091325', '#A9B8CB', 0.055);

    const foregroundRidge = buildRidge(
      0x4004,
      1045,
      [
        { x: 145, height: 88, spread: 180 },
        { x: 590, height: 142, spread: 204 },
        { x: 1145, height: 122, spread: 224 },
        { x: 1555, height: 212, spread: 140 },
      ],
      9,
    );
    drawRidge(ctx, foregroundRidge, '#03070E', '#82C5CF', 0.045);

    addVignette(ctx, W, H, 0.38, '#02060C');
    addGrain(ctx, W, H, 0x4005, { alpha: 0.025, scale: 3 });
    addFineDither(ctx, W, H, 0x4006, 0.009);

    return canvas.toDataURL('image/png');
  }

  function renderNightTrain() {
    const { canvas, ctx } = makeCanvas(W, H, true);
    const random = mulberry32(0x7ea1b);
    const insetX = 54;
    const insetY = 52;
    const viewW = W - insetX * 2;
    const viewH = H - insetY * 2;
    const radius = 22;

    ctx.fillStyle = '#04080F';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    roundRectPath(ctx, insetX, insetY, viewW, viewH, radius);
    ctx.clip();

    const outside = ctx.createLinearGradient(0, insetY, 0, H - insetY);
    outside.addColorStop(0, '#071120');
    outside.addColorStop(0.38, '#0C1A2B');
    outside.addColorStop(0.62, '#101F32');
    outside.addColorStop(0.78, '#081421');
    outside.addColorStop(1, '#02060C');
    ctx.fillStyle = outside;
    ctx.fillRect(insetX, insetY, viewW, viewH);

    const cityGlow = ctx.createRadialGradient(760, 570, 0, 760, 570, 670);
    cityGlow.addColorStop(0, 'rgba(224,171,104,0.13)');
    cityGlow.addColorStop(0.42, 'rgba(129,121,133,0.055)');
    cityGlow.addColorStop(1, 'rgba(57,76,105,0)');
    ctx.fillStyle = cityGlow;
    ctx.fillRect(insetX, insetY, viewW, viewH);

    const coolGlow = ctx.createRadialGradient(290, 350, 0, 290, 350, 500);
    coolGlow.addColorStop(0, 'rgba(130,197,207,0.075)');
    coolGlow.addColorStop(0.54, 'rgba(70,117,149,0.025)');
    coolGlow.addColorStop(1, 'rgba(70,117,149,0)');
    ctx.fillStyle = coolGlow;
    ctx.fillRect(insetX, insetY, viewW, viewH);

    // Motion-blurred skyline suggestions, kept vague enough to read as speed.
    ctx.save();
    ctx.filter = 'blur(5px)';
    for (let layer = 0; layer < 3; layer += 1) {
      const baseY = 660 + layer * 45;
      const alpha = 0.22 + layer * 0.12;
      ctx.fillStyle = `rgba(7,15,27,${alpha})`;
      ctx.beginPath();
      ctx.moveTo(insetX, baseY);
      let x = insetX;
      while (x < W - insetX) {
        const width = 25 + random() * 100;
        const height = 20 + random() * (65 + layer * 36);
        ctx.lineTo(x, baseY - height);
        ctx.lineTo(x + width, baseY - height);
        ctx.lineTo(x + width, baseY);
        x += width + 4 + random() * 14;
      }
      ctx.lineTo(W - insetX, H);
      ctx.lineTo(insetX, H);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // Horizontal light trails from the moving train.
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const trailColors = ['#F0D49C', '#E6AF67', '#82C5CF', '#B9A1E8', '#A9B8CB'];
    const trailCount = 88;
    for (let i = 0; i < trailCount; i += 1) {
      const y = 280 + Math.pow(random(), 0.9) * 430;
      const length = 70 + random() * 460;
      const thickness = 0.8 + random() * 4.8;
      const x = random() * W;
      const color = trailColors[Math.floor(random() * trailColors.length)];
      const alpha = 0.055 + random() * 0.31;
      const blur = 0.7 + random() * 9;
      const gradient = ctx.createLinearGradient(x - length / 2, 0, x + length / 2, 0);
      gradient.addColorStop(0, rgba(color, 0));
      gradient.addColorStop(0.16, rgba(color, alpha));
      gradient.addColorStop(0.52, rgba(color, alpha * 0.9));
      gradient.addColorStop(0.84, rgba(color, alpha * 0.28));
      gradient.addColorStop(1, rgba(color, 0));
      ctx.save();
      ctx.filter = `blur(${blur}px)`;
      ctx.fillStyle = gradient;
      roundRectPath(ctx, x - length / 2, y - thickness / 2, length, thickness, thickness / 2);
      ctx.fill();
      ctx.restore();
    }

    // Two larger, softer trails anchor the composition.
    for (const trail of [
      { x: 920, y: 484, len: 720, thick: 9, color: '#F0D49C', alpha: 0.19 },
      { x: 510, y: 586, len: 410, thick: 5, color: '#82C5CF', alpha: 0.14 },
      { x: 1130, y: 644, len: 520, thick: 7, color: '#E6AF67', alpha: 0.13 },
    ]) {
      const gradient = ctx.createLinearGradient(
        trail.x - trail.len / 2,
        0,
        trail.x + trail.len / 2,
        0,
      );
      gradient.addColorStop(0, rgba(trail.color, 0));
      gradient.addColorStop(0.22, rgba(trail.color, trail.alpha));
      gradient.addColorStop(0.68, rgba(trail.color, trail.alpha * 0.2));
      gradient.addColorStop(1, rgba(trail.color, 0));
      ctx.save();
      ctx.filter = 'blur(11px)';
      ctx.fillStyle = gradient;
      roundRectPath(
        ctx,
        trail.x - trail.len / 2,
        trail.y - trail.thick / 2,
        trail.len,
        trail.thick,
        trail.thick / 2,
      );
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    // Rain and condensation on the glass.
    for (let i = 0; i < 115; i += 1) {
      const edgeBias = random() < 0.46;
      const x = edgeBias
        ? random() < 0.5
          ? insetX + 18 + random() * 250
          : W - insetX - 18 - random() * 250
        : insetX + 30 + random() * (viewW - 60);
      const y = insetY + 35 + random() * (viewH - 70);
      const radius = 1.1 + Math.pow(random(), 2.2) * 6.8;
      const gradient = ctx.createRadialGradient(
        x - radius * 0.2,
        y - radius * 0.28,
        radius * 0.06,
        x,
        y,
        radius,
      );
      gradient.addColorStop(0, 'rgba(236,244,250,0.30)');
      gradient.addColorStop(0.18, 'rgba(169,184,203,0.10)');
      gradient.addColorStop(0.62, 'rgba(18,31,46,0.14)');
      gradient.addColorStop(0.91, 'rgba(181,209,227,0.22)');
      gradient.addColorStop(1, 'rgba(181,209,227,0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.ellipse(
        x,
        y,
        radius * (0.74 + random() * 0.36),
        radius,
        0,
        0,
        TAU,
      );
      ctx.fill();
      if (radius > 3.4) {
        ctx.strokeStyle = 'rgba(241,247,252,0.38)';
        ctx.lineWidth = Math.max(0.5, radius * 0.11);
        ctx.beginPath();
        ctx.arc(x, y, radius * 0.67, Math.PI * 1.05, Math.PI * 1.68);
        ctx.stroke();
      }
    }

    // A handful of thin runnels, mostly near the frame where they feel close.
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 18; i += 1) {
      const x = insetX + 25 + random() * (viewW - 50);
      const y = insetY + 80 + random() * (viewH - 220);
      const length = 36 + random() * 150;
      const bend = (random() - 0.5) * 30;
      const gradient = ctx.createLinearGradient(x, y, x + bend, y + length);
      gradient.addColorStop(0, 'rgba(196,221,235,0)');
      gradient.addColorStop(0.25, `rgba(196,221,235,${0.08 + random() * 0.12})`);
      gradient.addColorStop(1, 'rgba(196,221,235,0)');
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 0.7 + random() * 1.2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + bend * 0.4, y + length * 0.55, x + bend, y + length);
      ctx.stroke();
    }
    ctx.restore();

    // Broad, very soft interior reflection at the right edge.
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const cabinWarm = ctx.createLinearGradient(W - insetX - 360, 0, W - insetX, 0);
    cabinWarm.addColorStop(0, 'rgba(240,212,156,0)');
    cabinWarm.addColorStop(0.46, 'rgba(240,196,125,0.08)');
    cabinWarm.addColorStop(0.82, 'rgba(240,196,125,0.20)');
    cabinWarm.addColorStop(1, 'rgba(255,208,135,0.34)');
    ctx.fillStyle = cabinWarm;
    ctx.fillRect(W - insetX - 360, insetY, 360, viewH);

    const cabinGlow = ctx.createRadialGradient(
      W - insetX - 110,
      610,
      0,
      W - insetX - 110,
      610,
      470,
    );
    cabinGlow.addColorStop(0, 'rgba(240,205,140,0.27)');
    cabinGlow.addColorStop(0.32, 'rgba(223,163,101,0.105)');
    cabinGlow.addColorStop(1, 'rgba(223,163,101,0)');
    ctx.fillStyle = cabinGlow;
    ctx.fillRect(insetX, insetY, viewW, viewH);

    // A blurred reflection line suggests a window/cabin edge.
    ctx.save();
    ctx.filter = 'blur(22px)';
    ctx.strokeStyle = 'rgba(240,212,156,0.18)';
    ctx.lineWidth = 28;
    ctx.beginPath();
    ctx.moveTo(W - insetX - 40, H - 210);
    ctx.quadraticCurveTo(W - insetX - 220, H - 400, W - insetX - 430, H - 330);
    ctx.stroke();
    ctx.restore();

    // A softer warm reflected patch at the right edge, like cabin light on glass.
    ctx.save();
    ctx.filter = 'blur(34px)';
    ctx.fillStyle = 'rgba(240,188,112,0.16)';
    ctx.beginPath();
    ctx.ellipse(W - insetX - 105, 718, 58, 250, -0.08, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.restore();

    // Faint glass smudges and nose shadow keep the pane physically present.
    drawSoftEllipse(ctx, 250, 270, 230, 120, 'rgba(169,184,203,0.018)', 55);
    drawSoftEllipse(ctx, 1320, 760, 340, 180, 'rgba(240,212,156,0.018)', 70);

    ctx.restore();

    // Window frame: build it as a single even-odd shape so the rounded opening stays clean.
    ctx.save();
    roundRectPath(ctx, insetX, insetY, viewW, viewH, radius);
    ctx.rect(0, 0, W, H);
    const frame = ctx.createLinearGradient(0, 0, 0, H);
    frame.addColorStop(0, '#0E1725');
    frame.addColorStop(0.18, '#090F1A');
    frame.addColorStop(0.62, '#050A12');
    frame.addColorStop(1, '#02050A');
    ctx.fillStyle = frame;
    ctx.fill('evenodd');
    ctx.restore();

    const edgeLight = ctx.createLinearGradient(0, 0, W, 0);
    edgeLight.addColorStop(0, 'rgba(169,184,203,0.07)');
    edgeLight.addColorStop(0.3, 'rgba(169,184,203,0.01)');
    edgeLight.addColorStop(0.7, 'rgba(240,212,156,0.018)');
    edgeLight.addColorStop(1, 'rgba(240,212,156,0.065)');
    ctx.strokeStyle = edgeLight;
    ctx.lineWidth = 1.4;
    roundRectPath(ctx, insetX + 0.8, insetY + 0.8, viewW - 1.6, viewH - 1.6, radius);
    ctx.stroke();

    // Inner shadow around the opening.
    ctx.save();
    roundRectPath(ctx, insetX, insetY, viewW, viewH, radius);
    ctx.clip();
    const topShadow = ctx.createLinearGradient(0, insetY, 0, insetY + 46);
    topShadow.addColorStop(0, 'rgba(1,4,9,0.56)');
    topShadow.addColorStop(1, 'rgba(1,4,9,0)');
    ctx.fillStyle = topShadow;
    ctx.fillRect(insetX, insetY, viewW, 46);
    const bottomShadow = ctx.createLinearGradient(0, H - insetY - 34, 0, H - insetY);
    bottomShadow.addColorStop(0, 'rgba(1,4,9,0)');
    bottomShadow.addColorStop(1, 'rgba(1,4,9,0.46)');
    ctx.fillStyle = bottomShadow;
    ctx.fillRect(insetX, H - insetY - 34, viewW, 34);
    ctx.restore();

    // Frame grain and vignette.
    addVignette(ctx, W, H, 0.34, '#010409');
    addGrain(ctx, W, H, 0x7ea1c, { alpha: 0.032, scale: 1 });

    return canvas.toDataURL('image/jpeg', 0.83);
  }

  function makeCloudSprite(seed, width, height, hex, opacity) {
    const { canvas, ctx } = makeCanvas(width, height, false);
    const random = mulberry32(seed);
    ctx.save();
    ctx.filter = 'blur(15px)';
    for (let i = 0; i < 26; i += 1) {
      const x = width * (0.12 + random() * 0.76);
      const y = height * (0.34 + random() * 0.34);
      const rx = width * (0.08 + random() * 0.18);
      const ry = height * (0.06 + random() * 0.12);
      const a = opacity * (0.25 + random() * 0.75);
      ctx.fillStyle = rgba(hex, a);
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, (random() - 0.5) * 0.06, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    return canvas;
  }

  function makeMoonSprite(radius) {
    const size = radius * 8;
    const { canvas, ctx } = makeCanvas(size, size, false);
    const cx = size / 2;
    const cy = size / 2;
    const random = mulberry32(0xc10d);

    const halo = ctx.createRadialGradient(cx, cy, radius * 0.6, cx, cy, size / 2);
    halo.addColorStop(0, 'rgba(240,229,202,0.18)');
    halo.addColorStop(0.2, 'rgba(231,213,176,0.10)');
    halo.addColorStop(0.44, 'rgba(185,161,232,0.043)');
    halo.addColorStop(0.7, 'rgba(130,197,207,0.018)');
    halo.addColorStop(1, 'rgba(130,197,207,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, size, size);

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TAU);
    ctx.clip();
    const disc = ctx.createRadialGradient(
      cx - radius * 0.25,
      cy - radius * 0.25,
      radius * 0.08,
      cx,
      cy,
      radius,
    );
    disc.addColorStop(0, '#FFF9E9');
    disc.addColorStop(0.56, '#EFE4CC');
    disc.addColorStop(0.9, '#C7BDA9');
    disc.addColorStop(1, '#9B9C9E');
    ctx.fillStyle = disc;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

    ctx.filter = 'blur(1.2px)';
    for (let i = 0; i < 30; i += 1) {
      const angle = random() * TAU;
      const dist = Math.sqrt(random()) * radius * 0.82;
      const x = cx + Math.cos(angle) * dist;
      const y = cy + Math.sin(angle) * dist;
      const r = radius * (0.025 + random() * 0.12);
      ctx.fillStyle = `rgba(84,93,100,${0.035 + random() * 0.11})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }
    ctx.filter = 'none';

    const limb = ctx.createRadialGradient(cx, cy, radius * 0.58, cx, cy, radius);
    limb.addColorStop(0, 'rgba(50,60,72,0)');
    limb.addColorStop(0.82, 'rgba(44,54,68,0.11)');
    limb.addColorStop(1, 'rgba(31,41,56,0.32)');
    ctx.fillStyle = limb;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    ctx.restore();

    return canvas;
  }

  function recordBalconyMoon() {
    return new Promise((resolvePromise, rejectPromise) => {
      const width = 1280;
      const height = 720;
      const durationMs = 8000;
      const { canvas, ctx } = makeCanvas(width, height, true);
      const random = mulberry32(0xbac0a);

      // Static sky backdrop: gradient, faint diagonal nebular wash, airglow.
      const { canvas: skyCanvas, ctx: skyCtx } = makeCanvas(width, height, true);
      const sky = skyCtx.createLinearGradient(0, 0, 0, height);
      sky.addColorStop(0, '#040A16');
      sky.addColorStop(0.34, '#081427');
      sky.addColorStop(0.6, '#10203A');
      sky.addColorStop(0.8, '#1B2C48');
      sky.addColorStop(1, '#263955');
      skyCtx.fillStyle = sky;
      skyCtx.fillRect(0, 0, width, height);

      skyCtx.save();
      skyCtx.translate(width * 0.56, height * 0.42);
      skyCtx.rotate(-0.54);
      const milky = skyCtx.createLinearGradient(0, -170, 0, 170);
      milky.addColorStop(0, 'rgba(185,161,232,0)');
      milky.addColorStop(0.43, 'rgba(185,161,232,0.035)');
      milky.addColorStop(0.52, 'rgba(215,201,237,0.068)');
      milky.addColorStop(0.63, 'rgba(130,197,207,0.028)');
      milky.addColorStop(1, 'rgba(130,197,207,0)');
      skyCtx.fillStyle = milky;
      skyCtx.fillRect(-900, -180, 1800, 360);
      skyCtx.restore();

      const airglow = skyCtx.createLinearGradient(0, height * 0.52, 0, height);
      airglow.addColorStop(0, 'rgba(130,197,207,0)');
      airglow.addColorStop(0.72, 'rgba(130,197,207,0.055)');
      airglow.addColorStop(1, 'rgba(185,161,232,0.10)');
      skyCtx.fillStyle = airglow;
      skyCtx.fillRect(0, height * 0.52, width, height * 0.48);

      // Star field.
      const stars = [];
      const starColors = ['#F5F7FA', '#F0D49C', '#A9B8CB', '#B9A1E8', '#82C5CF'];
      for (let i = 0; i < 255; i += 1) {
        const bandStar = random() < 0.42;
        let x;
        let y;
        if (bandStar) {
          const along = (random() - 0.5) * 1500;
          const offset = ((random() + random() + random() - 1.5) / 1.5) * 92;
          const angle = -0.54;
          x = width * 0.56 + Math.cos(angle) * along - Math.sin(angle) * offset;
          y = height * 0.42 + Math.sin(angle) * along + Math.cos(angle) * offset;
          if (x < 0) x += width;
          if (x > width) x -= width;
          if (y < 40 || y > height * 0.7) {
            x = random() * width;
            y = 35 + random() * height * 0.56;
          }
        } else {
          x = random() * width;
          y = 25 + Math.pow(random(), 1.1) * height * 0.66;
        }
        stars.push({
          x,
          y,
          r: 0.38 + Math.pow(random(), 2) * 1.2,
          color: starColors[Math.floor(random() * starColors.length)],
          opacity: 0.18 + random() * 0.56,
          phase: random() * TAU,
          speed: 0.45 + random() * 0.9,
          drift: 0.55 + random() * 1.8,
        });
      }
      const anchorStars = [
        [180, 125, 1.5, '#F5F7FA'],
        [432, 71, 1.2, '#82C5CF'],
        [1038, 112, 2.1, '#F0D49C'],
        [1192, 188, 1.3, '#F5F7FA'],
        [686, 213, 1.0, '#B9A1E8'],
        [300, 320, 1.1, '#F0D49C'],
      ];

      // Cloud sprites are pre-blurred, then drift across the sky.
      const cloudSprites = [
        makeCloudSprite(0xc1001, 640, 154, '#A9B8CB', 0.30),
        makeCloudSprite(0xc1002, 760, 188, '#8B94B0', 0.25),
        makeCloudSprite(0xc1003, 540, 130, '#B9A1E8', 0.22),
        makeCloudSprite(0xc1004, 860, 210, '#7E8DA9', 0.20),
        makeCloudSprite(0xc1005, 580, 150, '#F0D49C', 0.12),
      ];
      const clouds = [
        { sprite: 0, x: -100, y: 130, speed: 5.2, alpha: 0.5, scale: 1.05 },
        { sprite: 1, x: 610, y: 260, speed: 7.5, alpha: 0.46, scale: 1.08 },
        { sprite: 2, x: 300, y: 398, speed: 4.1, alpha: 0.38, scale: 0.92 },
        { sprite: 3, x: 760, y: 470, speed: 6.2, alpha: 0.34, scale: 1.0 },
        { sprite: 4, x: 980, y: 326, speed: 3.3, alpha: 0.28, scale: 0.82 },
      ];

      // Skyline layers.
      const { canvas: skylineCanvas, ctx: skylineCtx } = makeCanvas(width, height, false);
      const skylineRandom = mulberry32(0xbac0b);
      const layers = [
        { baseY: 606, color: '#0D1A2F', minH: 28, maxH: 92, windowAlpha: 0.28, count: 72 },
        { baseY: 654, color: '#071324', minH: 38, maxH: 122, windowAlpha: 0.34, count: 58 },
        { baseY: 712, color: '#030A13', minH: 48, maxH: 146, windowAlpha: 0.2, count: 38 },
      ];
      for (const layer of layers) {
        let x = -20;
        while (x < width + 20) {
          const w = 22 + skylineRandom() * 84;
          const h = layer.minH + skylineRandom() * (layer.maxH - layer.minH);
          skylineCtx.fillStyle = layer.color;
          skylineCtx.fillRect(x, layer.baseY - h, w, height - (layer.baseY - h));
          if (skylineRandom() < 0.7) {
            const roof = skylineRandom() < 0.5;
            if (roof) {
              skylineCtx.fillRect(x + w * 0.4, layer.baseY - h - 8, w * 0.16, 8);
            }
          }
          const windowRows = Math.floor(h / 20);
          const windowCols = Math.max(1, Math.floor(w / 17));
          for (let ry = 0; ry < windowRows; ry += 1) {
            for (let cx = 0; cx < windowCols; cx += 1) {
              if (skylineRandom() > 0.12) continue;
              const wx = x + 7 + cx * 17;
              const wy = layer.baseY - h + 12 + ry * 20;
              const warm = skylineRandom() < 0.70;
              skylineCtx.fillStyle = warm
                ? `rgba(240,212,156,${layer.windowAlpha * (0.5 + skylineRandom() * 0.5)})`
                : `rgba(130,197,207,${layer.windowAlpha * 0.65})`;
              skylineCtx.fillRect(wx, wy, 2.4 + skylineRandom() * 1.8, 1.7);
            }
          }
          x += w + 3 + skylineRandom() * 11;
        }
      }

      // A couple of warm balcony lantern glows, kept far from any faces or signage.
      const lanternGlow = skylineCtx.createRadialGradient(158, 650, 0, 158, 650, 120);
      lanternGlow.addColorStop(0, 'rgba(240,196,125,0.20)');
      lanternGlow.addColorStop(0.5, 'rgba(240,196,125,0.05)');
      lanternGlow.addColorStop(1, 'rgba(240,196,125,0)');
      skylineCtx.fillStyle = lanternGlow;
      skylineCtx.fillRect(20, 550, 280, 170);

      // Balcony railing foreground.
      const { canvas: railCanvas, ctx: railCtx } = makeCanvas(width, height, false);
      const railRandom = mulberry32(0xbac0c);
      const railTop = 640;
      const railGrad = railCtx.createLinearGradient(0, railTop, 0, railTop + 100);
      railGrad.addColorStop(0, '#07101B');
      railGrad.addColorStop(0.2, '#03080F');
      railGrad.addColorStop(1, '#010408');
      railCtx.fillStyle = railGrad;
      railCtx.fillRect(0, railTop, width, height - railTop);
      railCtx.fillStyle = '#02060B';
      railCtx.fillRect(0, railTop - 9, width, 16);
      railCtx.fillStyle = 'rgba(169,184,203,0.08)';
      railCtx.fillRect(0, railTop - 9, width, 1);

      for (let x = 24; x < width; x += 70) {
        const jitter = (railRandom() - 0.5) * 3;
        railCtx.fillStyle = 'rgba(2,7,13,0.96)';
        railCtx.fillRect(x + jitter, railTop + 7, 7, height - railTop - 7);
        railCtx.fillStyle = 'rgba(130,197,207,0.025)';
        railCtx.fillRect(x + jitter, railTop + 7, 1, height - railTop - 7);
      }
      const railFloor = railCtx.createLinearGradient(0, railTop + 58, 0, height);
      railFloor.addColorStop(0, 'rgba(3,8,14,0)');
      railFloor.addColorStop(1, 'rgba(1,4,8,0.74)');
      railCtx.fillStyle = railFloor;
      railCtx.fillRect(0, railTop + 50, width, height - railTop - 50);

      const moonSprite = makeMoonSprite(54);

      let finalBlob = null;
      let recorder = null;

      function drawStarFrame(ctx2, star, time) {
        const x = (star.x + time * star.drift) % width;
        const twinkle = 0.64 + 0.36 * Math.sin(time * star.speed * 1.7 + star.phase);
        const alpha = star.opacity * twinkle;
        if (alpha <= 0.01) return;
        ctx2.fillStyle = rgba(star.color, alpha);
        ctx2.beginPath();
        ctx2.arc(x, star.y, star.r * (0.8 + twinkle * 0.3), 0, TAU);
        ctx2.fill();
        if (star.r > 1.05) {
          const glow = ctx2.createRadialGradient(
            x,
            star.y,
            0,
            x,
            star.y,
            star.r * 5,
          );
          glow.addColorStop(0, rgba(star.color, alpha * 0.22));
          glow.addColorStop(1, rgba(star.color, 0));
          ctx2.fillStyle = glow;
          ctx2.beginPath();
          ctx2.arc(x, star.y, star.r * 5, 0, TAU);
          ctx2.fill();
        }
      }

      function renderFrame(timeSeconds) {
        const progress = smoothstep(0, 1, timeSeconds / 8);
        const moonX = width * 0.71;
        const moonY = 604 - 180 * progress;
        const fadeIn = smoothstep(0, 0.42, timeSeconds);
        const fadeOut = 1 - smoothstep(7.35, 8, timeSeconds);
        const exposure = fadeIn * fadeOut;

        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(skyCanvas, 0, 0);

        // Stars, with a very slow drift and restrained twinkle.
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        for (const star of stars) drawStarFrame(ctx, star, timeSeconds);
        for (const [x, y, r, color] of anchorStars) {
          const twinkle = 0.82 + 0.18 * Math.sin(timeSeconds * 0.7 + x * 0.01);
          drawStar(ctx, x, y, r, color, 0.72 * twinkle, true);
        }
        ctx.restore();

        // Moon and halo.
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.drawImage(
          moonSprite,
          moonX - moonSprite.width / 2,
          moonY - moonSprite.height / 2,
        );
        ctx.restore();

        // Thin clouds drift across both the moon and the skyline.
        ctx.save();
        for (const cloud of clouds) {
          const sprite = cloudSprites[cloud.sprite];
          const travel = width + sprite.width + 160;
          let x = ((cloud.x + timeSeconds * cloud.speed) % travel) - sprite.width * 0.5;
          if (x > width + sprite.width) x -= travel;
          ctx.globalAlpha = cloud.alpha;
          const drawW = sprite.width * cloud.scale;
          const drawH = sprite.height * cloud.scale;
          ctx.drawImage(sprite, x, cloud.y, drawW, drawH);
          ctx.globalAlpha = cloud.alpha;
          ctx.drawImage(sprite, x - travel, cloud.y, drawW, drawH);
        }
        ctx.restore();

        ctx.drawImage(skylineCanvas, 0, 0);
        ctx.drawImage(railCanvas, 0, 0);

        // Soft moon reflection on the balcony rail.
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        const railGlow = ctx.createRadialGradient(
          moonX,
          railTop + 20,
          0,
          moonX,
          railTop + 20,
          170,
        );
        railGlow.addColorStop(0, `rgba(220,228,225,${0.08 * exposure})`);
        railGlow.addColorStop(1, 'rgba(220,228,225,0)');
        ctx.fillStyle = railGlow;
        ctx.fillRect(moonX - 180, railTop - 20, 360, 100);
        ctx.restore();

        // Cinematic vignette and short fade at both ends.
        const vignette = ctx.createRadialGradient(
          width * 0.52,
          height * 0.44,
          120,
          width * 0.5,
          height * 0.5,
          760,
        );
        vignette.addColorStop(0, 'rgba(2,6,12,0)');
        vignette.addColorStop(0.66, 'rgba(2,6,12,0.05)');
        vignette.addColorStop(1, 'rgba(2,6,12,0.42)');
        ctx.fillStyle = vignette;
        ctx.fillRect(0, 0, width, height);

        if (exposure < 1) {
          ctx.fillStyle = `rgba(2,5,10,${1 - exposure})`;
          ctx.fillRect(0, 0, width, height);
        }
      }

      renderFrame(0);

      let stream;
      let videoTrack = null;
      let manualFrames = false;
      try {
        // Ask for no automatic canvas frames, then submit exactly ~30 frames/s
        // through requestFrame(). Feeding Chromium's capture stream at display
        // refresh caused the VP8 encoder to backlog and drop multi-second runs.
        stream = canvas.captureStream(0);
        videoTrack = stream.getVideoTracks()[0] || null;
        manualFrames = Boolean(videoTrack && typeof videoTrack.requestFrame === 'function');
        if (!manualFrames) {
          stream.getTracks().forEach((track) => track.stop());
          stream = canvas.captureStream(30);
          videoTrack = stream.getVideoTracks()[0] || null;
        }
        const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
          ? 'video/webm;codecs=vp8'
          : 'video/webm';
        recorder = new MediaRecorder(stream, {
          mimeType,
          videoBitsPerSecond: 1_500_000,
        });
      } catch (error) {
        rejectPromise(new Error(`MediaRecorder/captureStream unavailable: ${error.message}`));
        return;
      }

      const chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = (event) => {
        rejectPromise(new Error(`MediaRecorder error: ${event.error?.message ?? 'unknown'}`));
      };
      recorder.onstop = () => {
        try {
          finalBlob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
          if (finalBlob.size === 0) {
            rejectPromise(new Error('MediaRecorder produced an empty WebM blob.'));
            return;
          }
          const reader = new FileReader();
          reader.onerror = () => rejectPromise(new Error('Could not read recorded WebM blob.'));
          reader.onload = () => {
            resolvePromise({
              dataUrl: String(reader.result),
              mimeType: finalBlob.type,
              size: finalBlob.size,
              requestedFrames,
              startDelayMs: recorderStartedAt ? recorderStartedAt - startRequestedAt : null,
            });
          };
          reader.readAsDataURL(finalBlob);
        } catch (error) {
          rejectPromise(error);
        }
      };

      const frameInterval = 1000 / 30;
      let started = 0;
      let requestedFrames = 0;
      let finalFrameSent = false;
      let startRequestedAt = 0;
      let recorderStartedAt = 0;

      function stopRecording() {
        if (recorder && recorder.state !== 'inactive') recorder.stop();
        stream.getTracks().forEach((track) => track.stop());
      }

      function requestCanvasFrame() {
        if (!manualFrames || !videoTrack) return;
        try {
          videoTrack.requestFrame();
          requestedFrames += 1;
        } catch {
          // A stopped track can reject a late request; the final blob is still valid.
        }
      }

      function beginCapture() {
        started = performance.now();
        if (manualFrames) {
          // Seed the stream immediately, then submit one frame per 33.33 ms
          // interval. Scheduling against the absolute frame grid avoids drift
          // and keeps the encoded WebM close to a true 30 fps.
          renderFrame(0);
          requestCanvasFrame();
          const tick = () => {
            const elapsed = performance.now() - started;
            if (elapsed >= durationMs) {
              if (!finalFrameSent) {
                renderFrame(durationMs / 1000);
                requestCanvasFrame();
                finalFrameSent = true;
              }
              setTimeout(stopRecording, 100);
              return;
            }
            renderFrame(elapsed / 1000);
            requestCanvasFrame();
            const phase = (performance.now() - started) % frameInterval;
            setTimeout(tick, Math.max(1, frameInterval - phase));
          };
          setTimeout(tick, frameInterval);
        } else {
          const animate = (now) => {
            const elapsed = now - started;
            renderFrame(Math.min(durationMs, elapsed) / 1000);
            if (elapsed < durationMs) {
              requestAnimationFrame(animate);
            } else {
              renderFrame(durationMs / 1000);
              setTimeout(stopRecording, 60);
            }
          };
          requestAnimationFrame(animate);
        }
      }

      // The encoder has already been warmed, so start submitting canvas frames
      // immediately; waiting for the asynchronous start event would leave a gap
      // at the head of the recording while Chromium finishes attaching the track.
      recorder.onstart = () => {
        recorderStartedAt = performance.now();
      };
      startRequestedAt = performance.now();
      recorder.start();
      beginCapture();
    });
  }

  function warmUpVideoEncoder() {
    return new Promise((resolvePromise) => {
      const started = performance.now();
      let timer = null;
      let warmStream = null;
      let warmRecorder = null;
      let settled = false;
      let mimeType = 'video/webm';
      const finish = () => {
        if (settled) return;
        settled = true;
        if (timer) clearInterval(timer);
        try {
          if (warmStream) warmStream.getTracks().forEach((track) => track.stop());
        } catch {
          // The warm-up stream is already being discarded.
        }
        resolvePromise({
          ms: performance.now() - started,
          mimeType,
        });
      };

      try {
        mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
          ? 'video/webm;codecs=vp8'
          : 'video/webm';
        const { canvas: warmCanvas, ctx: warmCtx } = makeCanvas(1280, 720, true);
        warmCtx.fillStyle = '#08111F';
        warmCtx.fillRect(0, 0, 1280, 720);
        warmStream = warmCanvas.captureStream(0);
        const warmTrack = warmStream.getVideoTracks()[0];
        warmRecorder = new MediaRecorder(warmStream, {
          mimeType,
          videoBitsPerSecond: 1_500_000,
        });
        warmRecorder.onstart = () => {
          try {
            warmRecorder.stop();
          } catch {
            finish();
          }
        };
        warmRecorder.onstop = finish;
        warmRecorder.onerror = finish;
        warmRecorder.start();

        let tick = 0;
        timer = setInterval(() => {
          tick += 1;
          warmCtx.fillStyle = tick % 2 ? '#08111F' : '#0A1526';
          warmCtx.fillRect(0, 0, 1280, 720);
          if (warmTrack && typeof warmTrack.requestFrame === 'function') {
            try {
              warmTrack.requestFrame();
            } catch {
              // A completed warm-up can ignore a late frame request.
            }
          }
          if (tick > 240) finish();
        }, 1000 / 30);
      } catch {
        finish();
      }
    });
  }

  window.__demo = {
    renderSeaSunset,
    renderRainStreet,
    renderMountainStars,
    renderNightTrain,
    recordBalconyMoon,
    warmUpVideoEncoder,
  };
}

function decodeDataUrl(dataUrl) {
  const match = /^data:([^,]+);base64,([\s\S]+)$/.exec(dataUrl);
  if (!match) throw new Error('Unexpected data URL returned by Chromium.');
  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], 'base64'),
  };
}

function writeAsset(filename, buffer) {
  const path = join(outputDir, filename);
  writeFileSync(path, buffer);
  const size = statSync(path).size;
  if (!size) throw new Error(`${filename} was written as an empty file.`);
  console.log(`  ${filename.padEnd(20)} ${formatBytes(size)}`);
  return { path, size };
}

function synthesizeRoomTone() {
  const sampleRate = 44100;
  const duration = 12;
  const totalSamples = sampleRate * duration;
  const random = (() => {
    let state = 0xa0d10;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), 1 | t);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();

  const partials = [
    { frequency: 110.0, amplitude: 0.108, phase: 0.7, breath: 0.05, drift: 0.00055 },
    { frequency: 164.81, amplitude: 0.075, phase: 2.1, breath: 0.041, drift: -0.00042 },
    { frequency: 220.0, amplitude: 0.058, phase: 4.4, breath: 0.063, drift: 0.00036 },
    { frequency: 261.63, amplitude: 0.026, phase: 1.4, breath: 0.047, drift: -0.00028 },
    { frequency: 329.63, amplitude: 0.032, phase: 5.2, breath: 0.072, drift: 0.00031 },
    { frequency: 440.0, amplitude: 0.0095, phase: 3.0, breath: 0.033, drift: -0.00022 },
    { frequency: 659.25, amplitude: 0.0042, phase: 5.9, breath: 0.025, drift: 0.00018 },
  ];

  const pcm = new Float32Array(totalSamples);
  let lowNoise = 0;
  let lowNoise2 = 0;
  let peak = 0;

  for (let i = 0; i < totalSamples; i += 1) {
    const time = i / sampleRate;
    const fadeIn = smoothstep(0, 2.3, time);
    const fadeOut = 1 - smoothstep(duration - 2.9, duration, time);
    const globalBreath = 0.80 + 0.20 * Math.sin(TAU * 0.061 * time + 0.4);

    let sample = 0;
    for (const partial of partials) {
      const breathing = 0.76 + 0.24 * Math.sin(TAU * partial.breath * time + partial.phase);
      const frequency =
        partial.frequency * (1 + partial.drift * Math.sin(TAU * 0.027 * time + partial.phase * 0.6));
      sample +=
        Math.sin(TAU * frequency * time + partial.phase) *
        partial.amplitude *
        breathing;
      // A quiet even harmonic rounds each partial without making it organ-like.
      sample +=
        Math.sin(TAU * frequency * 2 * time + partial.phase * 0.4) *
        partial.amplitude *
        0.085 *
        breathing;
    }

    // Two-pole filtered noise: a soft room-air bed, deterministic.
    const white = random() * 2 - 1;
    lowNoise += (white - lowNoise) * 0.018;
    lowNoise2 += (lowNoise - lowNoise2) * 0.045;
    sample += lowNoise2 * 0.14;

    sample *= globalBreath * fadeIn * fadeOut;
    // Gentle asymmetric saturation keeps the quiet chord from feeling synthetic.
    sample = Math.tanh(sample * 1.18) * 0.92;
    pcm[i] = sample;
    peak = Math.max(peak, Math.abs(sample));
  }

  const gain = 0.46 / Math.max(peak, 0.001);
  const int16 = new Int16Array(totalSamples);
  for (let i = 0; i < totalSamples; i += 1) {
    const value = Math.max(-1, Math.min(1, pcm[i] * gain));
    int16[i] = Math.round(value < 0 ? value * 32768 : value * 32767);
  }

  const lamePath = require.resolve('lamejs/lame.all.js');
  const lameSource = readFileSync(lamePath, 'utf8');
  const lamejs = new Function(`${lameSource}\n;return lamejs;`)();
  if (!lamejs || typeof lamejs.Mp3Encoder !== 'function') {
    throw new Error('The lamejs UMD build did not expose Mp3Encoder.');
  }

  const encoder = new lamejs.Mp3Encoder(1, sampleRate, 112);
  const chunks = [];
  const blockSize = 1152;
  for (let offset = 0; offset < int16.length; offset += blockSize) {
    const block = int16.subarray(offset, Math.min(offset + blockSize, int16.length));
    const encoded = encoder.encodeBuffer(block);
    if (encoded.length > 0) chunks.push(Buffer.from(encoded));
  }
  const flushed = encoder.flush();
  if (flushed.length > 0) chunks.push(Buffer.from(flushed));

  const buffer = Buffer.concat(chunks);
  if (buffer.length < 1000) throw new Error('lamejs returned an implausibly small MP3.');
  return buffer;
}

async function verifyMedia(browser, assets) {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 800 },
    deviceScaleFactor: 1,
  });

  const payload = {
    images: Object.fromEntries(
      Object.entries(assets)
        .filter(([key]) => ['sea', 'rain', 'mountain', 'train'].includes(key))
        .map(([key, asset]) => [
          key,
          {
            dataUrl: `data:${asset.mimeType};base64,${asset.buffer.toString('base64')}`,
            mimeType: asset.mimeType,
          },
        ]),
    ),
    audio: {
      dataUrl: `data:${assets.audio.mimeType};base64,${assets.audio.buffer.toString('base64')}`,
      mimeType: assets.audio.mimeType,
    },
    video: {
      dataUrl: `data:${assets.video.mimeType};base64,${assets.video.buffer.toString('base64')}`,
      mimeType: assets.video.mimeType,
    },
  };

  const result = await page.evaluate(async (input) => {
    function timeoutAfter(ms, message) {
      return new Promise((_, reject) => {
        setTimeout(() => reject(new Error(message)), ms);
      });
    }

    async function imageMeta(dataUrl) {
      const image = new Image();
      image.src = dataUrl;
      await Promise.race([
        new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = () => reject(new Error('Image failed to decode'));
        }),
        timeoutAfter(8000, 'Timed out decoding image'),
      ]);
      return {
        width: image.naturalWidth,
        height: image.naturalHeight,
      };
    }

    async function audioMeta(dataUrl) {
      const audio = document.createElement('audio');
      audio.preload = 'metadata';
      audio.src = dataUrl;
      await Promise.race([
        new Promise((resolve, reject) => {
          audio.addEventListener('loadedmetadata', resolve, { once: true });
          audio.addEventListener('error', () => reject(new Error('Audio failed to load')), {
            once: true,
          });
        }),
        timeoutAfter(8000, 'Timed out loading audio'),
      ]);
      const metadata = {
        duration: audio.duration,
        canPlay: audio.canPlayType('audio/mpeg'),
        readyState: audio.readyState,
        sampleRate: null,
        channels: null,
        decodedDuration: null,
      };

      try {
        const response = await fetch(dataUrl);
        const bytes = await response.arrayBuffer();
        const audioContext = new OfflineAudioContext(1, 44100, 44100);
        const decoded = await audioContext.decodeAudioData(bytes);
        metadata.sampleRate = decoded.sampleRate;
        metadata.channels = decoded.numberOfChannels;
        metadata.decodedDuration = decoded.duration;
      } catch {
        // Metadata + canPlayType remain sufficient if decoding is unavailable.
      }

      return metadata;
    }

    async function videoMeta(dataUrl) {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.src = dataUrl;
      await Promise.race([
        new Promise((resolve, reject) => {
          video.addEventListener('loadedmetadata', resolve, { once: true });
          video.addEventListener('error', () => reject(new Error('Video failed to load')), {
            once: true,
          });
        }),
        timeoutAfter(10000, 'Timed out loading video'),
      ]);

      let duration = video.duration;
      if (!Number.isFinite(duration)) {
        // MediaRecorder WebM often omits a duration in the header. Seeking past
        // the end makes Chromium resolve it to the last available timestamp.
        duration = await new Promise((resolve) => {
          let settled = false;
          const done = () => {
            if (settled) return;
            settled = true;
            resolve(video.duration);
          };
          video.addEventListener('timeupdate', done);
          video.addEventListener('seeked', done);
          setTimeout(done, 1800);
          try {
            video.currentTime = 1e9;
          } catch {
            done();
          }
        });
      }

      return {
        duration,
        width: video.videoWidth,
        height: video.videoHeight,
        canPlayVp8: video.canPlayType('video/webm; codecs="vp8"'),
        canPlayWebm: video.canPlayType('video/webm'),
        readyState: video.readyState,
      };
    }

    const images = {};
    for (const [key, item] of Object.entries(input.images)) {
      images[key] = await imageMeta(item.dataUrl);
    }
    const audio = await audioMeta(input.audio.dataUrl);
    const video = await videoMeta(input.video.dataUrl);
    return { images, audio, video };
  }, payload);

  await page.close();
  return result;
}

async function takeContactSheet(browser, assets) {
  mkdirSync(screenshotDir, { recursive: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });

  const imageTags = ['sea', 'rain', 'mountain', 'train']
    .map((key) => {
      const asset = assets[key];
      const dataUrl = `data:${asset.mimeType};base64,${asset.buffer.toString('base64')}`;
      return `<figure><img src="${dataUrl}" alt=""></figure>`;
    })
    .join('');

  await page.setContent(`<!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          * { box-sizing: border-box; }
          html, body { margin: 0; width: 1440px; height: 900px; overflow: hidden; }
          body {
            background:
              radial-gradient(1000px 520px at 50% -8%, rgba(185,161,232,0.07), transparent 70%),
              #08111F;
            display: grid;
            place-items: center;
            padding: 28px 34px;
          }
          main {
            display: grid;
            grid-template-columns: repeat(2, 662px);
            grid-template-rows: repeat(2, 412px);
            gap: 18px 22px;
          }
          figure {
            margin: 0;
            overflow: hidden;
            background: #0B1424;
            box-shadow: 0 18px 48px rgba(0,0,0,0.38), 0 0 0 1px rgba(169,184,203,0.07);
          }
          img { display: block; width: 100%; height: 100%; object-fit: cover; }
        </style>
      </head>
      <body><main>${imageTags}</main></body>
    </html>`);
  await page.waitForFunction(
    () => Array.from(document.images).every((image) => image.complete && image.naturalWidth > 0),
    null,
    { timeout: 8000 },
  );
  await page.waitForTimeout(250);
  const screenshotPath = join(screenshotDir, 'demo-contact-sheet.png');
  await page.screenshot({ path: screenshotPath, type: 'png' });
  await page.close();
  return screenshotPath;
}

function assertSignature(filename, buffer) {
  const extension = filename.split('.').pop();
  const signatures = {
    jpg: [[0xff, 0xd8, 0xff]],
    webp: [[0x52, 0x49, 0x46, 0x46]],
    png: [[0x89, 0x50, 0x4e, 0x47]],
    mp3: [[0x49, 0x44, 0x33], [0xff]],
    webm: [[0x1a, 0x45, 0xdf, 0xa3]],
  };
  const options = signatures[extension];
  if (!options) throw new Error(`Unknown extension for ${filename}`);
  const ok = options.some((signature) =>
    signature.every((byte, index) => buffer[index] === byte),
  );
  if (!ok) throw new Error(`${filename} does not have a valid ${extension} signature.`);
  if (
    extension === 'webp' &&
    buffer.subarray(8, 12).toString('ascii') !== 'WEBP'
  ) {
    throw new Error(`${filename} is a RIFF file but not a WebP image.`);
  }
}

async function main() {
  console.log('OURVERSE demo media generator');
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(screenshotDir, { recursive: true });

  const executablePath = findCachedChromium();
  console.log(`Chromium: ${executablePath}`);
  const browser = await chromium.launch(launchOptions(executablePath));

  try {
    const page = await browser.newPage({
      viewport: { width: 1600, height: 1000 },
      deviceScaleFactor: 1,
    });
    page.on('pageerror', (error) => {
      console.error('Browser page error:', error);
    });
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.evaluate(installPageRuntime);

    console.log('\nRendering images:');
    const rendered = {};
    for (const [key, method, filename] of [
      ['sea', 'renderSeaSunset', ASSETS.sea],
      ['rain', 'renderRainStreet', ASSETS.rain],
      ['mountain', 'renderMountainStars', ASSETS.mountain],
      ['train', 'renderNightTrain', ASSETS.train],
    ]) {
      const dataUrl = await page.evaluate((name) => window.__demo[name](), method);
      const { buffer, mimeType } = decodeDataUrl(dataUrl);
      assertSignature(filename, buffer);
      writeAsset(filename, buffer);
      rendered[key] = { buffer, mimeType };
    }

    console.log('\nRendering video (8 s, VP8):');
    const warmup = await page.evaluate(() => window.__demo.warmUpVideoEncoder());
    console.log(
      `  VP8 encoder warmed in ${(warmup.ms / 1000).toFixed(2)} s (${warmup.mimeType})`,
    );
    const videoStart = Date.now();
    const video = await page.evaluate(() => window.__demo.recordBalconyMoon());
    const videoDecoded = decodeDataUrl(video.dataUrl);
    assertSignature(ASSETS.video, videoDecoded.buffer);
    writeAsset(ASSETS.video, videoDecoded.buffer);
    rendered.video = {
      buffer: videoDecoded.buffer,
      mimeType: videoDecoded.mimeType || video.mimeType,
    };
    console.log(`  recorded in ${((Date.now() - videoStart) / 1000).toFixed(1)} s`);
    console.log(
      `  recorder start event after ${video.startDelayMs == null ? 'unknown' : video.startDelayMs.toFixed(0)} ms; ` +
        `${video.requestedFrames ?? 'unknown'} canvas frames submitted at 30 Hz`,
    );

    await page.close();

    console.log('\nSynthesizing audio:');
    const mp3 = synthesizeRoomTone();
    assertSignature(ASSETS.audio, mp3);
    writeAsset(ASSETS.audio, mp3);
    rendered.audio = { buffer: mp3, mimeType: 'audio/mpeg' };

    // Reject missing/empty files before verification.
    for (const filename of Object.values(ASSETS)) {
      const fullPath = join(outputDir, filename);
      if (!existsSync(fullPath)) throw new Error(`Missing output: ${fullPath}`);
      const size = statSync(fullPath).size;
      if (size === 0) throw new Error(`Empty output: ${fullPath}`);
    }

    console.log('\nVerifying in Chromium:');
    const verification = await verifyMedia(browser, rendered);

    const imageExpectations = {
      sea: ['sea-sunset.jpg', 1600, 1000],
      rain: ['rain-street.webp', 1600, 1000],
      mountain: ['mountain-stars.png', 1600, 1000],
      train: ['night-train.jpg', 1600, 1000],
    };
    for (const [key, [filename, expectedWidth, expectedHeight]] of Object.entries(
      imageExpectations,
    )) {
      const meta = verification.images[key];
      if (!meta || meta.width !== expectedWidth || meta.height !== expectedHeight) {
        throw new Error(
          `${filename} dimensions were ${meta?.width}x${meta?.height}, expected ${expectedWidth}x${expectedHeight}.`,
        );
      }
      console.log(
        `  ${filename.padEnd(20)} ${meta.width}x${meta.height}  ${rendered[key].mimeType}`,
      );
    }

    if (!Number.isFinite(verification.audio.duration) || verification.audio.duration <= 0) {
      throw new Error('room-tone.mp3 did not expose a positive duration in <audio>.');
    }
    if (verification.audio.duration < 10.5 || verification.audio.duration > 13.5) {
      throw new Error(
        `room-tone.mp3 duration ${verification.audio.duration.toFixed(3)} s is outside the expected range.`,
      );
    }
    console.log(
      `  room-tone.mp3        duration ${verification.audio.duration.toFixed(3)} s  ` +
        `${verification.audio.sampleRate ?? '?'} Hz  ` +
        `${verification.audio.channels ?? '?'} ch  ` +
        `MIME ${rendered.audio.mimeType}  canPlayType=${verification.audio.canPlay || '""'}`,
    );

    if (
      !Number.isFinite(verification.video.duration) ||
      verification.video.duration < 7 ||
      verification.video.duration > 9.5
    ) {
      throw new Error(
        `balcony-moon.webm duration ${verification.video.duration} s is outside the expected range.`,
      );
    }
    if (verification.video.width !== 1280 || verification.video.height !== 720) {
      throw new Error(
        `balcony-moon.webm dimensions were ${verification.video.width}x${verification.video.height}, expected 1280x720.`,
      );
    }
    console.log(
      `  balcony-moon.webm    duration ${verification.video.duration.toFixed(3)} s  ` +
        `${verification.video.width}x${verification.video.height}  ` +
        `MIME ${rendered.video.mimeType}  canPlayType(vp8)=${verification.video.canPlayVp8 || '""'}`,
    );

    const videoSize = statSync(join(outputDir, ASSETS.video)).size;
    const pngSize = statSync(join(outputDir, ASSETS.mountain)).size;
    const mp3Size = statSync(join(outputDir, ASSETS.audio)).size;
    if (pngSize >= 2.5 * 1024 * 1024) {
      throw new Error(`mountain-stars.png is ${formatBytes(pngSize)} (limit 2.5 MB).`);
    }
    if (videoSize >= 2.5 * 1024 * 1024) {
      throw new Error(`balcony-moon.webm is ${formatBytes(videoSize)} (limit 2.5 MB).`);
    }
    if (mp3Size >= 300 * 1024) {
      throw new Error(`room-tone.mp3 is ${formatBytes(mp3Size)} (limit 300 KB).`);
    }

    const screenshotPath = await takeContactSheet(browser, rendered);
    console.log(`\nScreenshot: ${screenshotPath}`);

    console.log('\nAll six demo assets generated and verified.');
    const total = Object.values(ASSETS).reduce(
      (sum, filename) => sum + statSync(join(outputDir, filename)).size,
      0,
    );
    console.log(`Output directory: ${outputDir}`);
    console.log(`Total: ${formatBytes(total)}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error('\nDemo media generation failed.');
  console.error(error?.stack || error);
  process.exit(1);
});
