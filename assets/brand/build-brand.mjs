// Rebuild standalone SVG assets from the preserved wordmark outlines.
// All deliverables contain paths only and require no external font.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const directory = dirname(fileURLToPath(import.meta.url));
const outlines = JSON.parse(await readFile(join(directory, 'wordmark-outlines.json'), 'utf8'));
const colors = { forest: '#13231b', paper: '#eeeee5', lime: '#d5eb64' };
// V5: the Ibiapaba landscape is the symbol: a broad plateau, steep escarpment
// and a lower foreground ridge separated by an open valley.
// The asymmetrical silhouette is an original interpretation, not a map or a
// tracing of the reference photograph. All negative space stays transparent.
const mark = 'M8 40C9 26 19 18 33 18C43 18 48 21 59 19C67 17 73 17 79 20C83 22 84 28 85 34L89 51C93 65 101 75 112 80V93C94 87 80 74 64 70C48 66 34 75 8 81Z M8 95C27 92 44 79 59 78C75 76 88 93 112 103H8Z';
const svg = (viewBox, body, title = 'Tiago Ismar') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="${title}"><title>${title}</title>${body}</svg>\n`;
const symbol = (color) => svg('0 0 120 120', `<path fill="${color}" d="${mark}"/>`, 'Serra da Ibiapaba — símbolo de Tiago Ismar');
const lockup = (symbolColor, textColor) => svg('0 0 588 124', `<path fill="${symbolColor}" d="${mark}" transform="translate(5 12.4) scale(.84)"/><path fill="${textColor}" d="${outlines.path}" transform="translate(144 30.566)"/>`);

await writeFile(join(directory, 'tiago-ismar-symbol.svg'), symbol(colors.forest));
await writeFile(join(directory, 'tiago-ismar-symbol-lime.svg'), symbol(colors.lime));
await writeFile(join(directory, 'tiago-ismar-logo-forest.svg'), lockup(colors.forest, colors.forest));
await writeFile(join(directory, 'tiago-ismar-logo-light.svg'), lockup(colors.lime, colors.paper));
await writeFile(resolve(directory, '../personal-favicon.svg'), svg('0 0 64 64', `<rect width="64" height="64" rx="13" fill="${colors.forest}"/><path fill="${colors.lime}" d="${mark}" transform="translate(.8 .6) scale(.52)"/>`));

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
console.log('Generated v5 Ibiapaba landscape symbol, horizontal lockups and favicon.');
