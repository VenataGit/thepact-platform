// Архивът на контент плановете (Венци, 22.08.2026).
//
// Тестват се чистите парчета: как се вади клиентът от заглавието, как планът става
// текст (и какво става с прикачените файлове) и как текстът става документ в Basecamp.
// Самите извиквания към Basecamp и опашката се проверяват през мокове.
const mockDb = {
  pool: { query: jest.fn(), end: jest.fn().mockResolvedValue(undefined) },
  query: jest.fn().mockResolvedValue([]),
  queryOne: jest.fn().mockResolvedValue(null),
  execute: jest.fn().mockResolvedValue(undefined),
};
jest.mock('../src/db/pool', () => mockDb);

const arch = require('../src/services/kp-archive');

describe('clientOf — папката, в която отива планът', () => {
  test('вади клиента от „Клиент КП-N"', () => {
    expect(arch.clientOf('Credissimo КП-12')).toBe('Credissimo');
    expect(arch.clientOf('Pulse Fitness КП-3')).toBe('Pulse Fitness');
  });

  test('разпознава и „Клиент - Име на задачата"', () => {
    expect(arch.clientOf('Credissimo - Коледно парти')).toBe('Credissimo');
  });

  test('неразпознато заглавие пада в „Други", вместо да чупи архива', () => {
    expect(arch.clientOf('Нещо съвсем друго')).toBe(arch.OTHER_FOLDER);
    expect(arch.clientOf('')).toBe(arch.OTHER_FOLDER);
  });
});

describe('planToText — планът като обикновен текст', () => {
  test('маха таговете и пази редовете', () => {
    const html = '<div>Дата за публикуване на първо видео: 01.09.2026<br><br>'
      + '<mark style="x">Видео 1 - Лятна кампания</mark><br>Описание:<br>Нещо</div>';
    expect(arch.planToText(html)).toBe(
      'Дата за публикуване на първо видео: 01.09.2026\n\nВидео 1 - Лятна кампания\nОписание:\nНещо'
    );
  });

  test('прикачените файлове остават като име — в текстов архив няма как иначе', () => {
    const html = '<div>Видео 1 - Тест<br></div>'
      + '<bc-attachment sgid="abc" filename="brief.png" content-type="image/png"></bc-attachment>'
      + '<div>Описание:</div>';
    const text = arch.planToText(html);
    expect(text).toContain('[файл: brief.png]');
    expect(text).not.toContain('bc-attachment');
  });

  test('връща entity-тата обратно в четим вид', () => {
    expect(arch.planToText('<div>Reels &amp; Shorts &lt;30 сек&gt;</div>')).toBe('Reels & Shorts <30 сек>');
  });
});

describe('entryText — един запис в архива', () => {
  const entry = arch.entryText('Credissimo КП-12', 'съдържание', '2026-08-22');

  test('започва със заглавен ред с името на плана и датата', () => {
    expect(entry.split('\n')[0]).toContain('Credissimo КП-12');
    expect(entry.split('\n')[0]).toContain('22.08.2026');
  });

  test('носи целия текст на плана', () => {
    expect(entry).toContain('съдържание');
  });
});

describe('textToDocHtml — текстът като документ в Basecamp', () => {
  test('абзаците стават <div>, редовете в тях — <br>', () => {
    expect(arch.textToDocHtml('ред 1\nред 2\n\nвтори абзац'))
      .toBe('<div>ред 1<br>ред 2</div><div>втори абзац</div>');
  });

  test('escape-ва HTML, за да не се чупи документът от текста на плана', () => {
    expect(arch.textToDocHtml('<script>x</script>'))
      .toBe('<div>&lt;script&gt;x&lt;/script&gt;</div>');
  });
});

describe('пътищата на сървърния архив', () => {
  test('всичко живее под Z:\\Контент планове - Архив', () => {
    expect(arch.ARCHIVE_ROOT).toBe('Z:\\Контент планове - Архив');
    expect(arch.MASTER_FILE).toBe('Z:\\Контент планове - Архив\\Всички контент планове.txt');
  });
});
