// Разбиваем корейские слоги на буквы, чтобы поиск работал и по отдельным 자모.
const initials = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const vowels = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
const finals = ['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const lowered = text => text.normalize('NFC').toLocaleLowerCase();
function pieces(text, initialOnly = false) {
  return [...text].map(character => {
    const index = character.codePointAt(0) - 0xac00;
    if (index < 0 || index >= 11172) return character;
    const initial = initials[Math.floor(index / 588)];
    return initialOnly ? initial : initial + vowels[Math.floor(index % 588 / 28)] + finals[index % 28];
  }).join('');
}
export function matchesSearch(word, query) {
  const needle = lowered(query.trim());
  if (!needle) return true;
  const texts = [word.word, word.details?.translation, word.originalInput].filter(Boolean);
  return texts.some(value => {
    const text = lowered(value);
    return text.includes(needle) || pieces(text).includes(pieces(needle)) || pieces(text, true).includes(needle);
  });
}
