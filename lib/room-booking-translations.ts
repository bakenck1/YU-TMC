export const roomBookingRu = {
  "room.bookingTitle": "Онлайн-запись",
  "room.bookingDescription": "Выберите удобное время приёма в этом кабинете в YU Zapis.",
  "room.bookingAction": "Записаться в кабинет",
  "room.bookingSoon": "Скоро",
  "room.bookingSoonDescription": "Онлайн-запись в кабинеты скоро появится. Здесь можно будет выбрать удобное время приёма.",
} as const;

export const roomBookingKk: Record<keyof typeof roomBookingRu, string> = {
  "room.bookingTitle": "Онлайн жазылу",
  "room.bookingDescription": "YU Zapis арқылы осы кабинетте қабылдауға ыңғайлы уақытты таңдаңыз.",
  "room.bookingAction": "Кабинетке жазылу",
  "room.bookingSoon": "Жақында",
  "room.bookingSoonDescription": "Жақында кабинеттерге онлайн жазылу қолжетімді болады. Осы жерден қабылдауға ыңғайлы уақытты таңдай аласыз.",
};

export const roomBookingEn: Record<keyof typeof roomBookingRu, string> = {
  "room.bookingTitle": "Online appointments",
  "room.bookingDescription": "Choose a convenient appointment time for this office in YU Zapis.",
  "room.bookingAction": "Book an appointment",
  "room.bookingSoon": "Coming soon",
  "room.bookingSoonDescription": "Online office appointments are coming soon. You will be able to choose a convenient time here.",
};
