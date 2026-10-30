# Camera tracking

Target actor(s) chooses the performers or fixed custom marker. Aim chooses an anatomical region when actors are targeted. Composition determines where that target appears in the image.

## Camera follow strength

Steady framing uses nearby motion over a bounded time window instead of aiming at every small pose change. Tight tracking approaches the current animated target. Travel shortens the smoothing window so a moving actor does not leave the camera looking at an unrelated earlier location.

The framing correction accounts for shot scale: the same gesture occupies more of a close-up than a wide view. The filter does not alter authored camera position or automatically zoom to keep a performer’s apparent size constant.

## Deterministic evaluation

Tracking is evaluated from scene time and sampled motion, so playback and arbitrary scrubbing produce consistent poses. Boundary handling avoids introducing endpoint lag or abrupt feasibility corrections when a gesture briefly cannot fit the frame by aiming alone.

Unknown skeleton names do not guarantee anatomical targeting. A custom aim marker provides a fixed world-space alternative. See [import conventions](motion-inputs.md) and [tracking invariants](../TECHNICAL_REFERENCE.md#tracking-and-lens-invariants).
