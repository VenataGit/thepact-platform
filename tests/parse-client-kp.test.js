// Името на клиента от заглавието на картата — без разделителя пред „КП".
const { parseClientKp } = require('../src/services/bc-aggregate');

describe('parseClientKp', () => {
  test.each([
    ['Sirvis - КП-3', 'Sirvis', 3],
    ['Lady Popular – КП 2', 'Lady Popular', 2],
    ['RoboHubPro КП-2', 'RoboHubPro', 2],
    ['Aula.bg КП-29 Видео 4', 'Aula.bg', 29],
    ['Grand Hotel Sveti Vlas: KP 07', 'Grand Hotel Sveti Vlas', 7],
    ['Adecco -  КП-1', 'Adecco', 1],
  ])('%s', (title, client, kp) => {
    expect(parseClientKp(title)).toEqual({ client, kp });
  });

  test('без КП → null', () => {
    expect(parseClientKp('Обща задача')).toBeNull();
    expect(parseClientKp('- КП-3')).toBeNull();
  });
});
