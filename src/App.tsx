import { useCallback, useEffect, useRef, useState } from "react";
import SignatureCanvas, {
  type SignatureCanvasHandle,
} from "./components/SignatureCanvas";

const LIGHT_INKS = [
  { name: "Black", value: "#111418" },
  { name: "Blue", value: "#1e3a8a" },
  { name: "Slate", value: "#4b5563" },
] as const;

const DARK_INKS = [
  { name: "White", value: "#ffffff" },
  { name: "Silver", value: "#c7ced6" },
  { name: "Sky", value: "#8ab4ff" },
] as const;

type Theme = "light" | "dark";

function initialTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

const WIDTHS = [
  { name: "Fine", value: 2 },
  { name: "Medium", value: 3.2 },
  { name: "Bold", value: 4.6 },
] as const;

export default function App() {
  const canvasHandle = useRef<SignatureCanvasHandle>(null);
  const toastTimer = useRef<number | null>(null);

  const [strokeWidth, setStrokeWidth] = useState<number>(WIDTHS[1].value);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const inks = theme === "dark" ? DARK_INKS : LIGHT_INKS;
  const [inkColor, setInkColor] = useState<string>(
    () =>
      (theme === "dark" ? DARK_INKS : LIGHT_INKS)[0].value,
  );
  const [isEmpty, setIsEmpty] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    return () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    };
  }, []);

  // Apply theme to the document, persist the choice, and keep the
  // browser chrome (theme-color) in sync.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try {
      window.localStorage.setItem("signature-theme", theme);
    } catch {
      /* private mode — theme just won't persist */
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute(
        "content",
        theme === "dark" ? "#0e1013" : "#fafafa",
      );
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    // Ink sets are per-theme so ink always stays visible on the canvas.
    // Ink is global, so existing strokes recolor live with it.
    setInkColor(
      next === "dark" ? DARK_INKS[0].value : LIGHT_INKS[0].value,
    );
  }, [theme]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  const handleCanvasChange = useCallback(
    (state: { isEmpty: boolean; strokes: number }) => {
      setIsEmpty(state.isEmpty);
      if (!state.isEmpty) setHint(null);
    },
    [],
  );

  const handleDownloaded = useCallback(() => {
    setIsBusy(false);
    showToast("Signature downloaded");
  }, [showToast]);

  const handleDownloadError = useCallback((message: string) => {
    setIsBusy(false);
    setHint(message);
  }, []);

  const handleDownload = useCallback(async () => {
    if (isBusy) return;
    setIsBusy(true);
    const ok = await canvasHandle.current?.download();
    // Success path resets busy via onDownloaded; failure via onDownloadError.
    // Guard in case callbacks don't fire.
    if (!ok) setIsBusy(false);
  }, [isBusy]);

  const handleDownloadFormat = useCallback(
    async (format: "jpg" | "svg") => {
      if (isBusy) return;
      setIsBusy(true);
      const ok =
        format === "jpg"
          ? await canvasHandle.current?.downloadJpg()
          : await canvasHandle.current?.downloadSvg();
      if (!ok) setIsBusy(false);
    },
    [isBusy],
  );

  // Keyboard shortcut: Cmd/Ctrl+Z to undo the last stroke.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (typing) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        canvasHandle.current?.undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="page">
      <header className="site-header">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 32 32" fill="none">
              <path
                d="M6 24c6 .4 12.5-2.1 16.5-8.6l2.6-4.3c.5-.9-.1-2-1.2-2.1-.4 0-.8.1-1 .5L20.6 12"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="6.4" cy="24.4" r="1.8" fill="currentColor" />
            </svg>
          </span>
          <div className="brand-text">
            <h1>Signature</h1>
            <p>Draw. Sign. Download.</p>
          </div>
        </div>
        <button
          type="button"
          className="theme-toggle"
          onClick={toggleTheme}
          aria-label={
            theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
          }
          aria-pressed={theme === "dark"}
          title={theme === "dark" ? "Light mode" : "Dark mode"}
        >
          {theme === "dark" ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="8" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.5" />
              <path
                d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M13.5 9.3A5.8 5.8 0 0 1 6.7 2.5a5.8 5.8 0 1 0 6.8 6.8Z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>
      </header>

      <main className="main">
        <section className="card" aria-label="Signature creator">
          <div className="card-top">
            <div className="ink-group" role="group" aria-label="Ink color">
              {inks.map((ink) => (
                <button
                  key={ink.value}
                  type="button"
                  className={`ink-dot${inkColor === ink.value ? " is-active" : ""}`}
                  style={{ ["--ink" as string]: ink.value }}
                  aria-label={`Ink color: ${ink.name}`}
                  aria-pressed={inkColor === ink.value}
                  title={ink.name}
                  onClick={() => setInkColor(ink.value)}
                />
              ))}
            </div>
            <div
              className="width-group"
              role="group"
              aria-label="Stroke width"
            >
              {WIDTHS.map((w) => (
                <button
                  key={w.name}
                  type="button"
                  className={`width-btn${strokeWidth === w.value ? " is-active" : ""}`}
                  aria-pressed={strokeWidth === w.value}
                  onClick={() => setStrokeWidth(w.value)}
                >
                  {w.name}
                </button>
              ))}
            </div>
          </div>

          <div className="canvas-holder">
            <SignatureCanvas
              ref={canvasHandle}
              strokeWidth={strokeWidth}
              inkColor={inkColor}
              onChange={handleCanvasChange}
              onDownloaded={handleDownloaded}
              onDownloadError={handleDownloadError}
            />
            {isEmpty && (
              <div className="placeholder" aria-hidden="true">
                Draw your signature here
              </div>
            )}
          </div>

          <div className="card-bottom">
            <div className="left-actions">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={isEmpty}
                aria-label="Undo last stroke"
                title="Undo last stroke (Ctrl+Z)"
                onClick={() => canvasHandle.current?.undo()}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path
                    d="M6.5 3.5 3 7l3.5 3.5M3.2 7H10a3.5 3.5 0 0 1 0 7H8"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Undo
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={isEmpty}
                aria-label="Clear signature"
                onClick={() => canvasHandle.current?.clear()}
              >
                Clear
              </button>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={isEmpty || isBusy}
              aria-label="Download signature as transparent PNG"
              onClick={handleDownload}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M8 2v8.2M4.8 7.4 8 10.6l3.2-3.2M2.5 12.5v1a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-1"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {isBusy ? "Preparing…" : "Download PNG"}
            </button>
            <div className="format-row" role="group" aria-label="Other download formats">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={isEmpty || isBusy}
                onClick={() => handleDownloadFormat("jpg")}
              >
                JPG
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={isEmpty || isBusy}
                onClick={() => handleDownloadFormat("svg")}
              >
                SVG
              </button>
            </div>
          </div>

          {hint && (
            <p className="hint" role="alert">
              {hint}
            </p>
          )}
        </section>

        <ol className="steps" aria-label="How it works">
          <li>
            <span className="step-n" aria-hidden="true">1</span> Draw
          </li>
          <li aria-hidden="true" className="step-sep">→</li>
          <li>
            <span className="step-n" aria-hidden="true">2</span> Refine
          </li>
          <li aria-hidden="true" className="step-sep">→</li>
          <li>
            <span className="step-n" aria-hidden="true">3</span> Download PNG
          </li>
        </ol>

        <p className="privacy">
          Private by design — your signature never leaves this browser.
          Exports as a transparent PNG, cropped to your strokes.
          Dark mode gives you white ink for dark documents.
        </p>
      </main>

      <footer className="site-footer">
        <p>Transparent PNG · No account · No uploads</p>
        <a
          href="https://dynamic-aayush38.netlify.app"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Aayush Neupane — portfolio"
          className="dev-credit"
        >
          <img
            src="/logotrp.png"
            alt="Aayush Neupane"
            width={28}
            height={28}
            draggable={false}
            className="dev-credit-logo"
          />
          <span>
            Developed by <span className="dev-credit-name">Aayush Neupane</span>
          </span>
        </a>
      </footer>

      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="m3 8.5 3.2 3.2L13 5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {toast}
        </div>
      )}
    </div>
  );
}
