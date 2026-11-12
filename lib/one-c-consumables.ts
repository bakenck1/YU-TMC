import { libraryFundNameKey, libraryFundNameKeySql } from "@/lib/one-c-library-fund";

const letters = "a-zа-яёәіңғүұқөһ";
const boundary = `([^${letters}]|$)`;
const head = (words: string) => `^[^${letters}]*(?:[${letters}]+(?:ый|ий|ая|ое|ые|ой|ие|яя|ее)[ .-]+)*(${words})${boundary}`;
const anywhere = (words: string) => `(^|[^${letters}])(${words})${boundary}`;

// The equipment's own name takes precedence over incidental interface/supply words.
const equipmentPattern = head([
  "(портативн[а-яё]* |интерактивн[а-яё]* |электрическ[а-яё]* |базов[а-яё]* )*(метеостанци[а-яё]*|станци[а-яё]*|прибор[а-яё]*|аппарат[а-яё]*|установк[а-яё]*)",
  "шкаф[а-яё]*|стол(ы|а|ов|ик|ики)?|стул[а-яё]*|стуль[а-яё]*|тумб[а-яё]*|стеллаж[а-яё]*|стойк[а-яё]*",
  "компьютер(ы|а|ов|у|ом|ами|ах)?|моноблок(и|а|ов|у|ом|ами|ах)?|ноутбук(и|а|ов|у|ом|ами|ах)?|монитор(ы|а|ов|у|ом|ами|ах)?|планшет(ы|а|ов|у|ом|ами|ах)?|сканер(ы|а|ов|у|ом|ами|ах)?|принтер(ы|а|ов|у|ом|ами|ах)?|мфу",
  "программ[а-яё]*|систем[а-яё]*|стенд[а-яё]*|уничтожител[а-яё]*|резак[а-яё]*|ламинатор[а-яё]*|телевизор[а-яё]*|диспле[а-яё]*",
  "доск[а-яё]*|корзин[а-яё]*|держател[а-яё]*|диспенсер[а-яё]*|усилител[а-яё]*|распределител[а-яё]*|источник бесперебойного питания|ибп",
].join("|"));

