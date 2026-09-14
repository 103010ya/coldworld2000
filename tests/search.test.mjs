import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesSearch } from '../search.js';
test('корейское слово находится по слогу, гласной и первым буквам', () => {
  const word={word:'하다',originalInput:'делать',details:{translation:'делать'}};
  for(const query of ['ㅎ','ㅏ','ㅎㄷ','하','하다','дел']) assert.equal(matchesSearch(word,query),true,query);
  assert.equal(matchesSearch(word,'먹'),false);
});
test('поиск видит исходный английский ввод после перевода', () => {
  assert.equal(matchesSearch({word:'사과',originalInput:'apple',details:{translation:'яблоко'}},'APP'),true);
});
