import { libraryFundNameKey, libraryFundNameKeySql } from "@/lib/one-c-library-fund";

const letters = "a-zа-яёәіңғүұқөһ";
const head = (words: string) => `^[^${letters}]*(?:[${letters}]+(?:ый|ий|ая|ое|ые|ой|ие|яя|ее)[ .-]+)*(?:${words})([^${letters}]|$)`;

// Match the subject of the name, never an incidental mention of lighting,
// a building, or an educational use of a computer.
const rules = [
  { category: "hangers", pattern: head("вешалк[а-яё]*") },
  { category: "lighting", pattern: head("светильник[а-яё]*|люстр[а-яё]*|прожектор[а-яё]*|осветител[а-яё]*|светодиодн[а-яё]* панел[а-яё]*|жарыкдиодты панель|led светильник") },
  { category: "teaching_aids", pattern: head("модель|модели|макет[а-яё]*|коллекци[а-яё]*|маятник[а-яё]*|микролаборатори[а-яё]*|микролабоооратори[а-яё]*|демонстрац[а-яё.]* комплект[а-яё]*|лабораторн[а-яё]* (комплект[а-яё]*|набор[а-яё]*)|опорн[а-яё]* плит[а-яё]*|универсальн[а-яё]* счетчик|универсальн[а-яё]* счётчик|si[ -]фотодетектор[а-яё]*|ху[ -]манипулятор|xy[ -]манипулятор|щель регулируемая|шар паскаля|шар с кольцом|сосуды сообщающ[а-яё]*|стрелки магнитн[а-яё]*|магнит (дугообразн[а-яё]*|полосов[а-яё]*|лабораторн[а-яё]*)|капсула из металла|трубка ньютона|ведерко архимеда|рычаг линейка|желоб лабораторн[а-яё]*|вогнутое и выпуклое зеркало|теллурий|небесн[а-яё]* сфер[а-яё]*|камертон[а-яё]*|пистолет баллистическ[а-яё]*|реохорд демонстрационн[а-яё]*|магазин сопротивлени[а-яё]*|прибор (для |д/)?демонстрац[а-яё.]*|прибор (для |д/)?изуч[а-яё.]* газов[а-яё]* закон[а-яё]*|лаборат[.] стенд по физике|механическ[а-яё]* модель броуновск[а-яё]* движения молекул|машина электрофорная") },
  { category: "teaching_experiments", pattern: head("барометрическ[а-яё]* формул[а-яё]* высоты|максвелловск[а-яё]* распределени[а-яё]* скорост[а-яё]*|электропроводность и теплопроводность металлов|изучение момента инерции|уравнение состояния идеальн[а-яё]* газов|сохранение энергии|фотосинтез|изотермы адсорбции|диаграмма точки кипения|повышение точки кипения|определение (поверхности натяжения|энтальпии гидратации)|влияние температуры почвы") },
  { category: "teaching_parts", pattern: head("пищеварительн[а-яё]* тракт|кровеносн[а-яё]* и дыхательн[а-яё]* систем[а-яё]*|скелет человека|штатив (лабораторн[а-яё]*|лабоаторн[а-яё]*|лаборат[.])|форма (балочек|куба)|базов[а-яё]* (прибор|установк[а-яё]*)[ ]+(системы[ ]+)?[\"]?кобра[ ]?3|опорная конструкция пальма") },
] as const;
const teachingException = "(^|[^a-zа-яёәіңғүұқөһ])(программ[а-яё]*|симулятор[а-яё]*|стол|столы|стулья|мебель)([^a-zа-яёәіңғүұқөһ]|$)";
const teachingExceptionMatcher = new RegExp(teachingException, "iu");
const compiled = rules.map(rule => ({ ...rule, matcher: new RegExp(rule.pattern, "iu") }));

export function oneCSecondaryExclusionCategory(name: string): typeof rules[number]["category"] | null {
  const key = libraryFundNameKey(name);
  return compiled.find(rule => rule.matcher.test(key) && (rule.category !== "teaching_aids" || !teachingExceptionMatcher.test(key)))?.category ?? null;
}

export function oneCSecondaryExcludedSql(expression: string): string {
  return `(select (${rules.map(rule => `(secondary_name ~ '${rule.pattern}'${rule.category === "teaching_aids" ? ` and secondary_name !~ '${teachingException}'` : ""})`).join(" or ")})
    from (select ${libraryFundNameKeySql(expression)} as secondary_name offset 0) secondary_scope)`;
}
