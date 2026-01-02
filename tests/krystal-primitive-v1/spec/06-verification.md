# Verification

This document defines what a verifier MUST check to claim that a registry and its records are coherent.

---

## Verify a KRC-0 registry

Given a parsed registry `{ "urls": [...] }`:

For each `url` in `urls`:

1. Parse as a URL.
2. Determine locator type:
   - Stream locator if it matches KRL stream forms (path or fragment)
   - Content locator if the path begins with `/s/`
3. Decode the embedded payload (if any) per KRL-1.0.
4. Extract `pulse` and any claimed coordinate metadata:
   - For expanded payloads: `pulse`, `beat`, `stepIndex`
   - For capsule payloads: `u`, `b`, `s`
5. If `pulse` is present:
   - Compute `(beat*, stepIndex*, pulseInStep*)` = KKS-1.0(pulse)
6. If claimed `(beat, stepIndex)` are present:
   - They MUST equal `(beat*, stepIndex*)`.
7. Report:
   - parse errors
   - missing pulse (allowed)
   - coordinate mismatches (MUST fail verification in strict mode)

---

## Capsule drift and normalization

Capsules (`p=c:...`) are an *optional convenience* for fast coordinate checks.
If a capsule's `(b, s)` does not match KKS-1.0 for its `u`, the record is **not coherent** under this spec.

Because a registry is typically append-only, a producer MAY:

- append a new corrected locator, or
- publish a deterministic normalized copy of the registry (capsules corrected)

The reference implementation includes a deterministic normalizer:

- `krystal normalize-registry <in.json> <out.json>`

---

## Verify an artifact hash (optional)

If artifact bytes are available locally:

- Compute `sha256(bytes)` and compare to the `{HEX_SHA256}` path segment in the content locator.

This is OPTIONAL because transport/fetching is out of scope for the primitive.

