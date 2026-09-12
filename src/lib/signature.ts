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

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
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
