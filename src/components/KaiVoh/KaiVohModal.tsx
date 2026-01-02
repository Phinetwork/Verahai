// src/components/KaiVoh/KaiVohModal.tsx
"use client";

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import "./styles/KaiVohModal.css";
import KaiVohBoundary from "./KaiVohBoundary";
import { SigilAuthProvider } from "./SigilAuthProvider";
import { useSigilAuth } from "./useSigilAuth";
import { clearSessionStorage } from "../session/sessionStorage";

/** Lazy chunks */
const KaiVohApp = lazy(() => import("./KaiVohApp"));
const KaiRealmsApp = lazy(() => import("../KaiRealms")); // default export with optional onClose

type ViewMode = "voh" | "realms";

interface KaiVohModalProps {
  open: boolean;
  onClose: () => void;
}

/** Golden constants for inline SVG ratios (used by CSS too) */
const PHI = (1 + Math.sqrt(5)) / 2;
const BREATH_SEC = 5.236;

/** Hoisted (no nested components in render) */
const SPIRAL_W = 610;
const SPIRAL_H = 377;

function SpiralSVG({ className }: { className?: string }) {
  const gradientId = useId();
  return (
    <svg
      className={className}
      width={SPIRAL_W}
      height={SPIRAL_H}
      viewBox={`0 0 ${SPIRAL_W} ${SPIRAL_H}`}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.0" />
          <stop offset="40%" stopColor="currentColor" stopOpacity="0.5" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <g fill="none" stroke={`url(#${gradientId})`} strokeWidth="2">
        <path d="M377 0 A377 377 0 0 1 0 377" />
        <path d="M233 0 A233 233 0 0 1 0 233" />
        <path d="M144 0 A144 144 0 0 1 0 144" />
        <path d="M89 0 A89 89 0 0 1 0 89" />
        <path d="M55 0 A55 55 0 0 1 0 55" />
        <path d="M34 0 A34 34 0 0 1 0 34" />
        <path d="M21 0 A21 21 0 0 1 0 21" />
      </g>
    </svg>
  );
}

function SealEmblem({ className }: { className?: string }) {
  return (
    <div className={`seal-emblem ${className ?? ""}`} aria-hidden="true">
      <div className="seal-ring seal-ring--outer" />
      <div className="seal-ring seal-ring--inner" />
      <div className="seal-core" />
    </div>
  );
}

/** Uses SigilAuth context so the import is real + useful (fixes unused-vars). */
function SigilAuthPill({ className }: { className?: string }) {
  const { auth } = useSigilAuth();
  const meta = auth.meta;
  if (!meta) return null;

  const titleParts: string[] = [
    `Pulse: ${meta.pulse}`,
    `Beat: ${meta.beat}`,
    `Step: ${meta.stepIndex}`,
    `Day: ${meta.chakraDay}`,
  ];
  if (meta.sigilId) titleParts.push(`Sigil: ${meta.sigilId}`);
  if (meta.userPhiKey) titleParts.push(`PhiKey: ${meta.userPhiKey}`);

  return (
    <div
      className={`sigil-auth-pill ${className ?? ""}`}
      role="status"
      aria-live="polite"
      title={titleParts.join(" • ")}
      style={{
        maxWidth: "100%",
        overflowX: "auto",
        whiteSpace: "nowrap",
      }}
    >
      <span className="sigil-auth-pill__dot" aria-hidden="true" />
      <span className="sigil-auth-pill__text mono">
        Sealed • {meta.pulse} • {meta.chakraDay}
        {meta.sigilId ? ` • ${meta.sigilId}` : ""}
      </span>
    </div>
  );
}

/**
 * Focus helpers (no libs, no nested components).
 * Keeps Tab inside the modal, preventing “focus escape” which can cause iOS/Safari weird scroll jumps.
 */
function getFocusable(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  const nodes = Array.from(
    container.querySelectorAll<HTMLElement>(
      [
        "a[href]",
        "button:not([disabled])",
        "input:not([disabled])",
        "select:not([disabled])",
        "textarea:not([disabled])",
        "[tabindex]:not([tabindex='-1'])",
      ].join(",")
    )
  );
  return nodes.filter((el) => !el.hasAttribute("disabled") && !el.getAttribute("aria-hidden"));
}

function isEditableElement(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLInputElement) return !el.disabled;
  if (el instanceof HTMLTextAreaElement) return !el.disabled;
  if (el instanceof HTMLSelectElement) return !el.disabled;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  return false;
}

function shouldSuppressEnter(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return false;
  if (el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) {
    const type = el.type.toLowerCase();
    return !["button", "submit", "reset", "checkbox", "radio", "file", "range", "color"].includes(type);
  }
  return false;
}

