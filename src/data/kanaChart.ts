export interface KanaCell {
  romaji: string;
  hiragana: string;
  katakana: string;
  sampleWordJa: string;
  sampleReading: string;
  sampleMeaning: string;
}

export const KANA_ROWS: ReadonlyArray<ReadonlyArray<KanaCell | null>> = [
  [
    { romaji: "a", hiragana: "あ", katakana: "ア", sampleWordJa: "あさ", sampleReading: "asa", sampleMeaning: "morning" },
    { romaji: "i", hiragana: "い", katakana: "イ", sampleWordJa: "いま", sampleReading: "ima", sampleMeaning: "now" },
    { romaji: "u", hiragana: "う", katakana: "ウ", sampleWordJa: "うみ", sampleReading: "umi", sampleMeaning: "sea" },
    { romaji: "e", hiragana: "え", katakana: "エ", sampleWordJa: "えき", sampleReading: "eki", sampleMeaning: "station" },
    { romaji: "o", hiragana: "お", katakana: "オ", sampleWordJa: "おちゃ", sampleReading: "ocha", sampleMeaning: "green tea" },
  ],
  [
    { romaji: "ka", hiragana: "か", katakana: "カ", sampleWordJa: "かさ", sampleReading: "kasa", sampleMeaning: "umbrella" },
    { romaji: "ki", hiragana: "き", katakana: "キ", sampleWordJa: "きっぷ", sampleReading: "kippu", sampleMeaning: "ticket" },
    { romaji: "ku", hiragana: "く", katakana: "ク", sampleWordJa: "くうこう", sampleReading: "kuukou", sampleMeaning: "airport" },
    { romaji: "ke", hiragana: "け", katakana: "ケ", sampleWordJa: "けさ", sampleReading: "kesa", sampleMeaning: "this morning" },
    { romaji: "ko", hiragana: "こ", katakana: "コ", sampleWordJa: "ここ", sampleReading: "koko", sampleMeaning: "here" },
  ],
  [
    { romaji: "sa", hiragana: "さ", katakana: "サ", sampleWordJa: "さかな", sampleReading: "sakana", sampleMeaning: "fish" },
    { romaji: "shi", hiragana: "し", katakana: "シ", sampleWordJa: "しお", sampleReading: "shio", sampleMeaning: "salt" },
    { romaji: "su", hiragana: "す", katakana: "ス", sampleWordJa: "すし", sampleReading: "sushi", sampleMeaning: "sushi" },
    { romaji: "se", hiragana: "せ", katakana: "セ", sampleWordJa: "せかい", sampleReading: "sekai", sampleMeaning: "world" },
    { romaji: "so", hiragana: "そ", katakana: "ソ", sampleWordJa: "そと", sampleReading: "soto", sampleMeaning: "outside" },
  ],
  [
    { romaji: "ta", hiragana: "た", katakana: "タ", sampleWordJa: "たまご", sampleReading: "tamago", sampleMeaning: "egg" },
    { romaji: "chi", hiragana: "ち", katakana: "チ", sampleWordJa: "ちず", sampleReading: "chizu", sampleMeaning: "map" },
    { romaji: "tsu", hiragana: "つ", katakana: "ツ", sampleWordJa: "つぎ", sampleReading: "tsugi", sampleMeaning: "next" },
    { romaji: "te", hiragana: "て", katakana: "テ", sampleWordJa: "てがみ", sampleReading: "tegami", sampleMeaning: "letter" },
    { romaji: "to", hiragana: "と", katakana: "ト", sampleWordJa: "とけい", sampleReading: "tokei", sampleMeaning: "clock" },
  ],
  [
    { romaji: "na", hiragana: "な", katakana: "ナ", sampleWordJa: "なつ", sampleReading: "natsu", sampleMeaning: "summer" },
    { romaji: "ni", hiragana: "に", katakana: "ニ", sampleWordJa: "にく", sampleReading: "niku", sampleMeaning: "meat" },
    { romaji: "nu", hiragana: "ぬ", katakana: "ヌ", sampleWordJa: "ぬの", sampleReading: "nuno", sampleMeaning: "cloth" },
    { romaji: "ne", hiragana: "ね", katakana: "ネ", sampleWordJa: "ねこ", sampleReading: "neko", sampleMeaning: "cat" },
    { romaji: "no", hiragana: "の", katakana: "ノ", sampleWordJa: "のみもの", sampleReading: "nomimono", sampleMeaning: "drink" },
  ],
  [
    { romaji: "ha", hiragana: "は", katakana: "ハ", sampleWordJa: "はし", sampleReading: "hashi", sampleMeaning: "chopsticks" },
    { romaji: "hi", hiragana: "ひ", katakana: "ヒ", sampleWordJa: "ひだり", sampleReading: "hidari", sampleMeaning: "left" },
    { romaji: "fu", hiragana: "ふ", katakana: "フ", sampleWordJa: "ふくろ", sampleReading: "fukuro", sampleMeaning: "bag" },
    { romaji: "he", hiragana: "へ", katakana: "ヘ", sampleWordJa: "へや", sampleReading: "heya", sampleMeaning: "room" },
    { romaji: "ho", hiragana: "ほ", katakana: "ホ", sampleWordJa: "ほん", sampleReading: "hon", sampleMeaning: "book" },
  ],
  [
    { romaji: "ma", hiragana: "ま", katakana: "マ", sampleWordJa: "まち", sampleReading: "machi", sampleMeaning: "town" },
    { romaji: "mi", hiragana: "み", katakana: "ミ", sampleWordJa: "みず", sampleReading: "mizu", sampleMeaning: "water" },
    { romaji: "mu", hiragana: "む", katakana: "ム", sampleWordJa: "むりょう", sampleReading: "muryou", sampleMeaning: "free of charge" },
    { romaji: "me", hiragana: "め", katakana: "メ", sampleWordJa: "めいし", sampleReading: "meishi", sampleMeaning: "business card" },
    { romaji: "mo", hiragana: "も", katakana: "モ", sampleWordJa: "もの", sampleReading: "mono", sampleMeaning: "thing" },
  ],
  [
    { romaji: "ya", hiragana: "や", katakana: "ヤ", sampleWordJa: "やさい", sampleReading: "yasai", sampleMeaning: "vegetables" },
    null,
    { romaji: "yu", hiragana: "ゆ", katakana: "ユ", sampleWordJa: "ゆき", sampleReading: "yuki", sampleMeaning: "snow" },
    null,
    { romaji: "yo", hiragana: "よ", katakana: "ヨ", sampleWordJa: "よる", sampleReading: "yoru", sampleMeaning: "evening" },
  ],
  [
    { romaji: "ra", hiragana: "ら", katakana: "ラ", sampleWordJa: "らいねん", sampleReading: "rainen", sampleMeaning: "next year" },
    { romaji: "ri", hiragana: "り", katakana: "リ", sampleWordJa: "りょこう", sampleReading: "ryokou", sampleMeaning: "travel" },
    { romaji: "ru", hiragana: "る", katakana: "ル", sampleWordJa: "るす", sampleReading: "rusu", sampleMeaning: "out of home" },
    { romaji: "re", hiragana: "れ", katakana: "レ", sampleWordJa: "れきし", sampleReading: "rekishi", sampleMeaning: "history" },
    { romaji: "ro", hiragana: "ろ", katakana: "ロ", sampleWordJa: "ろく", sampleReading: "roku", sampleMeaning: "six" },
  ],
  [
    { romaji: "wa", hiragana: "わ", katakana: "ワ", sampleWordJa: "わたし", sampleReading: "watashi", sampleMeaning: "I / me" },
    null,
    { romaji: "wo", hiragana: "を", katakana: "ヲ", sampleWordJa: "みずを", sampleReading: "mizu o", sampleMeaning: "object marker" },
    null,
    { romaji: "n", hiragana: "ん", katakana: "ン", sampleWordJa: "にほん", sampleReading: "nihon", sampleMeaning: "Japan" },
  ],
];
