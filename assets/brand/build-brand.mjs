// Rebuild standalone SVG assets from the preserved wordmark outlines.
// All deliverables contain paths only and require no external font.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const directory = dirname(fileURLToPath(import.meta.url));
const outlines = JSON.parse(await readFile(join(directory, 'wordmark-outlines.json'), 'utf8'));
const colors = { forest: '#13231b', paper: '#eeeee5', lime: '#d5eb64' };
// TI monogram carved by two contour channels. All geometry is filled paths;
// the transparent cuts need no masks, clipping, fonts, gradients or filters.
const mark = 'M10 12H84C100 12 110 24 110 40V52H67V110H28V52H10ZM89 69C97 68 104 65 110 60V110H89ZM10 22H81C94 22 101 30 101 40C101 41.657 99.657 43 98 43C96.343 43 95 41.657 95 40C95 32 90 28 81 28H10ZM10 37H40C51 37 57 43 57 54V110H51V54C51 46 47 43 40 43H10Z';
const svg = (viewBox, body, title = 'Tiago Ismar') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="${title}"><title>${title}</title>${body}</svg>\n`;
const symbol = (color) => svg('0 0 120 120', `<path fill="${color}" fill-rule="evenodd" d="${mark}"/>`, 'Tiago Ismar — monograma e curvas de nível');
const lockup = (symbolColor, textColor) => svg('0 0 588 124', `<path fill="${symbolColor}" fill-rule="evenodd" d="${mark}" transform="translate(5 10) scale(.84)"/><path fill="${textColor}" d="${outlines.path}" transform="translate(144 30.566)"/>`);

await writeFile(join(directory, 'tiago-ismar-symbol.svg'), symbol(colors.forest));
await writeFile(join(directory, 'tiago-ismar-symbol-lime.svg'), symbol(colors.lime));
await writeFile(join(directory, 'tiago-ismar-logo-forest.svg'), lockup(colors.forest, colors.forest));
await writeFile(join(directory, 'tiago-ismar-logo-light.svg'), lockup(colors.lime, colors.paper));
await writeFile(resolve(directory, '../personal-favicon.svg'), svg('0 0 64 64', `<rect width="64" height="64" rx="13" fill="${colors.forest}"/><path fill="${colors.lime}" fill-rule="evenodd" d="${mark}" transform="translate(6 5.57) scale(.4333)"/>`));

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
console.log('Generated TI contour monogram, horizontal lockups and favicon.');
