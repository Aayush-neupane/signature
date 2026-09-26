export interface Point {
  x: number;
  y: number;
  pressure: number;
  time: number;
}

export interface Stroke {
  points: Point[];
  /** Base width in CSS px at 1x scale */
  width: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const MIN_WIDTH_FACTOR = 0.35;
const MAX_WIDTH_FACTOR = 1.15;

/** Velocity-sensitive width for a segment, smoothed against the previous width. */
export function segmentWidth(
  p0: Point,
  p1: Point,
  baseWidth: number,
  lastWidth: number,
): number {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const dist = Math.hypot(dx, dy);
  const dt = Math.max(1, p1.time - p0.time);
  const velocity = dist / dt; // px per ms

  const pressure = p1.pressure > 0 ? p1.pressure : 0.5;
  // Faster movement -> thinner line; harder pressure -> thicker line.
  const target =
    baseWidth * (0.55 + pressure * 0.5) - velocity * 0.22 * (baseWidth / 2.5);
  const clamped = Math.min(
    baseWidth * MAX_WIDTH_FACTOR,
    Math.max(baseWidth * MIN_WIDTH_FACTOR, target),
  );
  // Light smoothing to avoid jitter.
  return lastWidth * 0.65 + clamped * 0.35;
}

/** Draw a single segment as a round-capped line. Overlapping caps keep it smooth. */
function drawSegment(
  ctx: CanvasRenderingContext2D,
  p0: Point,
  p1: Point,
  width: number,
  color: string,
) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x + 0.01, p1.y + 0.01);
  ctx.stroke();
}

