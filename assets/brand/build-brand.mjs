// Rebuild standalone SVG assets from the preserved wordmark outlines.
// All deliverables contain paths only and require no external font.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const outlines = JSON.parse(await readFile(join(directory, 'wordmark-outlines.json'), 'utf8'));
const colors = { forest: '#13231b', paper: '#eeeee5', lime: '#d5eb64' };
// A horizontal plateau and two geological levels; the transparent cut is a trail.
const mark = 'M7 84L28 30H74L86 44H93L113 84ZM57 30H65C65 38 59 43 50 48C42 52 39 55 40 60C42 67 55 71 58 84H42C40 75 28 70 27 61C25 49 38 43 47 39C53 36 56 34 57 30Z';
const svg = (viewBox, body, title = 'Tiago Ismar') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="${title}"><title>${title}</title>${body}</svg>\n`;
const symbol = (color) => svg('0 18 120 78', `<path fill="${color}" fill-rule="evenodd" d="${mark}"/>`, 'Tiago Ismar — serra e caminho');
const lockup = (symbolColor, textColor) => svg('0 0 598 124', `<path fill="${symbolColor}" fill-rule="evenodd" d="${mark}" transform="translate(1 0) scale(1.13)"/><path fill="${textColor}" d="${outlines.path}" transform="translate(164 30.566)"/>`);

await writeFile(join(directory, 'tiago-ismar-symbol.svg'), symbol(colors.forest));
await writeFile(join(directory, 'tiago-ismar-symbol-lime.svg'), symbol(colors.lime));
await writeFile(join(directory, 'tiago-ismar-logo-forest.svg'), lockup(colors.forest, colors.forest));
await writeFile(join(directory, 'tiago-ismar-logo-light.svg'), lockup(colors.lime, colors.paper));
await writeFile(resolve(directory, '../personal-favicon.svg'), svg('0 0 64 64', `<rect width="64" height="64" rx="13" fill="${colors.forest}"/><path fill="${colors.lime}" fill-rule="evenodd" d="${mark}" transform="translate(2 3.5) scale(.5)"/>`));
console.log('Generated Tiago Ismar symbol, two horizontal lockups and favicon.');
