# Krystal Primitive Specification

This specification defines a **deterministic memory primitive** built from three components:

1. **KKS-1.0 (Kairos lattice + closure):** a deterministic mapping from an integer `pulse` into a daily lattice of
   `36 beats × 44 steps × 11 pulses = 17,424 grid-pulses/day`, while exactly closing the day at
   `17,491.270421 pulses/day`.

2. **KRL-1.0 (Krystal Resource Locators):** shareable locators for *moments* (stream payloads) and *artifacts*
   (content-addressed bytes), optionally carrying a compact time capsule.

3. **KRC-0 (Krystal Registry):** a minimal, append-only registry format: `{ "urls": [ ...KRL strings... ] }`.

A conforming implementation MUST implement KKS-1.0 and MUST be able to parse and verify KRC-0 registries.

---

## Design goals

- **Determinism:** independent implementations produce identical coordinates for the same `pulse`.
- **Offline verifiability:** ordering and coordinate derivation do not require server clocks or network time.
- **Tamper evidence:** artifacts are addressed by hash; a verifier can detect modification.
- **Portability:** an entire library can be carried as a single JSON artifact (registry) plus referenced objects.

---

## Terminology

- **pulse:** integer count of pulses since Genesis (Genesis pulse = 0).
- **μpulse:** one-millionth of a pulse. Used to represent the fractional day length exactly as an integer.
- **closure:** the requirement that a day ends exactly at `N_DAY_MU` μpulses.
- **lattice / grid:** the fixed 17,424-slot daily index space used for beats/steps.

---

## Normative language

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are to be interpreted as described in RFC 2119.

---

## Conformance

A verifier MUST be able to:

- Compute KKS coordinates from any non-negative integer pulse.
- Parse KRC-0 registries and decode KRL-1.0 locators.
- If a locator provides `(pulse, beat, stepIndex)` metadata, verify that it matches the KKS-derived coordinate.

