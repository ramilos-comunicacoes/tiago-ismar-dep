// Rebuild standalone SVG assets from the preserved wordmark outlines.
// All deliverables contain paths only and require no external font.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const directory = dirname(fileURLToPath(import.meta.url));
const outlines = JSON.parse(await readFile(join(directory, 'wordmark-outlines.json'), 'utf8'));
const colors = { forest: '#13231b', paper: '#eeeee5', lime: '#d5eb64' };
// The plateau makes the top of the T; its escarpment descends to the right.
// A second ridge leaves a clear valley so the T reads at favicon size.
const mark = 'M9 49C14 33 26 24 43 24H70C83 24 89 35 95 46L108 67C96 63 88 56 82 49L76 42H68V87L50 99V42H41C29 42 20 44 9 49Z M74 77L87 69C96 75 104 77 113 80V92C102 89 93 85 86 81L74 89Z';
const svg = (viewBox, body, title = 'Tiago Ismar') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="${title}"><title>${title}</title>${body}</svg>\n`;
const symbol = (color) => svg('0 0 120 120', `<path fill="${color}" d="${mark}"/>`, 'T da Ibiapaba — símbolo de Tiago Ismar');
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
console.log('Generated the Ibiapaba T symbol, horizontal lockups and favicon.');
