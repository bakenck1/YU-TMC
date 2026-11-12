// The same name rule is used in memory and in paginated PostgreSQL registries.
// Explicit Cyrillic boundaries also work in databases using the C locale.
const letters = "a-zа-яёәіңғүұқөһ";
const token = (value: string) => `(^|[^${letters}])(${value})([^${letters}]|$)`;
const bookPattern = token([
  "книг(а|и|у|е|ой|ою|ам|ами|ах)?",
  "кни-и",
  "книж(ка|ки|ек|ку|ке|кой|кам|ками|ках)",
  "книжный фонд|книжная продукция|библиотечный фонд",
  "кітап(тар|тары|хана қоры)?|оқулық[а-яәіңғүұқөһ]*|оқу[ .-]+қ[ұу]р[аa]л[а-яәіңғүұқөһ]*|әдістемелік құрал",
  "учебник[а-яё]*|литератур(а|ы|у|е|ой)|хрестомати[а-яё]*|монограф[а-яё]*",
  "учебн[а-яё]*[ .-]+(литератур[а-яё]*|лит-ра|лит[.]|пособ[а-яё]*)",
  "(учеб|уч|методическ[а-яё]*|метод)[ .-]+пособ[а-яё]*|уч[ .-]+метод[ .-]+пособ[а-яё]*",
  "учебно-методическ[а-яё]*",
].join("|"));
// A physical item is identified by its leading noun. A book's subject may
// mention equipment, resistors, cabinets, etc. without changing its type.
const equipmentHead = [
  "шкаф[а-яё]*|стол(ы|а|ов|ик|ики)?|стул[а-яё]*|стуль[а-яё]*|тумб[а-яё]*|кресл[а-яё]*",
  "стеллаж[а-яё]*|полк(а|и|у|ой|ами)|полочк[а-яё]*|подставк[а-яё]*|держател[а-яё]*",
  "сканер[а-яё]*|принтер[а-яё]*|тележк[а-яё]*|витрин[а-яё]*|сейф[а-яё]*|стенд[а-яё]*",
  "компьютер[а-яё]*|ноутбук[а-яё]*|монитор[а-яё]*|моноблок[а-яё]*|проектор[а-яё]*|планшет[а-яё]*",
  "диск(и|а|ов)?|кассет[а-яё]*|диплом[а-яё]*|комплект мебели|книжный пресс|книгосканер[а-яё]*|кабинет[а-яё]*|каб",
].join("|");
const equipmentPattern = `^[^${letters}]*(?:[${letters}]+(?:ый|ий|ая|ое|ые|ой|ая|ный|ная)[ .-]+)*(${equipmentHead})([^${letters}]|$)`;
const componentsPattern = token("книг(а|и)[ .-]+(smd[ .-]+)?(резистор[а-яё]*|диод[а-яё]*|конденсатор[а-яё]*)");
const studentRecordsPattern = token("зач[её]тн[а-яё]*[ .-]+книж[а-яё]*");
const protectedPattern = `(${equipmentPattern}|${componentsPattern}|${studentRecordsPattern})`;
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
