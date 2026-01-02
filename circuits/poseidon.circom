pragma circom 2.0.0;

template Poseidon1() {
    signal input inputs[1];
    signal output out;

    var RC[8][2] = [
        [1, 2],
        [3, 4],
        [5, 6],
        [7, 8],
        [9, 10],
        [11, 12],
        [13, 14],
        [15, 16]
    ];

    var MDS[2][2] = [
        [1, 2],
        [3, 4]
    ];

    signal state[9][2];
    signal t0[8];
    signal t1[8];
    signal t0sq[8];
    signal t1sq[8];
    signal t0quad[8];
    signal t1quad[8];
    signal s0[8];
    signal s1[8];

    state[0][0] <== inputs[0];
    state[0][1] <== 0;

    for (var r = 0; r < 8; r++) {
        t0[r] <== state[r][0] + RC[r][0];
        t1[r] <== state[r][1] + RC[r][1];

        t0sq[r] <== t0[r] * t0[r];
        t1sq[r] <== t1[r] * t1[r];
        t0quad[r] <== t0sq[r] * t0sq[r];
        t1quad[r] <== t1sq[r] * t1sq[r];
        s0[r] <== t0quad[r] * t0[r];
        s1[r] <== t1quad[r] * t1[r];

        state[r + 1][0] <== s0[r] * MDS[0][0] + s1[r] * MDS[0][1];
        state[r + 1][1] <== s0[r] * MDS[1][0] + s1[r] * MDS[1][1];
    }

    out <== state[8][0];
}

template Poseidon(nInputs) {
    assert(nInputs == 1);
    signal input inputs[nInputs];
    signal output out;

    component p = Poseidon1();
    p.inputs[0] <== inputs[0];
    out <== p.out;
}