export default function KaiVohModal({ open, onClose }: KaiVohModalProps) {
  const handleClose = useCallback((): void => {
    clearSessionStorage();
    onClose();
  }, [onClose]);

  // Hooks MUST run unconditionally (rules-of-hooks)
  const rootRef = useRef<HTMLDivElement | null>(null);
  const firstFocusableRef = useRef<HTMLButtonElement | null>(null);
  const scrollRegionRef = useRef<HTMLDivElement | null>(null);

  const touchStartYRef = useRef<number>(0);
  const lockedScrollYRef = useRef<number>(0);

  const [view, setView] = useState<ViewMode>("voh");
  const [realmsMounted, setRealmsMounted] = useState(false);

  const switchTo = useCallback(
    (next: ViewMode): void => {
      if (next === "realms" && !realmsMounted) setRealmsMounted(true);
      setView(next);
    },
    [realmsMounted]
  );

  const viewportVars = useMemo(() => {
    return {
      breath: `${BREATH_SEC}s`,
      phi: `${PHI}`,
    };
  }, []);

  /**
   * HARDENED MODAL LOCK (prevents reload / pull-to-refresh / overscroll glitches)
   * - Locks page scroll using body:position:fixed (stronger than overflow hidden on iOS PWAs).
   * - Prevents any touchmove/wheel outside the modal scroll region.
   * - Prevents overscroll bounce at bounds INSIDE the modal scroll region (iOS pull-to-refresh trigger).
   * - Adds Escape-to-close + Tab focus trap (avoids focus escape → accidental page scroll).
   * - Sets global CSS vars for breath/phi + an innerHeight var for stable layout.
   */
  useEffect(() => {
    if (!open) return;

    // Save prior styles (restore exactly)
    const prev = {
      bodyOverflow: document.body.style.overflow,
      bodyPosition: document.body.style.position,
      bodyTop: document.body.style.top,
      bodyLeft: document.body.style.left,
      bodyRight: document.body.style.right,
      bodyWidth: document.body.style.width,
      bodyHeight: document.body.style.height,
      htmlOverflow: document.documentElement.style.overflow,
      htmlHeight: document.documentElement.style.height,
      docOverscroll: document.documentElement.style.getPropertyValue("overscroll-behavior"),
      bodyOverscroll: document.body.style.getPropertyValue("overscroll-behavior"),
      touchAction: document.documentElement.style.touchAction,
      breath: document.documentElement.style.getPropertyValue("--kai-breath"),
      phi: document.documentElement.style.getPropertyValue("--kai-phi"),
      kaiVh: document.documentElement.style.getPropertyValue("--kai-vh"),
    };

    // Lock scroll (strong iOS-safe pattern)
    lockedScrollYRef.current = window.scrollY || window.pageYOffset || 0;
    document.body.style.position = "fixed";
    document.body.style.top = `-${lockedScrollYRef.current}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    document.body.style.height = "100%";
    document.body.style.overflow = "hidden";

    document.documentElement.style.overflow = "hidden";
    document.documentElement.style.height = "100%";

    // Global overscroll kill (desktop + Android); iOS still needs touchmove gate below.
    document.documentElement.style.setProperty("overscroll-behavior", "none");
    document.body.style.setProperty("overscroll-behavior", "none");

    // Avoid double-tap zoom / weird pan interactions outside our scroll region
    document.documentElement.style.touchAction = "manipulation";

    // CSS vars for timing/phi
    document.documentElement.style.setProperty("--kai-breath", viewportVars.breath);
    document.documentElement.style.setProperty("--kai-phi", viewportVars.phi);

    // Stable viewport var (helps iOS address-bar / orientation “jump”)
    const syncVh = (): void => {
      document.documentElement.style.setProperty("--kai-vh", `${window.innerHeight}px`);
    };
    syncVh();
    window.addEventListener("resize", syncVh, { passive: true });

    // Make the scroll region itself “contain” overscroll (best-effort; iOS still needs touch gate)
    const scrollEl = scrollRegionRef.current;
    if (scrollEl) {

      scrollEl.style.overscrollBehavior = "contain";
      // iOS momentum scrolling (smooth)
      // @ts-expect-error: webkitOverflowScrolling not in standard types.
      scrollEl.style.webkitOverflowScrolling = "touch";
    }

    // Focus first interactive (if present)
    firstFocusableRef.current?.focus();

    // Touch gating (iOS pull-to-refresh prevention)
    const onTouchStart = (e: TouchEvent): void => {
      touchStartYRef.current = e.touches[0]?.clientY ?? 0;
    };

    const onTouchMove = (e: TouchEvent): void => {
      if (e.touches.length !== 1) return;

      const s = scrollRegionRef.current;
      if (!s) {
        e.preventDefault();
        return;
      }

      const target = e.target as Node | null;
      const insideScrollRegion = target ? s.contains(target) : false;

      // Never allow swipe gestures outside the modal scroll region.
      if (!insideScrollRegion) {
        e.preventDefault();
        return;
      }

      const currentY = e.touches[0]?.clientY ?? touchStartYRef.current;
      const deltaY = currentY - touchStartYRef.current;

      const atTop = s.scrollTop <= 0;
      const atBottom = s.scrollTop + s.clientHeight >= s.scrollHeight - 1;

      // Prevent the native rubber-band at the bounds (pull-to-refresh trigger in PWAs)
      if ((atTop && deltaY > 0) || (atBottom && deltaY < 0)) {
        e.preventDefault();
      }
    };

    // Wheel gating (trackpads can “overscroll” background under fixed body in some browsers)
    const onWheel = (e: WheelEvent): void => {
      const s = scrollRegionRef.current;
      if (!s) {
        e.preventDefault();
        return;
      }

      const target = e.target as Node | null;
      const insideScrollRegion = target ? s.contains(target) : false;

      if (!insideScrollRegion) {
        e.preventDefault();
        return;
      }

      const dy = e.deltaY;
      const atTop = s.scrollTop <= 0;
      const atBottom = s.scrollTop + s.clientHeight >= s.scrollHeight - 1;

      if ((atTop && dy < 0) || (atBottom && dy > 0)) {
        e.preventDefault();
      }
    };

    // Escape + focus trap
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        if (isEditableElement(document.activeElement)) return;
        e.preventDefault();
        e.stopPropagation();
        handleClose();
        return;
      }

      if (e.key === "Enter") {
        const target = e.target as Element | null;
        if (shouldSuppressEnter(target) && rootRef.current?.contains(target)) {
          e.preventDefault();
        }
      }

      if (e.key !== "Tab") return;

      const root = rootRef.current;
      const focusables = getFocusable(root);
      if (focusables.length === 0) return;

      const active = document.activeElement as HTMLElement | null;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;

      if (!active || !root?.contains(active)) {
        e.preventDefault();
        first.focus();
        return;
      }

      if (e.shiftKey) {
        if (active === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    // Abortable listeners (clean, reliable)
    const ac = new AbortController();
    const optTouchStart: AddEventListenerOptions = { passive: true, signal: ac.signal, capture: true };
    const optTouchMove: AddEventListenerOptions = { passive: false, signal: ac.signal, capture: true };
    const optWheel: AddEventListenerOptions = { passive: false, signal: ac.signal, capture: true };
    const optKey: AddEventListenerOptions = { signal: ac.signal, capture: true };

    document.addEventListener("touchstart", onTouchStart, optTouchStart);
    document.addEventListener("touchmove", onTouchMove, optTouchMove);
    document.addEventListener("wheel", onWheel, optWheel);
    document.addEventListener("keydown", onKeyDown, optKey);

    // Optional: block iOS gesture events that can cause zoom/scroll jumps
    const onGesture = (ev: Event): void => {
      ev.preventDefault();
    };
    document.addEventListener("gesturestart", onGesture, { passive: false, signal: ac.signal } as AddEventListenerOptions);
    document.addEventListener("gesturechange", onGesture, {
      passive: false,
      signal: ac.signal,
    } as AddEventListenerOptions);
    document.addEventListener("gestureend", onGesture, { passive: false, signal: ac.signal } as AddEventListenerOptions);

    const onSubmit = (e: Event): void => {
      const target = e.target as Element | null;
      if (target && rootRef.current?.contains(target)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("submit", onSubmit, { capture: true, signal: ac.signal } as AddEventListenerOptions);

    return () => {
      // Remove listeners
      ac.abort();
      window.removeEventListener("resize", syncVh);

      // Restore global styles/vars
      document.body.style.overflow = prev.bodyOverflow;
      document.body.style.position = prev.bodyPosition;
      document.body.style.top = prev.bodyTop;
      document.body.style.left = prev.bodyLeft;
      document.body.style.right = prev.bodyRight;
      document.body.style.width = prev.bodyWidth;
      document.body.style.height = prev.bodyHeight;

      document.documentElement.style.overflow = prev.htmlOverflow;
      document.documentElement.style.height = prev.htmlHeight;

      if (prev.docOverscroll) document.documentElement.style.setProperty("overscroll-behavior", prev.docOverscroll);
      else document.documentElement.style.removeProperty("overscroll-behavior");

      if (prev.bodyOverscroll) document.body.style.setProperty("overscroll-behavior", prev.bodyOverscroll);
      else document.body.style.removeProperty("overscroll-behavior");

      document.documentElement.style.touchAction = prev.touchAction;

      if (prev.breath) document.documentElement.style.setProperty("--kai-breath", prev.breath);
      else document.documentElement.style.removeProperty("--kai-breath");

      if (prev.phi) document.documentElement.style.setProperty("--kai-phi", prev.phi);
      else document.documentElement.style.removeProperty("--kai-phi");

      if (prev.kaiVh) document.documentElement.style.setProperty("--kai-vh", prev.kaiVh);
      else document.documentElement.style.removeProperty("--kai-vh");

      // Restore scroll position after unlocking fixed body
      const y = lockedScrollYRef.current || 0;
      window.scrollTo(0, y);
    };
  }, [open, handleClose, viewportVars.breath, viewportVars.phi]);

  // Close button handlers
  const handleClosePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>): void => {
      e.stopPropagation();
      handleClose();
    },
    [handleClose]
  );

  const handleCloseKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLButtonElement>): void => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        handleClose();
      }
    },
    [handleClose]
  );

  // After hooks are declared, it's safe to early-return
  if (!open) return null;

  const node = (
    <div
      ref={rootRef}
      className="kai-voh-modal-backdrop atlantean-veil"
      role="dialog"
      aria-modal="true"
      aria-labelledby="kaivoh-title"
      data-view={view}
    >
      {/* Dim stars + parallax halos */}
      <div className="atlantean-stars" aria-hidden="true" />
      <div className="atlantean-halo atlantean-halo--1" aria-hidden="true" />
      <div className="atlantean-halo atlantean-halo--2" aria-hidden="true" />

      <div className="kai-voh-container kai-pulse-border glass-omni" role="document">
        {/* Sacred border rings + phi grid */}
        <div className="breath-ring breath-ring--outer" aria-hidden="true" />
        <div className="breath-ring breath-ring--inner" aria-hidden="true" />
        <div className="phi-grid" aria-hidden="true" />

        {/* Corner spirals */}
        <SpiralSVG className="phi-spiral phi-spiral--tl" />
        <SpiralSVG className="phi-spiral phi-spiral--br" />

        <SigilAuthProvider>
          {/* Close (hidden while in Realms to avoid double-X on mobile) */}
          {view !== "realms" && (
            <button
              ref={firstFocusableRef}
              type="button"
              className="kai-voh-close auric-btn"
              aria-label="Close portal"
              onPointerDown={handleClosePointerDown}
              onKeyDown={handleCloseKeyDown}
            >
              <X size={22} aria-hidden="true" />
            </button>
          )}

          {/* Top-center orb (hide in Realms to avoid double orb) */}
          {view !== "realms" && (
            <div className="voh-top-orb" aria-hidden="true">
              <SealEmblem />
            </div>
          )}

          {/* Tab bar */}
          <div className="kai-voh-tabbar" role="tablist" aria-label="Kai portal views">
            <button
              type="button"
              role="tab"
              aria-selected={view === "voh"}
              className={`kai-voh-tab auric-tab ${view === "voh" ? "active" : ""}`}
              onClick={() => switchTo("voh")}
            >
              <span className="tab-glyph" aria-hidden="true">
                🜂
              </span>{" "}
              Voh
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={view === "realms"}
              className={`kai-voh-tab auric-tab ${view === "realms" ? "active" : ""}`}
              onClick={() => switchTo("realms")}
            >
              <span className="tab-glyph" aria-hidden="true">
                ⚚
              </span>{" "}
              Realms
            </button>

            {/* Breath progress (phi-timed) */}
            <div className="breath-meter" aria-hidden="true">
              <div className="breath-meter__dot" />
            </div>

            {/* Optional auth indicator (uses hook, no truncation; scrolls if long) */}
            <SigilAuthPill className="sigil-auth-pill--tabbar" />
          </div>

          {/* Body */}
          <div className="kai-voh-body" ref={scrollRegionRef}>
            <h2 id="kaivoh-title" className="sr-only">
              Kai Portal
            </h2>

            <KaiVohBoundary>
              <section
                className="portal-pane portal-pane--voh"
                style={{ display: view === "voh" ? "block" : "none" }}
                aria-hidden={view !== "voh"}
              >
                <Suspense
                  fallback={
                    <div className="kai-voh-center">
                      <div className="kai-voh-spinner" />
                      <div>Summoning Voh…</div>
                    </div>
                  }
                >
                  <KaiVohApp />
                </Suspense>
              </section>

              <section
                className="portal-pane portal-pane--realms"
                style={{ display: view === "realms" ? "block" : "none" }}
                aria-hidden={view !== "realms"}
              >
                {realmsMounted ? (
                  <Suspense
                    fallback={
                      <div className="kai-voh-center">
                        <div className="kai-voh-spinner" />
                        <div>Opening Kai Realms…</div>
                      </div>
                    }
                  >
                    <KaiRealmsApp onClose={() => switchTo("voh")} />
                  </Suspense>
                ) : null}
              </section>
            </KaiVohBoundary>
          </div>
        </SigilAuthProvider>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
