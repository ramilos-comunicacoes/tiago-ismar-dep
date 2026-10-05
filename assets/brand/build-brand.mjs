// Rebuild standalone SVG assets from the preserved wordmark outlines.
// All deliverables contain paths only and require no external font.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const directory = dirname(fileURLToPath(import.meta.url));
const outlines = JSON.parse(await readFile(join(directory, 'wordmark-outlines.json'), 'utf8'));
const colors = { forest: '#13231b', paper: '#eeeee5', lime: '#d5eb64' };
// A single flowing T: its crossbar is an undulating mountain silhouette.
// One continuous filled outline, without masks, strokes or external resources.
const mark = 'M12 44C28 43 34 20 49 20C65 20 70 37 82 37C93 37 99 31 109 30C114 30 117 34 117 39C117 44 114 48 109 48C98 49 94 55 82 55C76 55 71 53 67 50V101C67 107 63 110 58 110C53 110 49 107 49 101V43C40 44 33 62 12 62C7 62 3 58 3 53C3 48 7 44 12 44Z';
const svg = (viewBox, body, title = 'Tiago Ismar') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="${title}"><title>${title}</title>${body}</svg>\n`;
const symbol = (color) => svg('0 0 120 120', `<path fill="${color}" d="${mark}"/>`, 'Tiago Ismar — T e serra em movimento');
const lockup = (symbolColor, textColor) => svg('0 0 588 124', `<path fill="${symbolColor}" d="${mark}" transform="translate(5 5.7) scale(.84)"/><path fill="${textColor}" d="${outlines.path}" transform="translate(144 30.566)"/>`);

await writeFile(join(directory, 'tiago-ismar-symbol.svg'), symbol(colors.forest));
await writeFile(join(directory, 'tiago-ismar-symbol-lime.svg'), symbol(colors.lime));
await writeFile(join(directory, 'tiago-ismar-logo-forest.svg'), lockup(colors.forest, colors.forest));
await writeFile(join(directory, 'tiago-ismar-logo-light.svg'), lockup(colors.lime, colors.paper));
await writeFile(resolve(directory, '../personal-favicon.svg'), svg('0 0 64 64', `<rect width="64" height="64" rx="13" fill="${colors.forest}"/><path fill="${colors.lime}" d="${mark}" transform="translate(6 3.9) scale(.4333)"/>`));

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
console.log('Generated flowing T and mountain symbol, horizontal lockups and favicon.');
