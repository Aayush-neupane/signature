import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import {
  canvasToBlob,
  downloadBlob,
  drawStroke,
  redrawAll,
  renderCroppedTransparent,
  type Point,
  type Stroke,
} from "../lib/signature";

export interface SignatureCanvasHandle {
  clear: () => void;
  undo: () => void;
  download: () => Promise<boolean>;
  isEmpty: () => boolean;
  getStrokeCount: () => number;
}

interface Props {
  strokeWidth: number;
  inkColor: string;
  onChange: (state: { isEmpty: boolean; strokes: number }) => void;
  onDownloaded: () => void;
  onDownloadError: (message: string) => void;
}

function eventPoint(
  e: PointerEvent | React.PointerEvent,
  rect: DOMRect,
): Point {
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
    pressure: typeof e.pressure === "number" && e.pressure > 0 ? e.pressure : 0.5,
    time: performance.now(),
  };
}

const SignatureCanvas = forwardRef<SignatureCanvasHandle, Props>(
  function SignatureCanvas(
    { strokeWidth, inkColor, onChange, onDownloaded, onDownloadError },
    ref,
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const strokesRef = useRef<Stroke[]>([]);
    const drawingRef = useRef<Stroke | null>(null);
    const optsRef = useRef({ strokeWidth, inkColor });
    const callbacksRef = useRef({ onChange, onDownloaded, onDownloadError });

    useEffect(() => {
      optsRef.current = { strokeWidth, inkColor };
    }, [strokeWidth, inkColor]);

    useEffect(() => {
      callbacksRef.current = { onChange, onDownloaded, onDownloadError };
    }, [onChange, onDownloaded, onDownloadError]);

    const emitChange = useCallback(() => {
      const n = strokesRef.current.length + (drawingRef.current ? 1 : 0);
      callbacksRef.current.onChange({ isEmpty: n === 0, strokes: n });
    }, []);

    /** Size backing store for the current CSS size × DPR, preserving art. */
    const fitCanvas = useCallback(() => {
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!canvas || !wrap) return;
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const cssW = wrap.clientWidth;
      const cssH = wrap.clientHeight;
      if (cssW === 0 || cssH === 0) return;
      const bw = Math.round(cssW * dpr);
      const bh = Math.round(cssH * dpr);
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        redrawAll(ctx, strokesRef.current, optsRef.current.inkColor);
        if (drawingRef.current) {
          drawStroke(ctx, drawingRef.current, optsRef.current.inkColor);
        }
      }
    }, []);

    useEffect(() => {
      fitCanvas();
      const wrap = wrapRef.current;
      if (!wrap || typeof ResizeObserver === "undefined") return;
      const ro = new ResizeObserver(() => fitCanvas());
      ro.observe(wrap);
      return () => ro.disconnect();
    }, [fitCanvas]);

    const redraw = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      redrawAll(ctx, strokesRef.current, optsRef.current.inkColor);
      ctx.restore();
    }, []);

    // Ink is global: recolor existing strokes live so the canvas
    // always previews exactly what the PNG will contain.
    useEffect(() => {
      redraw();
    }, [inkColor, redraw]);

    const clear = useCallback(() => {
      strokesRef.current = [];
      drawingRef.current = null;
      redraw();
      emitChange();
    }, [emitChange, redraw]);

    const undo = useCallback(() => {
      if (drawingRef.current) return; // don't undo mid-stroke
      strokesRef.current.pop();
      redraw();
      emitChange();
    }, [emitChange, redraw]);

    const download = useCallback(async () => {
      if (strokesRef.current.length === 0) {
        callbacksRef.current.onDownloadError("Draw your signature first.");
        return false;
      }
      const out = renderCroppedTransparent(strokesRef.current, {
        padding: 24,
        scale: 3,
        color: optsRef.current.inkColor,
      });
      if (!out) {
        callbacksRef.current.onDownloadError("Draw your signature first.");
        return false;
      }
      const blob = await canvasToBlob(out);
      if (!blob) {
        callbacksRef.current.onDownloadError("Could not create the PNG. Try again.");
        return false;
      }
      downloadBlob(blob, "signature.png");
      callbacksRef.current.onDownloaded();
      return true;
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        clear,
        undo,
        download,
        isEmpty: () => strokesRef.current.length === 0,
        getStrokeCount: () => strokesRef.current.length,
      }),
      [clear, undo, download],
    );

    // Pointer handlers — attached imperatively so we can use
    // coalesced events and non-passive touch prevention.
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      let activePointerId: number | null = null;
      let lastDrawnIndex = 0;

      const appendPoint = (p: Point) => {
        const current = drawingRef.current;
        if (!current) return;
        const prev = current.points[current.points.length - 1];
        // Drop exact duplicates (can happen with coalesced events).
        if (prev && prev.x === p.x && prev.y === p.y) return;
        current.points.push(p);
        // Incremental paint: draw only the new tail segment(s).
        const dpr = Math.min(3, window.devicePixelRatio || 1);
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const pts = current.points;
        const from = Math.max(1, lastDrawnIndex);
        const partial: Stroke = {
          points: pts.slice(from - 1),
          width: current.width,
        };
        const ink = optsRef.current.inkColor;
        if (partial.points.length >= 2 || pts.length === 1) {
          drawStroke(ctx, pts.length === 1 ? current : partial, ink);
        }
        ctx.restore();
        lastDrawnIndex = pts.length;
      };

      const onPointerDown = (e: PointerEvent) => {
        if (activePointerId !== null) return; // single-stroke at a time
        e.preventDefault();
        fitCanvas();
        activePointerId = e.pointerId;
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch {
          /* noop — capture unsupported */
        }
        const rect = canvas.getBoundingClientRect();
        drawingRef.current = {
          points: [eventPoint(e, rect)],
          width: optsRef.current.strokeWidth,
        };
        lastDrawnIndex = 1;
        // Paint a dot immediately so taps register.
        const dpr = Math.min(3, window.devicePixelRatio || 1);
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawStroke(ctx, drawingRef.current, optsRef.current.inkColor);
        ctx.restore();
        emitChange();
      };

      const onPointerMove = (e: PointerEvent) => {
        if (e.pointerId !== activePointerId || !drawingRef.current) return;
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const events =
          typeof e.getCoalescedEvents === "function" && e.getCoalescedEvents().length > 0
            ? e.getCoalescedEvents()
            : [e];
        for (const ev of events) appendPoint(eventPoint(ev, rect));
      };

      const endStroke = (e: PointerEvent) => {
        if (e.pointerId !== activePointerId) return;
        activePointerId = null;
        const finished = drawingRef.current;
        drawingRef.current = null;
        if (finished && finished.points.length > 0) {
          strokesRef.current.push(finished);
        }
        emitChange();
      };

      const onPointerCancel = (e: PointerEvent) => {
        if (e.pointerId !== activePointerId) return;
        activePointerId = null;
        // Keep a cancelled stroke if it already has visible ink.
        const finished = drawingRef.current;
        drawingRef.current = null;
        if (finished && finished.points.length > 1) {
          strokesRef.current.push(finished);
        } else {
          redraw();
        }
        emitChange();
      };

      canvas.addEventListener("pointerdown", onPointerDown);
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerup", endStroke);
      canvas.addEventListener("pointercancel", onPointerCancel);
      return () => {
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerup", endStroke);
        canvas.removeEventListener("pointercancel", onPointerCancel);
      };
    }, [emitChange, fitCanvas, redraw]);

    return (
      <div ref={wrapRef} className="canvas-wrap">
        <canvas
          ref={canvasRef}
          className="canvas"
          role="img"
          aria-label="Signature drawing area. Click or touch and drag to draw your signature."
          aria-describedby="canvas-instructions"
        />
        <p id="canvas-instructions" className="sr-only">
          Use your mouse, trackpad, or finger to draw your signature in the
          area above. Use the Clear button to start over, Undo to remove the
          last stroke, and Download PNG to save with a transparent background.
        </p>
      </div>
    );
  },
);

export default SignatureCanvas;
