// SigilMarkets/SigilHowTo.tsx
"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "./ui/atoms/Button";
import { Divider } from "./ui/atoms/Divider";
import { Icon } from "./ui/atoms/Icon";
import { Sheet } from "./ui/atoms/Sheet";
import { decodeBoolean, loadFromStorage, saveToStorage, SM_HOWTO_DISMISSED_KEY } from "./state/persistence";
import { useSigilMarketsUi } from "./state/uiStore";
import { useActiveVault } from "./state/vaultStore";

// NOTE: this is your current path. Keep it exactly as you wrote it.
import SigilModal from "../components/SigilModal";

type HowToAction = Readonly<{
  label: string;
  hint?: string;
  onClick: () => void;
}>;

type HowToStep = Readonly<{
  title: string;
  body?: string;
  bullets?: readonly string[];
  note?: string;
  action?: HowToAction;
}>;

export const SigilHowTo = () => {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [activeStep, setActiveStep] = useState(0);

  const { actions: ui } = useSigilMarketsUi();
  const activeVault = useActiveVault();

  // Step 1 action opens SigilModal (mint window)
  const [sigilModalOpen, setSigilModalOpen] = useState(false);

  // When SigilModal closes, resume HowTo on Step 2 so the user never gets lost.
  const resumeStepRef = useRef<number | null>(null);

  const closeRef = useRef<HTMLButtonElement | null>(null);
  const carouselRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const toggleId = useId();

  useEffect(() => {
    const res = loadFromStorage(SM_HOWTO_DISMISSED_KEY, decodeBoolean);
    if (res.ok && res.value === true) setDismissed(true);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => closeRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  // When sheet opens, go to resumed step if we have one (otherwise Step 1).
  useEffect(() => {
    if (!open) return;

    const resume = resumeStepRef.current;
    resumeStepRef.current = null;

    const idx = resume ?? 0;
    setActiveStep(idx);

    const id = window.requestAnimationFrame(() => {
      const el = carouselRef.current;
      if (!el) return;
      el.scrollTo({ left: el.clientWidth * idx, behavior: "auto" });
    });

    return () => window.cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const showTrigger = useMemo(() => (hydrated ? !dismissed : true), [dismissed, hydrated]);

  const setDismissedPersisted = (next: boolean): void => {
    setDismissed(next);
    saveToStorage(SM_HOWTO_DISMISSED_KEY, next);
  };

  const close = (): void => setOpen(false);

  // Step 1 CTA: open SigilModal, then return user to step 2 automatically.
  const openSigilMintFromStep1 = (): void => {
    // Close HowTo so the user sees ONE clear action.
    setOpen(false);

    // When SigilModal closes, bring them back to Step 2 (index 1).
    resumeStepRef.current = 1;

    setSigilModalOpen(true);
  };

  const onSigilModalClose = (): void => {
    setSigilModalOpen(false);

    // Reopen HowTo at Step 2 (index 1) to continue the guided flow.
    resumeStepRef.current = 1;
    setOpen(true);
  };

  const openInhaleFromStep2 = useCallback((): void => {
    setOpen(false);
    if (activeVault) {
      ui.navigate({ view: "vault", vaultId: activeVault.vaultId });
      ui.pushSheet({ id: "deposit-withdraw", vaultId: activeVault.vaultId, mode: "deposit" });
      return;
    }
    ui.pushSheet({ id: "inhale-glyph", reason: "auth" });
  }, [activeVault, ui]);

  const step2Action = useMemo<HowToAction>(
    () =>
      activeVault
        ? {
            label: "Deposit to Vault",
            hint: "You are already logged in — add a deposit now.",
            onClick: openInhaleFromStep2,
          }
        : {
            label: "Inhale + Activate Vault",
            hint: "Upload your Sigil-Glyph and optionally add your first deposit in the same step.",
            onClick: openInhaleFromStep2,
          },
    [activeVault, openInhaleFromStep2],
  );

  const steps: readonly HowToStep[] = useMemo(
    () => [
      {
        title: "Mint your Sigil-Glyph (this is your login + value + memory)",
        body:
          "A Sigil-Glyph is not “an image.” It is a proof-file you carry.\n\nIt functions as three things at once:\n\n1) LOGIN (Identity)\n   Your ΦKey + Kai Signature are sealed into the file.\n   You don’t “sign into an account.” You present proof.\n\n2) VALUE (Money)\n   Φ can be locked/unlocked by rules and resolved by proof.\n   The position/claim is not a database row — it’s a redeemable vessel.\n\n3) MEMORY (Receipts)\n   Every seal carries its Kai-Klok pulse (deterministic time) and integrity proof.\n   Anyone can verify it offline. No platform. No permission.\n\nTap the button below to open the Sigil mint window and create your first proof-file.",
        bullets: [
          "Tap “Open Sigil Mint” now.",
          "Export as SVG (or SVG+PNG).",
          "Save the file — that file IS your login and your proof.",
        ],
        note:
          "This is superior to passwords, accounts, and custodians because the verification lives inside the file. If you have the file, you have the proof. When you close the mint window, you’ll return here automatically to Step 2.",
        action: {
          label: "Open Sigil Mint",
          hint: "Opens Kairos Sigil-Glyph Inhaler (mint + export). Save the SVG — you will use it to Inhale (log in).",
          onClick: openSigilMintFromStep1,
        },
      },
      {
        title: "How to log in (Inhale) with a Sigil-Glyph",
        body:
          "Logging in with Verahai is not a username/password.\n\nYou Inhale with your Sigil-Glyph:\n\n1) Tap Inhale / Login\n2) Upload or select the Sigil-Glyph file you saved\n3) Verahai verifies locally:\n   - decodes the embedded metadata\n   - checks your Kai Signature against your ΦKey\n   - checks the Kai-Klok pulse stamp\n   - verifies ZK integrity proofs (when present)\n4) (Optional) Enter a first deposit amount and tap Activate — your Vault is funded instantly\n\nIf valid, you are in.\n\nNo password to steal.\nNo account to delete.\nNo platform permission.\nJust proof.",
        bullets: [
          "Inhale: Present your Sigil-Glyph file (your ΦKey + Kai Signature).",
          "Verify: Local, offline-capable verification of signature + pulse + ZK.",
          "Deposit (optional): Enter an amount before Activate to fund your Vault in the same step.",
          "Enter: Your Vault + positions are now bound to the same ΦKey proof lineage.",
          "Access Vault: Tap “Vault” in the bottom nav after login to deposit, withdraw, or view balances.",
        ],
        action: step2Action,
        note:
          "Bridge to what you already know: this is like “Sign in with Apple,” but instead of Apple being the gatekeeper, the file is the credential and verification is self-contained. You carry your login. You carry your receipts. You carry your value.",
      },
      {
        title: "What is Verahai?",
        body:
          "Verahai is the sovereign prediction market — not a website you trust, but a protocol you carry.\n\nYou do not place a bet into a platform.\nYou mint a Position Sigil.\n\nThat Position Sigil is your YES/NO stance, sealed as a Sigil-Glyph:\n- bound to your ΦKey\n- stamped to a Kai-Klok pulse\n- signed by your Kai Signature\n- guarded by Zero-Knowledge validity proofs\n\nSo your position is not a database row.\nIt is a sovereign vessel.\nYou can share it anywhere, verify it anywhere, and redeem it without intermediaries — because the proof travels with the claim.",
        bullets: [
          "Inhale: Enter with your Identity Sigil (ΦKey + Kai Signature).",
          "Lock Φ: Escrow value in your Vault and mint a Position Sigil.",
          "Carry: Share the Sigil-Glyph — it verifies itself, offline.",
        ],
        note:
          "The simple truth: Verahai turns “claims” into portable proof-objects, and turns “settlement” into verification — not platform trust.",
      },
      {
        title: "How settlement works (Kai-Klok × Φ Network)",
        body:
          "Kai-Klok governs time: markets open and close on pulse boundaries — deterministic, universal, unforgeable.\n\nΦ Network governs value + identity: Vaults, Sigils, and positions are bound to your ΦKey — ownership by breath, not by accounts.\n\nWhen the outcome is sealed, settlement becomes mechanical.\nA Resolution is minted at a precise pulse (YES / NO / VOID), with its own signature and evidence lineage.\nThen each Position Sigil proves what it is, proves when it was minted, proves who minted it, and proves it satisfies the settlement rules — with Zero-Knowledge proofs that reveal nothing but correctness.\n\nNo sync.\nNo platform custody.\nNo server as judge.\nJust truth resolving at pulse.",
        bullets: [
          "Verify: Decode the vessel metadata, Kai Signature, and ZK proof.",
          "Resolve: Outcome is sealed (YES / NO / VOID) precisely at pulse.",
          "Claim: Valid Position Sigils unlock Φ from the Vault (ΦKey-bound).",
        ],
        note:
          "No accounts. No platforms. No trust assumptions.\nThe Sigil-Glyph IS the position — a sovereign, self-verifying vessel of truth that can be carried, traded, and redeemed anywhere.",
      },
    ],
    [step2Action],
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
    if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
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
            aria-label="How to learn about Vérahai"
          >
            <span className="vhHowToButtonLabel">How to</span>
            <Icon name="spark" size={12} tone="dim" className="vhHowToButtonIcon" />
          </button>
        </div>
      ) : null}

      <Sheet
        open={open}
        onClose={close}
        title="Vérahai"
        subtitle="Breath, sealed as law."
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

                {step.body ? <p className="vhHowToBody">{step.body}</p> : null}

                {step.bullets ? (
                  <div className="vhHowToSteps">
                    <ul>
                      {step.bullets.map((bullet) => (
                        <li key={bullet}>{bullet}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {step.action ? (
                  <div className="vhHowToCta">
                    <Button variant="primary" size="md" onClick={step.action.onClick} aria-label={step.action.label}>
                      {step.action.label}
                    </Button>
                    {step.action.hint ? <p className="vhHowToCtaHint">{step.action.hint}</p> : null}
                  </div>
                ) : null}

                {step.note ? <p className="vhHowToNote">{step.note}</p> : null}
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

      {/* Step 1 opens SigilModal directly */}
      {sigilModalOpen ? <SigilModal onClose={onSigilModalClose} /> : null}
    </>
  );
};
