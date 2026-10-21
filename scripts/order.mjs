// Each pair of rounds runs a rotation and its reverse. Over 2*N rounds,
// every entrant occupies each position exactly twice, including N=2.
export function roundOrder(selected,round) {
  const shift=Math.floor(round/2)%selected.length;
  const order=selected.slice(shift).concat(selected.slice(0,shift));
  return round%2 ? order.reverse() : order;
}
