"""Exploratory footprint-placement models, not tests of deletion or function."""
import numpy as np


def longest_gap(covered, circular=False):
    x = np.asarray(covered, dtype=bool)
    if not x.size or not x.any():
        return len(x)
    if circular:
        # Rotate at a covered base so any origin-spanning gap is one run.
        x = np.roll(x, -int(np.flatnonzero(x)[0]))
    gaps = np.diff(np.r_[-1, np.flatnonzero(x), len(x)]) - 1
    return int(gaps.max())


def coverage_null(patterns, length, seed, replicates=20000):
    patterns = [np.asarray(sorted(set(p)), dtype=int) for p in patterns if len(p)]
    observed = np.zeros(length, dtype=bool)
    for p in patterns:
        if p.min() < 0 or p.max() >= length:
            raise ValueError("Footprint outside reference")
        observed[p] = True
    results = {}
    for circular in [True, False]:
        rng = np.random.default_rng(seed)
        breadths, gaps = [], []
        for _ in range(replicates):
            cover = np.zeros(length, dtype=bool)
            for p in patterns:
                if circular:
                    indices = (p + int(rng.integers(length))) % length
                else:
                    relative = p - p.min()
                    indices = relative + int(rng.integers(length - relative.max()))
                cover[indices] = True
            breadths.append(float(cover.mean()))
            gaps.append(longest_gap(cover, circular=circular))
        observed_gap = longest_gap(observed, circular=circular)
        results["circular" if circular else "linear_contained"] = dict(
            observed_breadth=float(observed.mean()),
            observed_longest_uncovered_run=observed_gap,
            null_breadth_quantiles=np.quantile(breadths, [0.025, 0.5, 0.975]).tolist(),
            fraction_simulations_breadth_le_observed=float(
                np.mean(np.asarray(breadths) <= observed.mean())
            ),
            null_longest_gap_quantiles=np.quantile(gaps, [0.025, 0.5, 0.975]).tolist(),
            fraction_simulations_gap_ge_observed=float(
                np.mean(np.asarray(gaps) >= observed_gap)
            ),
        )
    return dict(
        unique_fragments=len(patterns),
        seed=seed,
        replicates=replicates,
        models=results,
        assumptions="Circular: origin-spanning gaps merged. Linear: observed fragment footprints translated without wrapping and wholly contained, producing terminal depletion. Both condition on observed footprints and ignore unobserved clipped tails, sequence/library bias and divergence. Exploratory model sensitivities, not deletion or clinical p-values.",
    )
