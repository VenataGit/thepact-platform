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

describe('вратичката — задача извън КП/РЕК/КМП', () => {
  test('„Клиент - Име" дава папка в главната папка на клиента', () => {
    expect(fp.parseFreeTitle('Credissimo - Кастинг')).toMatchObject({
      kind: 'free', client: 'Credissimo', name: 'Кастинг',
    });
  });

  test('останалата част остава цяла, дори с още тирета', () => {
    expect(fp.parseFreeTitle('Fornetti - Видео 3 - Заглавие').name).toBe('Видео 3 - Заглавие');
  });

  test('пътищата минават покрай блока — папката е направо при клиента', () => {
    const p = fp.pathsForTitle('Credissimo - Коледно парти 2025');
    expect(p.files.win).toBe('Z:\\Credissimo\\Коледно парти 2025');
    expect(p.exported.win).toBe('Z:\\Exported Videos\\Credissimo\\Коледно парти 2025');
    expect(p.parsed.kind).toBe('free');
  });

  test('префиксът винаги печели пред вратичката', () => {
    expect(fp.pathsForTitle('Credissimo КП-12 - Видео 4 - Как се прави').parsed.kind).toBe('kp');
  });

  test('без тире с интервали не гадаем кой е клиентът', () => {
    expect(fp.parseFreeTitle('Кастинг')).toBeNull();
    expect(fp.parseFreeTitle('Credissimo-Кастинг')).toBeNull();
  });

  test('почти-правилно заглавие не се разцепва на глупости', () => {
    // „Credissimo ADS-8" — тирето е без интервали, значи не е разделител.
    expect(fp.pathsForTitle('Credissimo ADS-8 - Видео 2')).toBeNull();
  });

  test('вратичката дава същия блок с двата пътя и линка', () => {
    const html = fp.locationLines('Credissimo - Кастинг').join('\n');
    expect(html).toContain('Z:\\Credissimo\\Кастинг');
    expect(html).toContain('/Volumes/Production/Credissimo/Кастинг');
    expect((html.match(/ОТВОРИ ПАПКА/g) || []).length).toBe(2);
  });
});

describe('splitForLocation — блокът стои горе', () => {
  const SECTION = [
    'Видео 4 - Как се прави',
    '/Участници - ХХХ/',
    '/Локация - ХХХ/',
    '/Необходими ресурси - ХХХ/',
    '',
    'Описание:',
    'ХХХ',
    '',
    'Копи: ХХХ',
  ].join('\n');

  test('реже точно преди „Описание:"', () => {
    const s = fp.splitForLocation(SECTION);
    expect(s.before.split('\n').pop()).toBe('/Необходими ресурси - ХХХ/');
    expect(s.after.split('\n')[0]).toBe('Описание:');
  });

  test('без „Описание:" реже след водещите /…/ редове', () => {
    const s = fp.splitForLocation('Видео 1 - Тест\n/Участници - ХХХ/\n\nКопи: ХХХ');
    expect(s.before).toBe('Видео 1 - Тест\n/Участници - ХХХ/');
    expect(s.after).toBe('Копи: ХХХ');
  });

  test('без нищо разпознаваемо блокът пада най-отдолу', () => {
    const s = fp.splitForLocation('Просто текст\nвтори ред');
    expect(s.after).toBe('');
    expect(s.before).toBe('Просто текст\nвтори ред');
  });

  test('празен текст не гърми', () => {
    expect(fp.splitForLocation('')).toEqual({ before: '', after: '' });
  });
});

describe('locationLines — подредба', () => {
  test('двата блока са слепени, както ги иска Венци', () => {
    const html = fp.locationLines('Credissimo - Тестова задача').join('\n');
    expect(html.indexOf('Локация на файлове:')).toBeLessThan(html.indexOf('Локация на експортираното видео:'));
    expect(html).toContain('Z:\\Credissimo\\Тестова задача');
    expect(html).toContain('Z:\\Exported Videos\\Credissimo\\Тестова задача');
  });

  test('връща редове, не блокове — вграждат се в общия Trix блок', () => {
    const lines = fp.locationLines('Credissimo КП-1');
    expect(lines).toHaveLength(8);
    expect(lines.join('')).not.toContain('<div>');
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

describe('locationLines', () => {
  const html = fp.locationLines('Credissimo РЕК-8 - Видео 2 - Промоция').join('\n');

  test('носи двата пътя и работещия линк', () => {
    expect(html).toContain('Локация на файлове');
    expect(html).toContain('Локация на експортираното видео');
    expect(html).toContain('Z:\\Credissimo\\Реклами 8\\Видео 2 - Промоция');
    expect(html).toContain('/Volumes/Production/Credissimo/Реклами 8/Видео 2 - Промоция');
    expect((html.match(/ОТВОРИ ПАПКА/g) || []).length).toBe(2);
  });

  test('пред пътищата НЯМА етикети „Windows:" / „Mac:" (Венци, 22.08.2026)', () => {
    expect(html).not.toContain('Windows:');
    expect(html).not.toContain('Mac:');
  });

  test('двете заглавия са ОЦВЕТЕНИ, а не удебелени', () => {
    expect(html).toContain('<mark style="background-color: rgb(250, 247, 133);">Локация на файлове:</mark>');
    expect(html).toContain('<mark style="background-color: rgb(250, 247, 133);">Локация на експортираното видео:</mark>');
    expect(html).not.toContain('<strong>');
  });

  test('неразпознато заглавие не добавя нищо', () => {
    expect(fp.locationLines('Просто задача')).toEqual([]);
  });

  test('няма как да вкара сурови кавички в href', () => {
    expect(fp.locationLines('Test" onmouseover="x КП-1').join('')).not.toContain('onmouseover="x');
  });
});
