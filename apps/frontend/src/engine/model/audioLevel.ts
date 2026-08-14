/**
 * Measuring how loud the microphone actually is.
 *
 * ## Why this is not the average of the frequency bins
 *
 * The recorder used to take `getByteFrequencyData`, add up every bin and divide
 * by the count. That number is not loudness — it is the mean height of the
 * spectrum, and it moves for reasons that have nothing to do with volume:
 *
 *  - It falls as the FFT gets bigger, because the same energy is spread over
 *    more bins. The meter's sensitivity was quietly tied to `fftSize`.
 *  - Speech puts almost all of its energy in a narrow band low in the spectrum
 *    while the bins above it sit near zero, so the *average* of the whole
 *    spectrum stays small however loudly you talk. That is why the old meter
 *    barely left the floor and had to be multiplied by 2.2 in the HUD to show
 *    anything at all — a fudge factor compensating for the wrong measurement.
 *  - Broadband hiss with no speech in it reads *higher* than a clear voice,
 *    because it fills every bin.
 *
 * The honest measurement is RMS over the **time domain**: the actual signal
 * amplitude, which is what a level meter has meant since long before software.
 * It is independent of FFT size, it responds to loudness and not to timbre, and
 * it needs no fudge factor.
 */

/**
 * RMS of one buffer of time-domain samples, as 0..1.
 *
 * `getByteTimeDomainData` gives unsigned bytes centred on 128 — silence is a
 * flat line at 128, not at 0 — so each sample is offset before being squared.
 * Squaring the raw byte instead would report near-full level for pure silence,
 * which is the kind of bug that looks like a working meter.
 */
export function rmsLevel(samples: Uint8Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const centred = (samples[i] - 128) / 128;
    sum += centred * centred;
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * RMS mapped onto the 0..1 a meter should draw.
 *
 * Two things happen here, and both are about human hearing rather than
 * arithmetic.
 *
 * **Decibels, not amplitude.** Loudness is perceived logarithmically. A linear
 * RMS bar spends almost all of its travel in the top of the range and barely
 * moves across the whole quiet half of normal speech, which is exactly the half
 * you are watching when you want to know whether the microphone is picking you
 * up. Converting to dBFS and laying the floor at -60 gives a meter whose
 * movement matches what you hear.
 *
 * **A floor, not a cliff.** Anything below the floor reads as 0 rather than
 * negative infinity, so digital silence is a flat line instead of a `NaN`.
 */
export function meterLevel(rms: number, floorDb = -60): number {
  if (!(rms > 0)) return 0;
  const db = 20 * Math.log10(rms);
  if (db <= floorDb) return 0;
  return Math.min(1, db / -floorDb + 1);
}

/**
 * Whether a take has caught anything at all.
 *
 * A muted microphone, a device that was unplugged, or the wrong input selected
 * all produce a recording of perfect silence — and the only moment that is
 * cheap to fix is before you have said the whole thing. This is what lets the
 * HUD say "we are not hearing anything" while there is still time to act,
 * rather than leaving a silent note on the board to be discovered later.
 *
 * Deliberately generous. The cost of a false alarm is a wrong warning during a
 * genuine pause for breath, so it takes a sustained run of near-silence — not
 * a quiet moment — before anything is said.
 */
export function isSilent(levels: number[], threshold = 0.02): boolean {
  if (levels.length === 0) return false;
  return levels.every((l) => l < threshold);
}
