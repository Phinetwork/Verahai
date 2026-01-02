from __future__ import annotations

from dataclasses import dataclass

# KKS-1.0 constants
MICRO: int = 1_000_000
N_DAY_MU: int = 17_491_270_421
BEATS_PER_DAY: int = 36
STEPS_PER_BEAT: int = 44
PULSES_PER_STEP: int = 11

GRID_PULSES_PER_DAY: int = BEATS_PER_DAY * STEPS_PER_BEAT * PULSES_PER_STEP  # 17_424
GRID_PULSES_PER_BEAT: int = STEPS_PER_BEAT * PULSES_PER_STEP  # 484


@dataclass(frozen=True)
class KKSCoord:
    """KKS-1.0 coordinate derived from a pulse."""

    pulse: int
    day_index: int
    beat: int
    step_index: int
    pulse_in_step: int
    grid_index: int
    r_mu: int

    @property
    def kairos(self) -> str:
        """Human-friendly (0-based) Kairos string: 'BB:SS:PP'."""
        return f"{self.beat:02d}:{self.step_index:02d}:{self.pulse_in_step:02d}"


def kks_1_0(pulse: int) -> KKSCoord:
    """Compute the KKS-1.0 coordinate for a non-negative integer pulse.

    This function is pure integer math and MUST match the spec in spec/01-kks-1.0.md.

    Args:
        pulse: non-negative integer pulse (Genesis pulse = 0)

    Returns:
        KKSCoord

    Raises:
        ValueError: if pulse is negative.
    """
    if not isinstance(pulse, int):
        raise TypeError("pulse must be int")
    if pulse < 0:
        raise ValueError("pulse must be non-negative")

    p_mu = pulse * MICRO
    day_index = p_mu // N_DAY_MU
    r_mu = p_mu - day_index * N_DAY_MU

    grid_index = (r_mu * GRID_PULSES_PER_DAY) // N_DAY_MU

    beat = grid_index // GRID_PULSES_PER_BEAT
    step_index = (grid_index % GRID_PULSES_PER_BEAT) // PULSES_PER_STEP
    pulse_in_step = grid_index % PULSES_PER_STEP

    return KKSCoord(
        pulse=pulse,
        day_index=day_index,
        beat=beat,
        step_index=step_index,
        pulse_in_step=pulse_in_step,
        grid_index=grid_index,
        r_mu=r_mu,
    )
