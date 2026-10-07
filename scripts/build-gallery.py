"""Build the static city gallery and its credits from the verified photo manifests."""
from html import escape
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent
CITIES = [
    'tiangua', 'ubajara', 'vicosa-do-ceara', 'guaraciaba-do-norte',
    'sao-benedito', 'ibiapina', 'croata', 'carnaubal', 'ipu', 'ipueiras',
    'mucambo', 'frecheirinha', 'graca', 'pacuja', 'reriutaba', 'pires-ferreira',
]


def main():
    photos = {}
    for manifest in sorted((ROOT / 'assets/cidades').glob('sources-*.json')):
        for photo in json.loads(manifest.read_text(encoding='utf-8')):
            photos[photo['slug']] = photo
    missing = set(CITIES) - photos.keys()
    if missing:
        raise SystemExit('Missing verified photographs: ' + ', '.join(sorted(missing)))
    cards, credits = [], []
    arrow = '<svg class="icon lucide lucide-arrow-up-right" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><use href="./assets/icons/lucide.svg?v=1#arrow-up-right"></use></svg>'
    for slug in CITIES:
        p = photos[slug]
        for required in ('city', 'alt', 'author', 'license', 'licenseUrl', 'sourceUrl', 'width', 'height'):
            assert p.get(required), f'{slug}: missing {required}'
        for filename in (f'{slug}.webp', f'{slug}-mobile.webp'):
            assert (ROOT / 'assets/cidades' / filename).is_file(), filename
        image = f'./assets/cidades/{slug}.webp?v=2'
        mobile = f'./assets/cidades/{slug}-mobile.webp?v=2'
        display_title = p.get('displayTitle', p['title'])
        city, title = escape(p['city']), escape(display_title)
        caption = escape(f"{p['city']} · {display_title} · Fotografia: {p['author']} · {p['license']}")
        # Very wide panoramas need the larger file for a crisp, cropped mobile image.
        sizes = '(max-width: 599px) 90vw, (max-width: 1023px) 72vw, 60vw' if p['width'] / p['height'] < 2 else '180vw'
        source_set = f'{mobile} {p["mobileWidth"]}w, {image} {p["width"]}w' if p['mobileWidth'] < p['width'] else image
        full_image = ' data-full-image="true"' if p.get('preserveFullImage') else ''
        cards.append(f'''        <figure class="landscape-card" data-city="{slug}"{full_image}>
          <button type="button" data-photo="{image}" data-caption="{caption}" aria-label="Ampliar fotografia de {city}">
            <img src="{image}" srcset="{source_set}" sizes="{sizes}" alt="{escape(p['alt'])}" width="{p['width']}" height="{p['height']}" style="object-position:{escape(p.get('objectPosition', '50% 50%'))}" loading="lazy" decoding="async">
            <span class="photo-open" aria-hidden="true">{arrow}</span>
          </button>
          <figcaption><h3>{city}</h3><span>{title}</span></figcaption>
        </figure>''')
        credits.append(f'<p><a href="{escape(p["sourceUrl"])}" target="_blank" rel="noopener noreferrer">{city} — {title}</a>. {escape(p["author"])} · <a href="{escape(p["licenseUrl"])}" target="_blank" rel="noopener noreferrer">{escape(p["license"])}</a>.</p>')
    index = ROOT / 'index.html'
    content = index.read_text(encoding='utf-8')
    gallery = '<div class="landscape-track" role="region" aria-roledescription="carrossel" aria-label="Fotografias das cidades da Ibiapaba e seu entorno" tabindex="0">\n' + '\n'.join(cards) + '\n      </div>'
    content, count = re.subn(r'<div class="landscape-track".*?</div>', lambda _: gallery, content, count=1, flags=re.S)
    assert count == 1
    notes = '<p>Fotografias otimizadas para a web. Imagens sob licença sem derivações são exibidas integralmente, sem filtros ou cortes. As demais podem receber recorte responsivo e mantêm a licença indicada no crédito. Retratos de Tiago Ismar fornecidos pelo seu acervo; a composição usa a fotografia original com máscara de recorte, sem geração ou retoque de rosto.</p>'
    content, count = re.subn(r'<div id="credits-content">.*?</div>', lambda _: '<div id="credits-content">' + ''.join(credits) + notes + '</div>', content, count=1, flags=re.S)
    assert count == 1
    index.write_text(content, encoding='utf-8', newline='\n')
    print(f'Built {len(cards)} distinct city photographs and complete credits.')


if __name__ == '__main__':
    main()
