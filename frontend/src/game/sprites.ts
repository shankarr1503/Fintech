// CoinQuest's pixel-art coin: a grid of palette keys, '.' is transparent. Rendered by <Coin />.
// A mint glass coin to match the accent: it reads on the dark aurora and on frosted light glass.

export const PALETTE: Record<string, string> = {
  k: '#1F8A72', // rim
  y: '#8CF0D2', // face
  w: '#EAFFF8', // highlight
  o: '#4FC9A9', // shade
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
