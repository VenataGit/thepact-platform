// Заглавие на задача → локации на вътрешния сървър. Чиста логика, без мрежа и база.
const fp = require('../src/services/folder-paths');

describe('parseTaskTitle', () => {
  test('видео от контент план', () => {
    expect(fp.parseTaskTitle('Credissimo КП-12 - Видео 4 - Как се прави')).toEqual({
      client: 'Credissimo', kind: 'kp', number: 12, block: 'Контент план 12',
      videoNumber: 4, videoTitle: 'Как се прави',
    });
  });

  test('видео от реклами', () => {
    const p = fp.parseTaskTitle('Credissimo РЕК-8 - Видео 2 - Промоция за всеки кредит');
    expect(p.kind).toBe('ads');
    expect(p.block).toBe('Реклами 8');
    expect(p.videoNumber).toBe(2);
  });

  test('кампания', () => {
    expect(fp.parseTaskTitle('Credissimo КМП-3 - Видео 1 - Коледно парти').block).toBe('Кампания 3');
  });

  test('самият контент план, без видео', () => {
    const p = fp.parseTaskTitle('Beauty Sector КП-9');
    expect(p.client).toBe('Beauty Sector');
    expect(p.videoNumber).toBeNull();
  });

  test('търпи опашка след номера, интервал вместо тире и водеща нула', () => {
    expect(fp.parseTaskTitle('Cineland КП 018 контент план').number).toBe(18);
  });

  test('видео без заглавие', () => {
    const p = fp.parseTaskTitle('Cineland КП-3 - Видео 7');
    expect(p.videoNumber).toBe(7);
    expect(p.videoTitle).toBe('');
  });

  test('непознат префикс и безсмислици → null', () => {
    expect(fp.parseTaskTitle('Credissimo ADS-8 - Видео 2')).toBeNull();
    expect(fp.parseTaskTitle('Просто една задача')).toBeNull();
    expect(fp.parseTaskTitle('')).toBeNull();
    expect(fp.parseTaskTitle(null)).toBeNull();
  });
});

describe('safeName', () => {
  test('маха забранените за Windows знаци и опашката от точки', () => {
    expect(fp.safeName('Как се прави: част 1/2?')).toBe('Как се прави част 1 2');
    expect(fp.safeName('Заглавие...')).toBe('Заглавие');
  });
});

describe('pathsForTitle', () => {
  const p = fp.pathsForTitle('Credissimo КП-12 - Видео 4 - Как се прави');

  test('файловете са в папката на видеото', () => {
    expect(p.files.win).toBe('Z:\\Credissimo\\Контент план 12\\Видео 4 - Как се прави');
    expect(p.files.mac).toBe('/Volumes/Production/Credissimo/Контент план 12/Видео 4 - Как се прави');
  });

  test('експортнатото е под ЕДНА папка за целия блок', () => {
    expect(p.exported.win).toBe('Z:\\Exported Videos\\Credissimo\\Контент план 12');
    expect(p.exported.mac).toBe('/Volumes/Production/Exported Videos/Credissimo/Контент план 12');
  });

  test('линкът сочи към /go/folder с кодирания Windows път', () => {
    expect(p.files.url.startsWith('https://thepact.pro/go/folder?p=')).toBe(true);
    expect(decodeURIComponent(p.files.url.split('p=')[1])).toBe(p.files.win);
  });

  test('без видео → папката на блока', () => {
    expect(fp.pathsForTitle('Beauty Sector КП-9').files.win).toBe('Z:\\Beauty Sector\\Контент план 9');
  });

  test('неразпознато заглавие → null', () => {
    expect(fp.pathsForTitle('Нещо си')).toBeNull();
  });
});

describe('locationHtml', () => {
  const html = fp.locationHtml('Credissimo РЕК-8 - Видео 2 - Промоция');

  test('носи двата пътя и работещия линк', () => {
    expect(html).toContain('Локация на файлове');
    expect(html).toContain('Локация на експортираното видео');
    expect(html).toContain('Windows: Z:\\Credissimo\\Реклами 8\\Видео 2 - Промоция');
    expect(html).toContain('Mac: /Volumes/Production/Credissimo/Реклами 8/Видео 2 - Промоция');
    expect((html.match(/ОТВОРИ ПАПКА/g) || []).length).toBe(2);
  });

  test('неразпознато заглавие не добавя нищо', () => {
    expect(fp.locationHtml('Просто задача')).toBe('');
  });

  test('няма как да вкара сурови кавички в href', () => {
    expect(fp.locationHtml('Test" onmouseover="x КП-1')).not.toContain('onmouseover="x');
  });
});
