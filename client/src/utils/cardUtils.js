export function getNextCardForPile(pile) {
  if (pile.length === 0) return 1;

  const lastCard = pile[pile.length - 1];
  if (lastCard === 'SKIP-BO') {
    let value = 0;
    for (let i = 0; i < pile.length; i++) {
      if (pile[i] !== 'SKIP-BO') {
        value = pile[i];
      } else {
        value++;
      }
    }
    return value === 12 ? null : value + 1;
  }

  return lastCard === 12 ? null : lastCard + 1;
}
