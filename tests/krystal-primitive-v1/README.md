# Krystal Primitive v1

This repository contains a **complete, deterministic, testable specification** and **reference implementation** for a *Deterministic Memory Crystal*:

- **Deterministic time coordinates** derived from **KKS-1.0** (Kairos lattice/closure math).
- **Content-addressed artifacts** (hash-addressed objects).
- **Append-only registries** (portable, offline “memory crystals”).
- **Verifiers + test vectors** so independent implementations can prove they agree.

## What makes it an "undeniable primitive"

A system is a primitive when *anyone* can independently verify its invariants from the bytes alone.

Krystal is built around four invariants:

1. **KKS determinism:** `pulse -> (dayIndex, beat, stepIndex, pulseInStep)` is pure integer math.
2. **Closure:** day mapping is exact using `N_DAY_MU = 17,491,270,421 μpulses/day`.
3. **Canonical bytes:** objects have one canonical byte representation for hashing.
4. **Append-only registry:** history is extended by appending entries; never by rewriting.

## Layout

- `spec/` — normative specification (MUST/SHOULD language)
- `schemas/` — JSON Schemas for core formats
- `reference/python/` — reference implementation + CLI + tests
- `test-vectors/` — conformance vectors (KKS + URL encodings)
- `examples/` — sample registries:
  - `sigil-registry.json` (as received)
  - `sigil-registry-normalized.json` (capsules corrected to match KKS-1.0)

## Quick start (Python)

```bash
cd reference/python
python -m venv .venv
source .venv/bin/activate
pip install -e .
pip install -r requirements-dev.txt
krystal --help
```

Compute beat/step for a pulse:

```bash
krystal kks 9777777
```

Verify a registry file:

```bash
krystal verify-registry ../../examples/sigil-registry-normalized.json
```

If you have older capsule records that drifted, normalize them (deterministically) and verify again:

```bash
krystal normalize-registry ../../examples/sigil-registry.json /tmp/normalized.json
krystal verify-registry /tmp/normalized.json
```

Run conformance tests:

```bash
pytest -q
```

## Compatibility

This repo defines and supports:

- **KRC-0**: the minimal registry format used in the wild: `{ "urls": [...] }`
- **KRL-1.0**: Krystal Resource Locators (stream URLs and content URLs)
- **KKS-1.0**: deterministic lattice mapping and closure

A future **KRC-1** structured registry (typed entries + checkpoints) is described in `spec/` but is not required for conformance.

## Status

- Spec: **complete**
- Reference implementation: **complete**
- Test vectors: **included**
