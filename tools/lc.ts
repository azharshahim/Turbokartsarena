import { Track } from '../src/core/track';
import { CIRCUITS } from '../src/game/circuits';
for (const c of CIRCUITS) {
  const tr = new Track(c);
  let maxK = 0, at = 0;
  for (let i=0;i<tr.count;i++){ const k = Math.abs(tr.samples[i].curvature); if (k>maxK){maxK=k;at=i;} }
  console.log(c.name, 'maxK', maxK.toFixed(4), 'R', (1/maxK).toFixed(1), 's', (at*tr.step).toFixed(0), 'width', c.width, 'maxCurv', c.maxCurvature);
}
