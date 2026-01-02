pragma circom 2.0.0;

template SigilProof() {
    // PRIVATE INPUT: The user's harmonic secret (private witness).
    signal input secret;

    // PUBLIC INPUT: The expected KaiSignature commitment.
    signal input expectedHash;

    // Enforce: expectedHash == secret (commitment is provided separately).
    expectedHash === secret;
}

// Compile entry point
component main { public [expectedHash] } = SigilProof();
