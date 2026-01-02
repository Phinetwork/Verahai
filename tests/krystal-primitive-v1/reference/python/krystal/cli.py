from __future__ import annotations

import argparse
import json
from pathlib import Path

from .kks import kks_1_0
from .krl import decode_krl
from .normalize import normalize_registry
from .registry import load_registry
from .verify import verify_registry


def _cmd_kks(args: argparse.Namespace) -> int:
    pulse = int(args.pulse)
    coord = kks_1_0(pulse)
    out = {
        "pulse": coord.pulse,
        "dayIndex": coord.day_index,
        "beat": coord.beat,
        "stepIndex": coord.step_index,
        "pulseInStep": coord.pulse_in_step,
        "gridIndex": coord.grid_index,
        "rMu": coord.r_mu,
        "kairos": coord.kairos,
    }
    print(json.dumps(out, indent=2))
    return 0


def _cmd_decode_url(args: argparse.Namespace) -> int:
    d = decode_krl(args.url)
    out = {
        "kind": d.kind,
        "url": d.url,
        "artifactHash": d.artifact_hash,
        "pulse": d.pulse,
        "beat": d.beat,
        "stepIndex": d.step_index,
        "payload": d.payload,
    }
    print(json.dumps(out, indent=2, ensure_ascii=False))
    return 0


def _cmd_verify_registry(args: argparse.Namespace) -> int:
    reg = load_registry(args.path)
    result = verify_registry(reg, strict=not args.non_strict)
    out = {
        "ok": result.ok,
        "total": result.total,
        "decoded": result.decoded,
        "issues": [
            {
                "index": i.index,
                "level": i.level,
                "code": i.code,
                "message": i.message,
                "url": i.url,
            }
            for i in result.issues
        ],
    }
    print(json.dumps(out, indent=2, ensure_ascii=False))
    return 0 if result.ok else 1


def _cmd_normalize_registry(args: argparse.Namespace) -> int:
    reg = load_registry(args.input)
    new_reg, stats = normalize_registry(reg)
    out_path = Path(args.output)
    out_path.write_text(json.dumps({"urls": new_reg.urls}, indent=2, ensure_ascii=False), encoding="utf-8")
    out = {
        "ok": True,
        "total": stats.total,
        "fixedCapsules": stats.fixed_capsules,
        "output": str(out_path),
    }
    print(json.dumps(out, indent=2, ensure_ascii=False))
    return 0


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="krystal", description="Krystal Primitive CLI")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_kks = sub.add_parser("kks", help="Compute KKS-1.0 beat/step for a pulse")
    p_kks.add_argument("pulse", help="pulse (integer)")
    p_kks.set_defaults(func=_cmd_kks)

    p_dec = sub.add_parser("decode-url", help="Decode a KRL locator URL")
    p_dec.add_argument("url", help="KRL locator URL")
    p_dec.set_defaults(func=_cmd_decode_url)

    p_ver = sub.add_parser("verify-registry", help="Verify a KRC-0 registry JSON file")
    p_ver.add_argument("path", help="Path to registry JSON")
    p_ver.add_argument("--non-strict", action="store_true", help="Warn instead of error for unknown locators")
    p_ver.set_defaults(func=_cmd_verify_registry)

    p_norm = sub.add_parser("normalize-registry", help="Rewrite a registry with corrected capsule metadata")
    p_norm.add_argument("input", help="Input registry JSON")
    p_norm.add_argument("output", help="Output registry JSON")
    p_norm.set_defaults(func=_cmd_normalize_registry)

    args = parser.parse_args(argv)
    rc = args.func(args)
    raise SystemExit(rc)


if __name__ == "__main__":
    main()