const rules = [
  { category: "peripherals", pattern: anywhere("(corded |optical |wireless )?mouse|keyboard") },
  { category: "cables", pattern: head("удлинител[а-яё]*"),
    required: anywhere("usb|hdmi|vga|кабел[а-яё]*|проводн[а-яё]*|сетев[а-яё]*"),
    exception: anywhere("беспровод[а-яё]*|сигнал[а-яё]*|передат[а-яё]*") },
  { category: "paper", pattern: head("бумаг(а|и|у|е|ой)|фотобумаг[а-яё]*|ватман[а-яё]*|кальк(а|и|у|е|ой)|бумажн[а-яё]* (салфет[а-яё]*|полотен[а-яё]*)|салфет[а-яё]* бумажн[а-яё]*|полотен[а-яё]* бумажн[а-яё]*"),
    exception: `(^бумага [а-яё][.][ ]?[а-яё][.]|${anywhere("индикаторн[а-яё]*|лакмусов[а-яё]*|фильтровальн[а-яё]*|хроматографическ[а-яё]*|наждачн[а-яё]*|абразивн[а-яё]*")})` },
  { category: "writing", pattern: head("ручк(а|и|у|ой)|карандаш[а-яё]*|маркер[а-яё]*|фломастер[а-яё]*|текстовыделител[а-яё]*"),
    exception: anywhere("двер[а-яё]*|окон[а-яё]*|мебел[а-яё]*|слесар[а-яё]*|свар[а-яё]*|паял[а-яё]*|электрод[а-яё]*|крана|3[ -]?[dд]|филамент[а-яё]*") },
  { category: "fasteners", pattern: anywhere("степлер[а-яё]*|антистеплер[а-яё]*|дырокол[а-яё]*|скрепк[а-яё]*|зажим[а-яё]* (канцел[а-яё]*|для бумаг[иа])|скоб[а-яё]* (для |д/)?степлер[а-яё]*"),
    exception: anywhere("строительн[а-яё]*|скобозабивн[а-яё]*|тип 53") },
  { category: "filing", pattern: head("папк[а-яё]*|файл[а-яё]*|скоросшиват[а-яё]*|обложк[а-яё]*|разделител[а-яё]*|лоток канцелярск[а-яё]*|органайзер канцелярск[а-яё]*") },
  { category: "notebooks", pattern: head("тетрад[а-яё]*|блокнот[а-яё]*|ежедневник[а-яё]*|еженедельник[а-яё]*|стикер[а-яё]*|закладк[а-яё]*|конверт(ы|а|ов|у|ом|ами|ах)?") },
  { category: "small_stationery", pattern: head("ластик[а-яё]*|корректор[а-яё]*|штрих[ -]корректор[а-яё]*|точилк[а-яё]*|линейк[а-яё]*|калькулятор[а-яё]*|ножницы|нож канцелярск[а-яё]*|клей[а-яё]* (карандаш[а-яё]*|канцелярск[а-яё]*|пва)|скотч[а-яё]*|лента клейк[а-яё]*"),
    exception: anywhere("синусн[а-яё]*|поверочн[а-яё]*|лекальн[а-яё]*|строительн[а-яё]*|электрическ[а-яё]*|автоматическ[а-яё]*|пневматическ[а-яё]*|садов[а-яё]*|по металлу|для металла|портновск[а-яё]*|труб[а-яё]*|пласт[.]?труб[а-яё]*") },
  { category: "cables", pattern: head("(usb |hdmi |vga |интерфейсн[а-яё]* |силов[а-яё]* |электрическ[а-яё]* |оптическ[а-яё]* )*(кабел(ь|и|я|ей|ю|ем|ями|ях)|провод(а|ов)?|шнур[а-яё]*|патч[ -]?корд[а-яё]*)|кабель[ -]канал[а-яё]*|кабельн[а-яё]* (канал[а-яё]*|ввод[а-яё]*|наконечник[а-яё]*|соединител[а-яё]*|муфт[а-яё]*)|витая пара") },
  { category: "printer_supplies", pattern: head("картридж[а-яё]*|катридж[а-яё]*|тонер[а-яё]*|чернил[а-яё]*|фотобарабан[а-яё]*|драм[ -]?картридж[а-яё]*|комплект (тонер[ -])?картридж[а-яё]*|тт[a-z0-9/]+ тонер[ -]картридж" ) },
  { category: "printer_supplies", pattern: head("вал[а-яё]*|лезви[а-яё]*|нож[а-яё]*|ролик[а-яё]*|барабан[а-яё]*"),
    required: anywhere("картридж[а-яё]*|захвата бумаги|для принтер[а-яё]*") },
  { category: "peripherals", pattern: head("(компьютерн[а-яё]* |беспроводн[а-яё]* |проводн[а-яё]* |оптическ[а-яё]* |usb )*(мышь|мышк[а-яё]*|клавиат(ур[а-яё]*|ра|ры))|комплект (мышь|клавиатур[а-яё]*)|манип[а-яё]* [\" ]*мышь"),
    exception: anywhere("музыкальн[а-яё]*|фортепиан[а-яё]*|пианино|синтезатор[а-яё]*") },
  { category: "power_accessories", pattern: head("(портативн[а-яё]* |сетев[а-яё]* |универсальн[а-яё]* |usb |hdmi |vga )*(зарядн[а-яё]* устро[йи]ств[а-яё]*|адаптер[а-яё]*|конвертер[а-яё]*|переходник[а-яё]*|блок питания)|hdmi (в|на|to) vga"),
    required: anywhere("зарядн[а-яё]* устро[йи]ств[а-яё]*|блок питания|usb|hdmi|vga|dvi|displayport|sfp|rj[0-9]*|type[ -]?c|для ноутбук[а-яё]*|для принтер[а-яё]*"),
    exception: anywhere("лабораторн[а-яё]*|станци[а-яё]*|электромобил[а-яё]*|водопровод[а-яё]*|сантехническ[а-яё]*") },
] as const;

const equipment = new RegExp(equipmentPattern, "iu");
const compiled = rules.map(rule => ({ ...rule, matcher: new RegExp(rule.pattern, "iu"),
  excluded: "exception" in rule ? new RegExp(rule.exception, "iu") : null,
  requiredMatcher: "required" in rule ? new RegExp(rule.required, "iu") : null }));
export type OneCConsumableCategory = typeof rules[number]["category"];

export function oneCConsumableCategory(name: string): OneCConsumableCategory | null {
  const key = libraryFundNameKey(name);
  if (equipment.test(key)) return null;
  return compiled.find(rule => rule.matcher.test(key) && !rule.excluded?.test(key)
    && (!rule.requiredMatcher || rule.requiredMatcher.test(key)))?.category ?? null;
}

export function isOneCConsumable(name: string): boolean {
  return oneCConsumableCategory(name) !== null;
}

export function oneCConsumableSql(nameExpression: string): string {
  const key = libraryFundNameKeySql(nameExpression);
  const matches = rules.map(rule => `(${key} ~ '${rule.pattern}'${"exception" in rule ? ` and ${key} !~ '${rule.exception}'` : ""}${"required" in rule ? ` and ${key} ~ '${rule.required}'` : ""})`);
  return `(${key} !~ '${equipmentPattern}' and (${matches.join(" or ")}))`;
}
