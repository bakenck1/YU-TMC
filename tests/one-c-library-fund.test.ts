import assert from "node:assert/strict";
import test from "node:test";
import reference from "../lib/data/one-c-library-fund.json";
import { isLibraryFundName, isLibraryFundAsset, libraryFundNameKey } from "../lib/one-c-library-fund";
import { isOneCBook } from "../lib/one-c-book-scope";

test("accounting library fund excludes confirmed titles without book keywords", () => {
  const title = "Әминов Қазіргі қазақстан тарихы в кол-ве 150шт";
  assert.equal(isLibraryFundName(title), true);
  assert.equal(isLibraryFundName(`  ${title.toUpperCase().replaceAll(" ", "\u00a0")}  `), true);
  assert.equal(isOneCBook(title), true);
  assert.equal(isOneCBook("Диск нового китайского учебника 1 серии"), true);
  assert.equal(reference.fixedAssetIds.length, 4306);
  assert.equal(isLibraryFundAsset(reference.fixedAssetIds[0].toUpperCase()), true);
  assert.equal(isOneCBook("Позиция после переименования", reference.fixedAssetIds[0]), true);
  assert.equal(isOneCBook("Позиция после переименования", "00000000-0000-4000-8000-000000000000"), false);
});

test("reference contains asset names only and retains unrelated library furniture", () => {
  assert.equal(reference.accountCode, "2414");
  assert.equal(reference.namedAssetRows, 5860);
  assert.equal(reference.uniqueNames, 5808);
  assert.equal(new Set(reference.nameHashes).size, reference.uniqueNames);
  assert.deepEqual(reference.unnamedAssetRows, [2806]);
  assert.equal(isLibraryFundName("Аманшаева Майра Амирхановна"), false);
  assert.equal(isLibraryFundName("Итого"), false);
  for (const name of ["Стол для книг", "Комплект полок для книг", "Книжный шкаф", "Компьютер для книг"]) {
    assert.equal(isOneCBook(name), false, name);
  }
  assert.equal(libraryFundNameKey("  Й\u00a0 İ \t АБВ  "), "й İ абв");
});
