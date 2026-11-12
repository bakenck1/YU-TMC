// Shared JS/PostgreSQL expression. Only a property as the subject is excluded;
// location mentions and ambiguous English words such as "flat" are not enough.
const letters = "a-zа-яёәіңғүұқөһ";
const boundary = `([^${letters}]|$)`;
const roomPrefix = "(?:(?:[0-9]+|one|two|three|four)[ -]*(?:(?:х|ти)[ -]*)?(?:комнатн(?:ая|ые)|комн[.]?|бөлмелі|болмели|bedroom|room)[ -]+)?";
const russian = "(?:(?:служебная|жилая|жилые|отдельная|однокомнатная|двухкомнатная|трехкомнатная|трёхкомнатная)[ -]+)*(?:квартира|квартиры|квартиру|квартир|земельный участок|земельные участки|зем[.]? уч[.]?|участок земли|участки земли)";
const kazakh = "(?:(?:қызметтік|кызметтик|тұрғын|тургын|жеке)[ -]+)*(?:пәтер(?:лер(?:і)?|і)?|патер(?:лер(?:и)?|и)?|жер (?:учаске(?:сі|лері|лер)?|телім(?:і|дері)?|телим(?:и|дери)?)|ғимарат(?:ы|тар(?:ы)?)?|гимарат(?:ы|тар(?:ы)?)?|жатақхана(?:сы|лар(?:ы)?)?|жатакхана(?:сы|лар(?:ы)?)?|тұрғын үй(?:лер(?:і)?)?|тургын уй(?:лер(?:и)?)?)";
// English property names can start with an address, but must not capture
// "flat panel monitor", "apartment access terminal" or "land survey receiver".
const english = "(?:(?:residential|staff|service|student|studio)[ -]+)*(?:(?:land(?: (?:plot|parcel))?|plot of land|parcel of land|apartment building|residential building|residential house|dormitory|dormitories|apartments?|flats?)(?:$|[ ]+(?:(?:no[.]?|number|block|building|unit)[ ]*[#№]?[ ]*[0-9]|(?:at|in|on)[ ]+|for (?:housing|construction)(?:[ ]|$)|[0-9])|[ ]*[#№,:;(.-][ ]*[0-9]))";
const transliteration = "(?:kvartira|pater|zher uchaskesi|zher telimi|zemelnyy uchastok|zemelnyi uchastok)";

export const oneCPropertyPattern = `^[^${letters}]*(?:${roomPrefix}(?:${russian}|${kazakh}|${transliteration})${boundary}|${roomPrefix}${english})`;
