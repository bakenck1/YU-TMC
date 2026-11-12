// The same name rule is used in memory and in paginated PostgreSQL registries.
// Explicit Cyrillic boundaries also work in databases using the C locale.
const letters = "a-zа-яёәіңғүұқөһ";
const token = (value: string) => `(^|[^${letters}])(${value})([^${letters}]|$)`;
const bookPattern = token("книг(а|и|у|е|ой|ою|ам|ами|ах)?|книж(ка|ки|ек|ку|ке|кой|кам|ками|ках)|книжный фонд|книжная продукция|библиотечный фонд|кітап(тар|тары|хана қоры)?|учебник(и|ов|а)?|учебное пособие|учебные пособия");
const equipmentPattern = token("шкаф([а-яё]*)|стол(ы|а|ов|ик|ики)?|стеллаж([а-яё]*)|полк(а|и|у|ой|ами)|полочк([а-яё]*)|подставк([а-яё]*)|держател([а-яё]*)|сканер([а-яё]*)|принтер([а-яё]*)|тележк([а-яё]*)|витрин([а-яё]*)|сейф([а-яё]*)|стенд([а-яё]*)|оборудование|комплект мебели|книжный пресс|книгосканер([а-яё]*)|диск(и|а|ов)?|кассет([а-яё]*)|диплом([а-яё]*)|зачетн([а-яё]*)|зачётн([а-яё]*)");
const componentsPattern = token("резистор([а-яё]*)|диод([а-яё]*)|конденсатор([а-яё]*)|smd");
const protectedPattern = `(${equipmentPattern}|${componentsPattern})`;
const book = new RegExp(bookPattern, "iu");
const equipment = new RegExp(protectedPattern, "iu");

export function isOneCBook(name: string): boolean {
  return book.test(name) && !equipment.test(name);
}

/** nameExpression is a trusted SQL column/expression supplied by source code. */
export function oneCNonBookSql(nameExpression: string): string {
  const name = `lower(translate(coalesce(${nameExpression}, ''), 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯӘІҢҒҮҰҚӨҺ', 'абвгдеёжзийклмнопрстуфхцчшщъыьэюяәіңғүұқөһ'))`;
  return `(not (${name} ~ '${bookPattern}') or ${name} ~ '${protectedPattern}')`;
}
