// Rebuild standalone SVG assets from the preserved wordmark outlines.
// All deliverables contain paths only and require no external font.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const directory = dirname(fileURLToPath(import.meta.url));
const outlines = JSON.parse(await readFile(join(directory, 'wordmark-outlines.json'), 'utf8'));
const colors = { forest: '#13231b', paper: '#eeeee5', lime: '#d5eb64' };
// V4: an uppercase T crossed by an open mountain horizon.
// Two filled contours keep the asymmetric ridge transparent on any background.
// The flat plateau, lower valley and smaller rise are an abstract landscape,
// not a tracing or geographic representation of a particular summit.
const mark = 'M10 18H110V29C96 30 98 39 82 39C68 39 69 28 54 28H45C27 28 27 43 10 43Z M10 52C31 52 30 37 45 37H53C64 37 65 48 81 48C98 48 99 40 110 38V60H73V110H47V60H10Z';
const svg = (viewBox, body, title = 'Tiago Ismar') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="${title}"><title>${title}</title>${body}</svg>\n`;
const symbol = (color) => svg('0 0 120 120', `<path fill="${color}" d="${mark}"/>`, 'Tiago Ismar — T com horizonte de serra');
const lockup = (symbolColor, textColor) => svg('0 0 588 124', `<path fill="${symbolColor}" d="${mark}" transform="translate(5 5.7) scale(.84)"/><path fill="${textColor}" d="${outlines.path}" transform="translate(144 30.566)"/>`);

await writeFile(join(directory, 'tiago-ismar-symbol.svg'), symbol(colors.forest));
await writeFile(join(directory, 'tiago-ismar-symbol-lime.svg'), symbol(colors.lime));
await writeFile(join(directory, 'tiago-ismar-logo-forest.svg'), lockup(colors.forest, colors.forest));
await writeFile(join(directory, 'tiago-ismar-logo-light.svg'), lockup(colors.lime, colors.paper));
await writeFile(resolve(directory, '../personal-favicon.svg'), svg('0 0 64 64', `<rect width="64" height="64" rx="13" fill="${colors.forest}"/><path fill="${colors.lime}" d="${mark}" transform="translate(.8 -1.3) scale(.52)"/>`));

// Optional PNG export using sharp from a supplied node_modules directory.
const sharpArgument = process.argv.indexOf('--sharp-root');
if (sharpArgument !== -1) {
  const sharpRoot = process.argv[sharpArgument + 1];
  if (!sharpRoot) throw new Error('--sharp-root requires a node_modules directory.');
  const require = createRequire(import.meta.url);
  const sharp = require(join(resolve(sharpRoot), 'sharp'));
  for (const [file, width] of [
    ['tiago-ismar-symbol', 1200],
    ['tiago-ismar-symbol-lime', 1200],
    ['tiago-ismar-logo-forest', 2400],
    ['tiago-ismar-logo-light', 2400],
  ]) {
    await sharp(join(directory, `${file}.svg`)).resize({ width }).png().toFile(join(directory, `${file}.png`));
  }
}
console.log('Generated v4 T and mountain horizon, horizontal lockups and favicon.');
