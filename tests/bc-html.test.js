// Описанието на задача в Basecamp (services/bc-html.js) — двете неща, поискани от
// Венци на 20.08.2026 („Описание на задачи - структура"):
//
//   1. празните редове да оцеляват при отваряне на картата за редакция;
//   2. името на видеото и етикетите на секциите да са ОЦВЕТЕНИ (само цвят, без болд).
const bch = require('../src/services/bc-html');
const fp = require('../src/services/folder-paths');

const HL = 'background-color: rgb(250, 247, 133);';
const mark = (s) => `<mark style="${HL}">${s}</mark>`;

describe('оцветяване на редовете', () => {
  test.each([
    'Видео 1 - Тест 1',
    'Видео 10 — Десето',
    'Локация на файлове:',
    'Локация на експортираното видео:',
    'Описание:',
  ])('„%s" е оцветено изцяло', (line) => {
    expect(bch.line(line)).toBe(mark(line));
  });

  test('„Копи:" оцветява само етикета', () => {
    expect(bch.line('Копи: ХХХ')).toBe(mark('Копи:') + ' ХХХ');
  });

  test('останалите редове от шаблона остават чисти', () => {
    for (const line of ['/Участници - ХХХ/', '/Локация - ХХХ/', '/Необходими ресурси - ХХХ/',
      'Дата за публикуване: 26.08.2026', 'Windows: Z:\\Venata\\Контент план 4']) {
      expect(bch.line(line)).not.toContain('<mark');
    }
  });

  test('оцветеното НЕ се удебелява', () => {
    expect(bch.line('Описание:')).not.toContain('<strong>');
    expect(bch.line('Описание:')).not.toContain('<b>');
  });

  test('спецсимволите се escape-ват и вътре, и извън <mark>', () => {
    expect(bch.line('Видео 1 - Пепси & <Cineland>')).toBe(mark('Видео 1 - Пепси &amp; &lt;Cineland&gt;'));
    expect(bch.line('Копи: <b>тест</b>')).toBe(mark('Копи:') + ' &lt;b&gt;тест&lt;/b&gt;');
  });
});

describe('форматът, който Trix пази без промяна', () => {
  test('всичко е в ЕДИН блок с <br> между редовете', () => {
    expect(bch.textToHtml('едно\nдве')).toBe('<div>едно<br>две</div>');
  });

  test('празният ред е допълнително <br>, а не празен блок', () => {
    const html = bch.textToHtml('едно\n\nдве');
    expect(html).toBe('<div>едно<br><br>две</div>');
    expect(html).not.toContain('<div><br></div>');
  });

  test('празен текст не дава празен блок', () => {
    expect(bch.textToHtml('')).toBe('');
    expect(bch.textToHtml('\n\n')).toBe('');
  });
});

describe('join — по един празен ред между групите', () => {
  test('слага разделител между съседните групи', () => {
    expect(bch.join([['а'], ['б']])).toEqual(['а', '', 'б']);
  });

  test('празните групи не оставят дупка', () => {
    expect(bch.join([[], ['а'], []])).toEqual(['а']);
    expect(bch.join([[''], ['а']])).toEqual(['а']);
  });
});

describe('цялото описание на една разбита задача', () => {
  const TITLE = 'Venata КП-4 - Видео 1 - Тест 1';
  const SECTION = [
    'Видео 1 - Тест 1',
    '/Участници - ХХХ/',
    '/Локация - ХХХ/',
    '/Необходими ресурси - ХХХ/',
    'Дата за публикуване: 26.08.2026',
    '',
    'Описание:',
    'Тази задача е просто тест',
    '',
    'Копи: ХХХ',
  ].join('\n');

  const split = fp.splitForLocation(SECTION);
  const html = bch.block(bch.join([
    bch.lines(split.before),
    fp.locationLines(TITLE),
    bch.lines(split.after),
  ]));

  test('е един-единствен блок — няма какво да се сплеска при редакция', () => {
    expect(html.startsWith('<div>')).toBe(true);
    expect(html.endsWith('</div>')).toBe(true);
    expect(html.split('<div>').length - 1).toBe(1);
  });

  test('всичките пет неща от списъка на Венци са оцветени', () => {
    for (const s of ['Видео 1 - Тест 1', 'Локация на файлове:',
      'Локация на експортираното видео:', 'Описание:', 'Копи:']) {
      expect(html).toContain(mark(s));
    }
    expect(html.split('<mark ').length - 1).toBe(5);
  });

  test('локациите стоят между водещите редове и „Описание:"', () => {
    expect(html.indexOf('/Необходими ресурси - ХХХ/'))
      .toBeLessThan(html.indexOf('Локация на файлове:'));
    expect(html.indexOf('ОТВОРИ ПАПКА')).toBeLessThan(html.indexOf(mark('Описание:')));
  });

  test('празните редове около блока с локации са точно по един', () => {
    expect(html).toContain('Дата за публикуване: 26.08.2026<br><br>' + mark('Локация на файлове:'));
    expect(html).toContain('ОТВОРИ ПАПКА</a><br><br>' + mark('Описание:'));
  });

  test('неразпознато заглавие → описанието си остава, само без локации', () => {
    const plain = bch.block(bch.join([
      bch.lines(split.before),
      fp.locationLines('Просто задача'),
      bch.lines(split.after),
    ]));
    expect(plain).not.toContain('Локация на файлове');
    expect(plain).toContain('Дата за публикуване: 26.08.2026<br><br>' + mark('Описание:'));
  });
});
