# Test vectors

This repository includes test vectors so independent implementations can prove they are conformant.

- `test-vectors/kks_vectors.json` — pulse -> beat/step/pulseInStep expected outputs
- `test-vectors/url_vectors.json` — base64url decoding expectations for sample KRLs
- `test-vectors/registry_sample.json` — a small sample KRC-0 registry

A conforming implementation MUST match these vectors exactly.

