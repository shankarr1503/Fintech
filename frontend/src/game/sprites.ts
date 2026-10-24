// CoinQuest's pixel-art coin: a grid of palette keys, '.' is transparent. Rendered by <Coin />.
// Copper, matching the 3D coin (src/ui/three/models.ts): the small flat coin is its icon.

export const PALETTE: Record<string, string> = {
  k: '#8A5426', // rim
  y: '#D89A57', // face
  w: '#F2C58C', // lit edge (the key light is top left)
  o: '#B5773D', // shaded edge
};

export const SPRITES = {
  coin: [
    '..kkkk..',
    '.kyyyyk.',
    'kyywyyok',
    'kyywyyok',
    'kyywyyok',
    'kyywyyok',
    'kyywyyok',
    'kyyyyyok',
    '.kooook.',
    '..kkkk..',
  ],
} as const;
