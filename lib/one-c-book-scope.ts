import { isLibraryFundName, isLibraryFundAsset, libraryFundNameSql, libraryFundAssetSql } from "@/lib/one-c-library-fund";

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
  "уч[ .-]+лит-ра|самоучител[а-яё]*|сборник[а-яё]*|словар[а-яё]*|справочник[а-яё]*|энциклопеди[а-яё]*",
  "практикум[а-яё]*|методичк[а-яё]*|методич[.]|методическ[а-яё]*[ .-]+(руководств[а-яё]*|пос[.]|указани[а-яё]*|рекомендаци[а-яё]*)",
  "руководство[ .-]+(по|к)|методич[ .-]+(руководств[а-яё]*|руков-о)",
  "оқу[ .-]*әдіст[а-яәіңғүұқөһ]*([ .-]+(құрал[а-яәіңғүұқөһ]*|нұсқау[а-яәіңғүұқөһ]*))?",
  "әдістемелік[ .-]+нұсқау[а-яәіңғүұқөһ]*|әдебиет[а-яәіңғүұқөһ]*",
  "(есептер|өлеңдер|шығармалар|шыгармалар|дәріс|лекциялар|диктанттар|тест|тапсырма)[ .-]+жина[қғг][а-яәіңғүұқөһ]*",
  "[0-9]+([ .,-]+[0-9]+|-[0-9]+)*(-[хx])?[ .-]*том(а|ах|ов|дық|дык)?|том[ .-]+[0-9]+",
  "[0-9]+-[еe][ .-]+изд[.]|год[ .-]+издания|в фонд библиотеки от авт[.]",
].join("|"));
// A physical item is identified by its leading noun. A book's subject may
// mention equipment, resistors, cabinets, etc. without changing its type.
const equipmentHead = [
  "шкаф[а-яё]*|стол(ы|а|ов|ик|ики)?|стул[а-яё]*|стуль[а-яё]*|тумб[а-яё]*|кресл[а-яё]*",
  "стеллаж[а-яё]*|полк(а|и|у|ой|ами)|полок|полочк[а-яё]*|подставк[а-яё]*|держател[а-яё]*",
  "сканер[а-яё]*|принтер[а-яё]*|тележк[а-яё]*|витрин[а-яё]*|сейф[а-яё]*|стенд[а-яё]*",
  "компьютер[а-яё]*|ноутбук[а-яё]*|монитор[а-яё]*|моноблок[а-яё]*|проектор[а-яё]*|планшет[а-яё]*",
  "диск(и|а|ов)?|кассет[а-яё]*|диплом[а-яё]*|комплект мебели|книжный пресс|книгосканер[а-яё]*|кабинет[а-яё]*|каб",
].join("|");
const equipmentPattern = `^[^${letters}]*((комплект|набор)[ .-]+)?(?:[${letters}]+(?:ый|ий|ая|ое|ые|ой|ный|ная)[ .-]+)*(${equipmentHead})([^${letters}]|$)`;
const componentsPattern = token("книг(а|и)[ .-]+(smd[ .-]+)?(резистор[а-яё]*|диод[а-яё]*|конденсатор[а-яё]*)");
const studentRecordsPattern = token("зач[её]тн[а-яё]*[ .-]+книж[а-яё]*");
const protectedPattern = `(${equipmentPattern}|${componentsPattern}|${studentRecordsPattern})`;
const book = new RegExp(bookPattern, "iu");
const equipment = new RegExp(protectedPattern, "iu");

export function isOneCBook(name: string, externalId?: string | null): boolean {
  return isLibraryFundAsset(externalId) || isLibraryFundName(name) || book.test(name) && !equipment.test(name);
}

/** nameExpression is a trusted SQL column/expression supplied by source code. */
export function oneCNonBookSql(nameExpression: string, externalIdExpression?: string): string {
  const name = `lower(translate(coalesce(${nameExpression}, ''), 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯӘІҢҒҮҰҚӨҺ', 'абвгдеёжзийклмнопрстуфхцчшщъыьэюяәіңғүұқөһ'))`;
  const identity = externalIdExpression ? `not (${libraryFundAssetSql(externalIdExpression)}) and ` : "";
  return `(${identity}not (${libraryFundNameSql(nameExpression)}) and (not (${name} ~ '${bookPattern}') or ${name} ~ '${protectedPattern}'))`;
}

export function oneCInventoryNonBookSql(alias: string): string {
  return `(${oneCNonBookSql(`${alias}.name`)} and not exists (
    select 1 from yu_inventory.item_one_c_links library_link
    where library_link.item_id=${alias}.id and ${libraryFundAssetSql("library_link.external_id")}
  ))`;
}
