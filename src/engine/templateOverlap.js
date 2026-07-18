// Measures whether a candidate sprite is already represented, pixel for
// pixel, inside an accepted sprite at their detected battlefield positions.
// This is deliberately independent from screenshot matching and logical
// footprints: it detects composite catalog art without conflating adjacent
// obstacles whose cells or bounding boxes merely overlap.
export function templateEmbeddingRatio(candidate, accepted, {
  sampleStep = 2,
  alphaThreshold = 0.3,
  alphaTolerance = 0.28,
  premultipliedColorTolerance = 42
} = {}) {
  if (!candidate?.pixels || !accepted?.pixels) return 0;
  let opaqueSamples = 0;
  let explainedSamples = 0;
  const candidateLeft = Math.round(candidate.left || 0);
  const candidateTop = Math.round(candidate.top || 0);
  const acceptedLeft = Math.round(accepted.left || 0);
  const acceptedTop = Math.round(accepted.top || 0);

  for (let y = 0; y < candidate.height; y += sampleStep) {
    const acceptedY = candidateTop + y - acceptedTop;
    for (let x = 0; x < candidate.width; x += sampleStep) {
      const candidateIndex = (y * candidate.width + x) * 4;
      const candidateAlpha = candidate.pixels[candidateIndex + 3] / 255;
      if (candidateAlpha < alphaThreshold) continue;
      opaqueSamples += 1;
      const acceptedX = candidateLeft + x - acceptedLeft;
      if (acceptedX < 0 || acceptedX >= accepted.width || acceptedY < 0 || acceptedY >= accepted.height) continue;
      const acceptedIndex = (acceptedY * accepted.width + acceptedX) * 4;
      const acceptedAlpha = accepted.pixels[acceptedIndex + 3] / 255;
      if (acceptedAlpha < alphaThreshold || Math.abs(candidateAlpha - acceptedAlpha) > alphaTolerance) continue;
      let error = 0;
      for (let channel = 0; channel < 3; channel += 1) {
        error += Math.abs(
          candidate.pixels[candidateIndex + channel] * candidateAlpha
          - accepted.pixels[acceptedIndex + channel] * acceptedAlpha
        );
      }
      if (error / 3 <= premultipliedColorTolerance) explainedSamples += 1;
    }
  }
  return opaqueSamples ? explainedSamples / opaqueSamples : 0;
}
