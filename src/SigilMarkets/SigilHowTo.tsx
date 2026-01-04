// SigilMarkets/SigilHowTo.tsx
"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "./ui/atoms/Button";
import { Divider } from "./ui/atoms/Divider";
import { Icon } from "./ui/atoms/Icon";
import { Sheet } from "./ui/atoms/Sheet";
import { decodeBoolean, loadFromStorage, saveToStorage, SM_HOWTO_DISMISSED_KEY } from "./state/persistence";

export const SigilHowTo = () => {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const carouselRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const toggleId = useId();

  useEffect(() => {
    const res = loadFromStorage(SM_HOWTO_DISMISSED_KEY, decodeBoolean);
    if (res.ok && res.value === true) {
      setDismissed(true);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => {
      closeRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setActiveStep(0);
    if (carouselRef.current) {
      carouselRef.current.scrollTo({ left: 0 });
    }
  }, [open]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  const showTrigger = useMemo(() => (hydrated ? !dismissed : true), [dismissed, hydrated]);

  const setDismissedPersisted = (next: boolean): void => {
    setDismissed(next);
    saveToStorage(SM_HOWTO_DISMISSED_KEY, next);
  };

  const close = (): void => setOpen(false);
const steps = useMemo(
  () => [
    {
      title: "What is a Sigil-Glyph?",
      body:
        "A Sigil-Glyph is a sovereign truth vessel — not an image, but a living seal.\n\nIt is self-contained. It carries, inside the file:\n- The claim you minted\n- The exact Kai-Klok pulse of sealing\n- Your ΦKey (breath-minted identity)\n- Your Kai Signature (authorship + intent)\n- A Zero-Knowledge proof (ZK) that proves validity and integrity without exposing private inputs\n\nThis is not “verified by a platform.” There is no central witness.\nThe vessel *is* the verification: decode it, check the signature, check the pulse, verify the proof.\n\nPortable. Peer-to-peer. Offline.\nA truth object that survives servers, survives accounts, survives empires — because it is sealed in breath and time.",
    },
    {
      title: "What is Verahai?",
      body:
        "Verahai is the sovereign prediction market — not a website you trust, but a protocol you carry.\n\nYou do not place a bet *into* a platform.\nYou mint a Position Sigil.\n\nThat Position Sigil is your YES/NO stance, sealed as a Sigil-Glyph:\n- bound to your ΦKey\n- stamped to a Kai-Klok pulse\n- signed by your Kai Signature\n- guarded by Zero-Knowledge validity proofs\n\nSo your position is not a database row.\nIt is a sovereign vessel.\nYou can share it anywhere, verify it anywhere, and redeem it without intermediaries — because the proof travels with the claim.",
      bullets: [
        "Inhale: Enter with your Identity Sigil (ΦKey + Kai Signature)",
        "Lock Φ: Escrow value in your Vault and mint a Position Sigil",
        "Carry: Share the Sigil-Glyph — it verifies itself, offline",
      ],
    },
    {
      title: "How settlement works (Kai-Klok × Φ Network)",
      body:
        "Kai-Klok governs time: markets open and close on harmonic pulse boundaries — deterministic, universal, unforgeable.\nΦ Network governs value + identity: Vaults, Sigils, and positions are bound to your ΦKey — ownership by breath, not by accounts.\n\nWhen the outcome is sealed, settlement becomes mechanical.\nA Resolution is minted at a precise pulse (YES / NO / VOID), with its own signature and evidence lineage.\nThen each Position Sigil proves what it is, proves when it was minted, proves who minted it, and proves it satisfies the settlement rules — with Zero-Knowledge proofs that reveal nothing but correctness.\n\nNo sync.\nNo platform custody.\nNo server as a judge.\nJust breath-sealed truth resolving at pulse.",
      bullets: [
        "Verify: Decode the vessel metadata, Kai Signature, and ZK proof",
        "Resolve: Outcome is sealed (YES / NO / VOID) precisely at pulse",
        "Claim: Valid Position Sigils unlock Φ from the Vault (ΦKey-bound)",
      ],
      note:
        "No accounts. No platforms. No trust assumptions.\nThe Sigil-Glyph *is* the position — a sovereign, self-verifying vessel of truth that can be carried, traded, and redeemed anywhere.",
    },
  ],
  [],
);




  const updateActiveStep = (): void => {
    if (!carouselRef.current) return;
    const el = carouselRef.current;
    const stepWidth = el.clientWidth;
    if (stepWidth <= 0) return;
    const nextIndex = Math.round(el.scrollLeft / stepWidth);
    setActiveStep(Math.max(0, Math.min(steps.length - 1, nextIndex)));
  };

  const onCarouselScroll = (): void => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = window.requestAnimationFrame(updateActiveStep);
  };

  const jumpTo = (index: number): void => {
    const el = carouselRef.current;
    if (!el) return;
    const target = Math.max(0, Math.min(steps.length - 1, index));
    el.scrollTo({ left: el.clientWidth * target, behavior: "smooth" });
    setActiveStep(target);
  };

  return (
    <>
      {showTrigger ? (
        <div className="vhHowToDock" aria-hidden={open}>
          <button
            type="button"
            className="vhHowToButton"
            onClick={() => setOpen(true)}
            aria-label="How to learn about Sigil-Glyphs"
          >
            <span className="vhHowToButtonLabel">How to</span>
            <Icon name="spark" size={12} tone="dim" className="vhHowToButtonIcon" />
          </button>
        </div>
      ) : null}

      <Sheet
        open={open}
        onClose={close}
        title="Sigil-Glyphs"
        subtitle="Portable proof you can share."
        className="vhHowToSheet"
        footer={
          <div className="vhHowToFooter">
            <Button ref={closeRef} variant="primary" size="md" onClick={close} aria-label="Close how to">
              Got it
            </Button>
          </div>
        }
      >
        <div className="vhHowToContent">
          <div className="vhHowToCarousel" ref={carouselRef} onScroll={onCarouselScroll}>
            {steps.map((step, index) => (
              <section key={step.title} className="vhHowToSlide" aria-label={`Step ${index + 1} of ${steps.length}`}>
                <div className="vhHowToSlideTop">
                  <span className="vhHowToStepBadge">Step {index + 1}</span>
                  <span className="vhHowToStepCount">
                    {index + 1} / {steps.length}
                  </span>
                </div>
                <h3>{step.title}</h3>
                {step.body ? <p>{step.body}</p> : null}
                {step.bullets ? (
                  <div className="vhHowToSteps">
                    <ul>
                      {step.bullets.map((bullet) => (
                        <li key={bullet}>{bullet}</li>
                      ))}
                    </ul>
                    {step.note ? <p className="vhHowToNote">{step.note}</p> : null}
                  </div>
                ) : null}
              </section>
            ))}
          </div>

          <div className="vhHowToDots" role="tablist" aria-label="How to steps">
            {steps.map((_, index) => (
              <button
                key={`dot-${index}`}
                type="button"
                className={`vhHowToDot ${index === activeStep ? "is-active" : ""}`}
                aria-label={`Go to step ${index + 1}`}
                aria-selected={index === activeStep}
                onClick={() => jumpTo(index)}
              />
            ))}
          </div>

          <Divider className="vhHowToDivider" />

          <label className="vhHowToToggle" htmlFor={toggleId}>
            <input
              id={toggleId}
              type="checkbox"
              checked={dismissed}
              onChange={(event) => setDismissedPersisted(event.target.checked)}
            />
            <span>Don’t show this again</span>
          </label>
        </div>
      </Sheet>
    </>
  );
};