/** Draw one full stroke. Used for both live rendering and export. */
export function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  color: string,
) {
  const { points, width: baseWidth } = stroke;
  if (points.length === 0) return;
  if (points.length === 1) {
    const p = points[0];
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, baseWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  let lastWidth = baseWidth;
  for (let i = 0; i < points.length - 1; i++) {
    const w = segmentWidth(points[i], points[i + 1], baseWidth, lastWidth);
    drawSegment(ctx, points[i], points[i + 1], w, color);
    lastWidth = w;
  }
}

export function redrawAll(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  color: string,
) {
  drawStrokeBatch(ctx, strokes, color);
}

function drawStrokeBatch(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  color: string,
) {
  for (const s of strokes) drawStroke(ctx, s, color);
}

export function getStrokesBounds(strokes: Stroke[]): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let found = false;
  for (const s of strokes) {
    for (const p of s.points) {
      found = true;
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!found) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * Render strokes cropped to their actual bounds onto a transparent
 * offscreen canvas at high resolution. Returns null when empty.
 */
export function renderCroppedTransparent(
  strokes: Stroke[],
  opts: { padding?: number; scale?: number; color: string },
): HTMLCanvasElement | null {
  const bounds = getStrokesBounds(strokes);
  if (!bounds) return null;

  const padding = opts.padding ?? 24;
  const scale = opts.scale ?? 3;
  const color = opts.color;

  let maxWidth = 0;
  for (const s of strokes) maxWidth = Math.max(maxWidth, s.width);
  const bleed = maxWidth / 2 + 2;

  const minX = Math.floor(bounds.minX - bleed - padding);
  const minY = Math.floor(bounds.minY - bleed - padding);
  const maxX = Math.ceil(bounds.maxX + bleed + padding);
  const maxY = Math.ceil(bounds.maxY + bleed + padding);

  const cssW = Math.max(1, maxX - minX);
  const cssH = Math.max(1, maxY - minY);

  const out = document.createElement("canvas");
  out.width = Math.round(cssW * scale);
  out.height = Math.round(cssH * scale);

  const ctx = out.getContext("2d");
  if (!ctx) return null;

  // No background fill — canvas stays fully transparent.
  ctx.scale(scale, scale);
  ctx.translate(-minX, -minY);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  drawStrokeBatch(ctx, strokes, color);
  return out;
}

/* ---------- Auto-refine ---------- */

function pointDist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Drop near-stationary samples that only contribute jitter. Keeps endpoints. */
function decimate(points: Point[], minDist = 0.8): Point[] {
  if (points.length < 3) return points.slice();
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    if (pointDist(points[i], out[out.length - 1]) >= minDist) out.push(points[i]);
  }
  out.push(points[points.length - 1]);
  return out;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Turn angle at b (0 = straight, PI = hairpin). */
function turningAngle(a: Point, b: Point, c: Point): number {
  const v1x = b.x - a.x;
  const v1y = b.y - a.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const l1 = Math.hypot(v1x, v1y);
  const l2 = Math.hypot(v2x, v2y);
  if (l1 < 1e-6 || l2 < 1e-6) return 0;
  return Math.abs(
    Math.atan2(v1x * v2y - v1y * v2x, v1x * v2x + v1y * v2y),
  );
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** Perpendicular distance to the infinite line through a and b. */
function distToLine(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return pointDist(p, a);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

/**
 * Trim pen-down / pen-lift hooks: short initial/final jabs that shoot
 * backwards against the stroke's emerging direction. Conservative —
 * only touches clear reversals under 12px with solid context behind them.
 */
function trimHooks(points: Point[]): Point[] {
  const LOOK = 8;
  const MIN_CONTEXT = 10;
  let pts = points;
  for (let k = 0; k < 3 && pts.length > 5; k++) {
    const d1x = pts[1].x - pts[0].x;
    const d1y = pts[1].y - pts[0].y;
    const ref = pts[Math.min(LOOK, pts.length - 1)];
    const drx = ref.x - pts[0].x;
    const dry = ref.y - pts[0].y;
    const l1 = Math.hypot(d1x, d1y);
    const lr = Math.hypot(drx, dry);
    if (l1 < 1e-6 || lr < MIN_CONTEXT || l1 > 12) break;
    if ((d1x * drx + d1y * dry) / (l1 * lr) < -0.15) pts = pts.slice(1);
    else break;
  }
  for (let k = 0; k < 3 && pts.length > 5; k++) {
    const n = pts.length;
    const d1x = pts[n - 1].x - pts[n - 2].x;
    const d1y = pts[n - 1].y - pts[n - 2].y;
    const ref = pts[Math.max(0, n - 1 - LOOK)];
    const drx = pts[n - 1].x - ref.x;
    const dry = pts[n - 1].y - ref.y;
    const l1 = Math.hypot(d1x, d1y);
    const lr = Math.hypot(drx, dry);
    if (l1 < 1e-6 || lr < MIN_CONTEXT || l1 > 12) break;
    if ((d1x * drx + d1y * dry) / (l1 * lr) < -0.15) pts = pts.slice(0, -1);
    else break;
  }
  return pts;
}

/**
 * Remove lone outlier spikes: a single sample jumping off the line while
 * the samples two steps out on both sides stay on it. Genuine corners
 * (sustained direction changes) never match this pattern.
 */
function removeSpikes(points: Point[]): Point[] {
  if (points.length < 6) return points.slice();
  const out = [points[0], points[1]];
  for (let i = 2; i < points.length - 2; i++) {
    const a = points[i - 1];
    const b = points[i];
    const c = points[i + 1];
    const isolated =
      distToLine(points[i - 2], a, c) < 3.5 &&
      distToLine(points[i + 2], a, c) < 3.5;
    if (isolated && distToSegment(b, a, c) > 5) continue;
    out.push(b);
  }
  out.push(points[points.length - 2], points[points.length - 1]);
  return out;
}

/**
 * Corner-aware relaxation: smooths straight runs firmly while leaving
 * genuine corners, loops, and flicks alone. Endpoints stay fixed.
 */
function adaptiveRelax(points: Point[], passes = 3, strength = 0.65): Point[] {
  const STRAIGHT = (18 * Math.PI) / 180;
  const CORNER = (65 * Math.PI) / 180;
  let cur = points;
  for (let p = 0; p < passes; p++) {
    const next = [cur[0]];
    for (let i = 1; i < cur.length - 1; i++) {
      const a = cur[i - 1];
      const b = cur[i];
      const c = cur[i + 1];
      const w =
        (1 - smoothstep(STRAIGHT, CORNER, turningAngle(a, b, c))) * strength;
      next.push({
        x: b.x + ((a.x + c.x) / 2 - b.x) * w,
        y: b.y + ((a.y + c.y) / 2 - b.y) * w,
        pressure: b.pressure,
        time: b.time,
      });
    }
    next.push(cur[cur.length - 1]);
    cur = next;
  }
  return cur;
}

/** Douglas-Peucker simplification: drop redundant points, keep shape. */
function simplify(points: Point[], eps = 0.6): Point[] {
  if (points.length < 4) return points.slice();
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  let range = stack.pop();
  while (range !== undefined) {
    const [s, e] = range;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = distToSegment(points[i], points[s], points[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > eps && idx > 0) {
      keep[idx] = true;
      stack.push([s, idx], [idx, e]);
    }
    range = stack.pop();
  }
  return points.filter((_, i) => keep[i]);
}

function catmullRomSample(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  t: number,
): Point {
  const t2 = t * t;
  const t3 = t2 * t;
  const blend = (a: number, b: number, c: number, d: number) =>
    0.5 *
    (2 * b +
      (-a + c) * t +
      (2 * a - 5 * b + 4 * c - d) * t2 +
      (-a + 3 * b - 3 * c + d) * t3);
  return {
    x: blend(p0.x, p1.x, p2.x, p3.x),
    y: blend(p0.y, p1.y, p2.y, p3.y),
    pressure: p1.pressure + (p2.pressure - p1.pressure) * t,
    time: p1.time + (p2.time - p1.time) * t,
  };
}

/** Subdivide spans along a Catmull-Rom spline for silky, defined curves. */
function resample(points: Point[], perSpan = 3): Point[] {
  if (points.length < 3) return points.slice();
  const out: Point[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    out.push(p1);
    if (pointDist(p1, p2) > 1.5) {
      for (let j = 1; j <= perSpan; j++) {
        out.push(catmullRomSample(p0, p1, p2, p3, j / (perSpan + 1)));
      }
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * Auto-refine a finished stroke: trim pen hooks, kill spikes, drop
 * jitter samples, corner-aware smoothing, simplify, then resample along
 * a spline for clean, well-defined curves. Short taps and dots pass
 * through untouched.
 */
export function finalizeStroke(stroke: Stroke): Stroke {
  if (stroke.points.length < 4) return stroke;
  let pts = trimHooks(stroke.points);
  if (pts.length < 4) return { ...stroke, points: pts };
  pts = simplify(adaptiveRelax(decimate(removeSpikes(pts)), 3));
  if (pts.length < 3) return { ...stroke, points: pts };
  return { ...stroke, points: resample(pts, 4) };
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

export function canvasToJpegBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  const flat = document.createElement("canvas");
  flat.width = canvas.width;
  flat.height = canvas.height;
  const ctx = flat.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, flat.width, flat.height);
  ctx.drawImage(canvas, 0, 0);
  return new Promise((resolve) => flat.toBlob(resolve, "image/jpeg", 0.92));
}

function escXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Vector export: strokes become round-capped polylines at their base
 * widths, cropped to the same padded bounds as the PNG export.
 */
export function strokesToSvg(
  strokes: Stroke[],
  opts: { padding?: number; color: string },
): string | null {
  const bounds = getStrokesBounds(strokes);
  if (!bounds) return null;
  const padding = opts.padding ?? 24;
  let maxWidth = 0;
  for (const s of strokes) maxWidth = Math.max(maxWidth, s.width);
  const bleed = maxWidth / 2 + 2;
  const minX = Math.floor(bounds.minX - bleed - padding);
  const minY = Math.floor(bounds.minY - bleed - padding);
  const w = Math.max(1, Math.ceil(bounds.maxX + bleed + padding) - minX);
  const h = Math.max(1, Math.ceil(bounds.maxY + bleed + padding) - minY);
  const paths = strokes
    .map((s) => {
      if (s.points.length === 0) return "";
      if (s.points.length === 1) {
        const p = s.points[0];
        return `<circle cx="${(p.x - minX).toFixed(2)}" cy="${(p.y - minY).toFixed(2)}" r="${(s.width / 2).toFixed(2)}" fill="${escXml(opts.color)}"/>`;
      }
      const d =
        `M${(s.points[0].x - minX).toFixed(2)} ${(s.points[0].y - minY).toFixed(2)}` +
        s.points.slice(1).map((p) => `L${(p.x - minX).toFixed(2)} ${(p.y - minY).toFixed(2)}`).join("");
      return `<path d="${d}" fill="none" stroke="${escXml(opts.color)}" stroke-width="${s.width.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`;
    })
    .filter(Boolean)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${paths}</svg>`;
}

export function downloadText(text: string, filename: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  downloadBlob(blob, filename);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the browser has had a chance to start the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}
