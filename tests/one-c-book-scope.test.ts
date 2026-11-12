import assert from "node:assert/strict";
import test from "node:test";
import { isOneCBook } from "../lib/one-c-book-scope";

test("excludes book records while retaining furniture and library equipment", () => {
  for (const name of ["Книги", "Книга на сумму за май", "КНИГИ от ТОО Бастау", "Набор книг", "Учебники по физике", "Библиотечный фонд", "Кітаптар", "канцелярский книга для документов"]) {
    assert.equal(isOneCBook(name), true, name);
  }
  for (const name of ["Стол для книг", "Шкаф книжный", "Книжный шкаф", "Полка для книг", "Стеллаж для книг", "Сканер для книг", "Тележка для книг", "Книжный пресс", "ПСД по зданию библиотеки", "Компьютер в библиотеке", "Ноутбук", "Подставка для книг", "Диск китайского учебника", "Кассеты учебника", "Диплом (книжка вариант)", "Зачетные книжки"]) {
    assert.equal(isOneCBook(name), false, name);
  }
  assert.equal(isOneCBook("книга резисторов 170 видов по 25 шт"), false);
  assert.equal(isOneCBook("книга SMD диодов"), false);
});
