const en = require('./en.json');
const de = require('./de.json');
const tr = require('./tr.json');
const { ErrorCodes } = require('../../../server/errors');

describe('i18n error translations', () => {
  const errorCodes = Object.values(ErrorCodes);

  it('all ErrorCodes have English translations', () => {
    errorCodes.forEach((code) => {
      expect(en).toHaveProperty([code]);
    });
  });

  it('all ErrorCodes have German translations', () => {
    errorCodes.forEach((code) => {
      expect(de).toHaveProperty([code]);
    });
  });

  it('all ErrorCodes have Turkish translations', () => {
    errorCodes.forEach((code) => {
      expect(tr).toHaveProperty([code]);
    });
  });
});
