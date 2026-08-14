// HTML-ът на КП картата в Basecamp (services/kp-create.js → textToBcHtml).
//
// Пази три неща, поискани от Венци (12.08.2026):
//   1. всяко „Видео N - …" заглавие излиза оцветено с ПЪРВИЯ highlight цвят на
//      Basecamp — <mark> с inline background-color, точно както го записва самият
//      Basecamp. Голото <mark> минава през API-то, но Trix не го припознава като
//      highlight → цветът не се вижда и изчезва при първия запис от edit режим;
//   2. САМО цвят — никакво удебеляване на хайлайтнатия текст;
//   3. останалият текст си остава чист (един <div> с <br> между редовете), за да
//      не се губи спейсингът при отваряне за редакция.
const mockDb = {
  pool: { query: jest.fn(), end: jest.fn().mockResolvedValue(undefined) },
  query: jest.fn().mockResolvedValue([]),
  queryOne: jest.fn().mockResolvedValue(null),
  execute: jest.fn().mockResolvedValue(undefined)
};
jest.mock('../src/db/pool', () => mockDb);

const kpc = require('../src/services/kp-create');

// Цветът от примера на Венци (реален Basecamp rich text).
const HIGHLIGHT = 'background-color: rgb(250, 247, 133);';

describe('textToBcHtml — оцветяване на заглавията на видеата', () => {
  test('заглавието „Видео N - …" носи inline highlight цвета', () => {
    const html = kpc.textToBcHtml('Видео 1 - Лятна кампания скеч');
    expect(html).toBe(`<div><mark style="${HIGHLIGHT}">Видео 1 - Лятна кампания скеч</mark></div>`);
  });

  test('хайлайтнатият текст НЕ се удебелява', () => {
    const html = kpc.textToBcHtml('Видео 1 - Лятна кампания скеч\nобикновен ред');
    expect(html).not.toContain('<strong>');
    expect(html).not.toContain('<b>');
  });

  test('всяко заглавие в целия план се оцветява, не само първото', () => {
    const text = 'Видео 1 - Първо\nтекст\n\nВидео 2 - Второ\nВидео 10 — Десето';
    const html = kpc.textToBcHtml(text);
    // split вместо RegExp — цветът съдържа скоби, които биха станали групи.
    expect(html.split(`<mark style="${HIGHLIGHT}">`).length - 1).toBe(3);
  });

  test('обикновените редове остават без оцветяване', () => {
    const html = kpc.textToBcHtml('Копи: Лятната кампания е тук\n/Участници - 2/');
    expect(html).not.toContain('<mark');
    expect(html).toBe('<div>Копи: Лятната кампания е тук<br>/Участници - 2/</div>');
  });

  test('празният ред остава като допълнителен <br> (спейсингът преживява edit)', () => {
    expect(kpc.textToBcHtml('едно\n\nдве')).toBe('<div>едно<br><br>две</div>');
  });

  test('шаблонът по подразбиране излиза с оцветени заглавия', () => {
    const text = kpc.KP_VIDEO_SECTION_TEMPLATE.replace(/\{N\}/g, '3');
    expect(kpc.textToBcHtml(text)).toContain(`<mark style="${HIGHLIGHT}">Видео 3 - ХХХ</mark>`);
  });

  test('спецсимволите в заглавието се escape-ват вътре в <mark>', () => {
    const html = kpc.textToBcHtml('Видео 1 - Пепси & <Cineland>');
    expect(html).toBe(`<div><mark style="${HIGHLIGHT}">Видео 1 - Пепси &amp; &lt;Cineland&gt;</mark></div>`);
  });
});
