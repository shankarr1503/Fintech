// Voxel models. Pixel art first: every model is a sprite you can read in this file.

/** 13×13 copper coin: rim (r), face (f), lit edge (l), shaded edge (s) and an embossed ₹ (e). */
function buildCoin(): string[] {
  const glyph = ['eeeee', '...e.', 'eeeee', 'eee..', '.ee..', '..ee.', '...ee']; // the font's own ₹
  const rows: string[] = [];
  for (let y = 0; y < 13; y++) {
    let row = '';
    for (let x = 0; x < 13; x++) {
      const d = Math.hypot(x - 6, y - 6);
      if (d > 6.4) row += '.';
      else if (d > 5.3) row += 'r';
      else if (d > 4.3 && x + y < 10) row += 'l';
      else if (d > 4.3 && x + y > 14) row += 's';
      else row += glyph[y - 3]?.[x - 4] === 'e' ? 'e' : 'f';
    }
    rows.push(row);
  }
  return rows;
}

export const COIN = {
  rows: buildCoin(),
  palette: { r: '#8A5426', f: '#D89A57', l: '#F2C58C', s: '#B5773D', e: '#F4C185' },
  depth: 1.6,
  raised: 'e',
};

/** The app lock: a steel shackle over a mint body with a dark keyhole. */
export const PADLOCK = {
  rows: [
    '...ssss...',
    '..s....s..',
    '.s......s.',
    '.s......s.',
    '.s......s.',
    'bbbbbbbbbb',
    'bllbbbbbbb',
    'blbbbkkbbb',
    'bbbbbkkbbb',
    'bbbbbbkbbb',
    'bbbbbbbbbb',
    'bbbbbbbbbb',
  ],
  palette: { s: '#C9D2DE', b: '#6FD9B9', l: '#B9F7E3', k: '#0B2A22' },
  depth: 3,
  raised: '',
};
