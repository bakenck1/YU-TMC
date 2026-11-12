import assert from "node:assert/strict";
import test from "node:test";
import { isOneCExcludedSource } from "../lib/one-c-integration-scope";
import { oneCSecondaryExclusionCategory } from "../lib/one-c-secondary-scope";
import { excludedProperties, retainedPropertyEquipment } from "./helpers/one-c-property-cases";

test("recognizes property subjects in Russian, Kazakh and English without excluding their equipment", () => {
  for (const name of excludedProperties) {
    assert.equal(oneCSecondaryExclusionCategory(name), "real_estate", name);
    assert.equal(isOneCExcludedSource(name, null, "new-code"), true, name);
  }
  for (const name of retainedPropertyEquipment) {
    assert.equal(oneCSecondaryExclusionCategory(name), null, name);
    assert.equal(isOneCExcludedSource(name, null, "new-code"), false, name);
  }
});

test("excludes the requested subjects and new records of the same groups", () => {
  for (const name of [
    "ПСД по зданию библиотеки 32 мкр", "ПСД автономной котельной от 25.07.11",
    "Земельный участок для эксплуатации инженерных сетей", "Здание учебного корпуса", "2-х этажная пристройка уч. корпус",
    "Опорная плита в чемодане", "Универсальный счетчик", "Барометрическая формула высоты",
    "Si-фотодетектор с усилителем 12.12.11", "Ху-манипулятор", "Вешалка металлическая напольная 10 крючков от 11.07.25",
    "Светильник от 03.04.2023", "СВЕТОДИОДНЫЙ\u00a0накладной светильник", "Модель структуры ДНК", "Прибор для демонстрации теплопроводности",
    "Пищеварительный тракт (1 планшет 415*660мм)", "Кровеносные и дыхательные системы", "Скелет человека на штативе",
    "Штатив лабораторный комбинированный", "Базовая установка системы Кобра 3", "Опорная конструкция ПАЛЬМА",
  ]) {
    assert.notEqual(oneCSecondaryExclusionCategory(name), null, name);
    assert.equal(isOneCExcludedSource(name, null, "new-code"), true, name);
  }
});

test("does not confuse subjects, furniture collections and required components with excluded groups", () => {
  for (const name of [
    "Сервер в здании библиотеки", "Блок питания светильника", "Компьютер для лабораторных опытов",
    "Сетевой коммутатор общежития", "Видеокамера со светильником", "Терминал контроля доступа здания",
    "Системный блок для учебной модели", "Сейф в котельной", "Кронштейн для светильника",
    "Шкаф для ПСД", "Коллекция АРТ волна ФГ-120 изд (один стол 4 стулья)",
    "Дополнительные программные модели симулятора K-Sim Engine", "Материнская плата", "Модуль оптический SFP",
    "Штатив для видеокамеры", "Базовый пульт с микрофоном", "Прибор для анализа воды", "Планшет Samsung",
  ]) {
    assert.equal(oneCSecondaryExclusionCategory(name), null, name);
    assert.equal(isOneCExcludedSource(name, null, "new-code"), false, name);
  }
});
