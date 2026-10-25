// Edith – Sprachassistent der Zentrale
//
// Aufbau:
//   1. Wortlisten & Muster   – hier wird Edith "trainiert" (neue Formulierungen ergänzen)
//   2. Verstehen             – Datum, Uhrzeit, Wiederholung und Titel aus einem Satz lesen
//   3. Gespräch              – Befehle ausführen, bei fehlenden Angaben nachfragen
//   4. Hören & Sprechen      – Spracherkennung (Browser), Aktivierungswort, Sprachausgabe
//   5. Oberfläche            – Knopf unten links, Gesprächsfenster, Status in den Einstellungen
//
// Nutzt Funktionen der Hauptseite (index.html): openCalendar, goHome, renderCalendar, openEditor,
// closeEditor, positionEditor, updateRepeatControls, upcomingEvents, berlinStamp, dateFromIso, …
(() => {
  'use strict';

  // ======================================================================
  // 1. Wortlisten & Muster
  // ======================================================================

  // Wortgrenze, die auch Umlaute als Buchstaben zählt (\b in JavaScript kennt nur a–z)
  const LETTER = 'a-zäöüß0-9';
  const BOUNDARY = `(?:(?<![${LETTER}])(?=[${LETTER}])|(?<=[${LETTER}])(?![${LETTER}]))`;
  const rx = (source, flags = 'g') => new RegExp(source.replaceAll('\\b', BOUNDARY), flags);

  // Aktivierungswort "Edith" – so kann es die Spracherkennung schreiben: Edef, Edeff, Edith, Edit, E-Def, Idef, …
  const WAKE_WORD = rx(String.raw`\b(?:hey\s+|hallo\s+|ok(?:ay)?\s+)?(?:e|ee|ä|i|ei|ai)\s*-?\s*(?:d|dd|t)\s*-?\s*(?:e|ä|i)\s*-?\s*(?:f|ff|v|w|th|t|ph)\b`);

  const CANCEL = rx(String.raw`\b(abbrechen|abbruch|stopp|stop|vergiss es|lass es|lass gut sein)\b`, '');
  const YES = rx(String.raw`^\s*(ja|jo|jap|jawohl|genau|richtig|passt|stimmt|korrekt|ok|okay|gut|super|perfekt|gerne|sicher|mach|speichern|eintragen)\b`, '');
  const NO = rx(String.raw`^\s*(nein|nee|ne|nö|noe|falsch|nicht)\b`, '');

  const MONTHS = {
    januar: 1, jänner: 1, jaenner: 1, februar: 2, märz: 3, maerz: 3, april: 4, mai: 5, juni: 6,
    juli: 7, august: 8, september: 9, oktober: 10, november: 11, dezember: 12
  };
  const MONTH_NAMES = Object.keys(MONTHS).join('|');
  const WEEKDAYS = { sonntag: 0, montag: 1, dienstag: 2, mittwoch: 3, donnerstag: 4, freitag: 5, samstag: 6 };
  const WEEKDAY_NAMES = Object.keys(WEEKDAYS).join('|');

  // Zahl als Ziffer oder als Wort ("17", "siebzehnten", "zehn")
  const NUM = '(\\d{1,2}|[a-zäöüß]+)';

  // Wiederholungen
  const REPEAT_PATTERNS = [
    ['daily', String.raw`\b(jeden tag|täglich|taeglich|alle tage)\b`],
    ['weekly', String.raw`\b(jede woche|jeder woche|wöchentlich|woechentlich|einmal pro woche|einmal die woche|einmal in der woche)\b`],
    ['yearly', String.raw`\b(jedes jahr|jährlich|jaehrlich|alle jahre|einmal im jahr|einmal pro jahr)\b`],
    ['none', String.raw`\b(keine wiederholung|nicht wiederholen|ohne wiederholung|nicht wiederholt|einmalig)\b`]
  ];
  const MONTHLY = String.raw`\b(jeden monat|monatlich)\b`;
  const COUNT_ONCE = String.raw`\b(nur einmal|nur ein mal|nur ein einziges mal|einmal wiederholen|ein mal wiederholen|einmal wiederholt|nur eine wiederholung)\b`;
  const COUNT_FOREVER = String.raw`\b(für immer|fuer immer|dauerhaft|unbegrenzt|immer wieder)\b`;

  // Füllwörter, die am Anfang/Ende eines Termin-Titels wegfallen
  // ("Trag am 17. Oktober Zahnarzt ein" → "Zahnarzt")
  const LEADING_FILLERS = new Set(`
    bitte hey hallo okay ok also ähm äh hm so und noch auch gerne
    trag trage trägst mach mache machst erstell erstelle setz setze leg lege notier notiere füg füge
    schreib schreibe plan plane planen kannst könntest würdest du mir mal uns
    einen ein eine neuen neues neue termin termine eintrag
    am um für fuer den dem der die das zum zur im in an als
    kalender meinen meinem mein meine mit titel namens folgendes dass ich wir hab habe haben
    hinzu es ist wird soll da sich aber nur dann danach wiederholen wiederholt
  `.trim().split(/\s+/));
  const TRAILING_FILLERS = new Set(`
    ein eintragen an hinzu bitte rein hinein auf notieren festlegen festhalten machen setzen
    planen legen speichern im in kalender meinen meinem mein den dem am um für fuer termin
    eintrag ab und da ist hast danke soll sich wiederholen wiederholt wiederholung werden wird
    aber nur dann
  `.trim().split(/\s+/));

  // Zahlwörter
  const NUMBER_WORDS = {
    null: 0, eins: 1, ein: 1, zwei: 2, zwo: 2, drei: 3, vier: 4, fünf: 5, fuenf: 5, sechs: 6,
    sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12, zwoelf: 12, dreizehn: 13,
    vierzehn: 14, fünfzehn: 15, fuenfzehn: 15, sechzehn: 16, siebzehn: 17, achtzehn: 18,
    neunzehn: 19, zwanzig: 20, dreißig: 30, dreissig: 30, vierzig: 40, fünfzig: 50, fuenfzig: 50
  };
  const ORDINAL_SPECIAL = {
    erste: 1, erster: 1, ersten: 1, erstes: 1, dritte: 3, dritter: 3, dritten: 3,
    siebte: 7, siebter: 7, siebten: 7, achte: 8, achter: 8, achten: 8
  };

  const REPEAT_SPOKEN = { daily: 'jeden Tag', weekly: 'jede Woche', yearly: 'jedes Jahr' };

  // ======================================================================
  // 2. Verstehen
  // ======================================================================

  // Kleinschreibung, Satzzeichen zu Leerzeichen – gleiche Länge, damit Positionen zum Original passen
  function lower(text) {
    return text.toLowerCase().replace(/[,!?;„“"()]/g, ' ');
  }

  function cardinal(word) {
    if (word in NUMBER_WORDS) return NUMBER_WORDS[word];
    const compound = /^(.+)und(zwanzig|dreißig|dreissig|vierzig|fünfzig|fuenfzig)$/.exec(word);
    if (compound && NUMBER_WORDS[compound[1]] < 10) {
      return NUMBER_WORDS[compound[1]] + NUMBER_WORDS[compound[2]];
    }
    return null;
  }

  // "17", "17.", "siebzehn", "siebzehnten", "dritten" → Zahl; sonst null
  function toNumber(token) {
    if (/^\d+\.?$/.test(token)) return parseInt(token, 10);
    const word = token.replace(/\.$/, '');
    if (word in ORDINAL_SPECIAL) return ORDINAL_SPECIAL[word];
    let value = cardinal(word);
    if (value !== null) return value;
    for (const suffix of ['sten', 'ster', 'stes', 'ste', 'ten', 'ter', 'tes', 'te']) {
      if (word.endsWith(suffix)) {
        value = cardinal(word.slice(0, -suffix.length));
        if (value !== null) return value;
      }
    }
    return null;
  }

  // Erster Treffer eines Musters, den "check" akzeptiert
  function findFirst(pattern, text, check) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text))) {
      const result = check(match);
      if (result) return { ...result, start: match.index, end: match.index + match[0].length };
      if (match[0].length === 0) pattern.lastIndex++;
    }
    return null;
  }

  function mask(text, spans) {
    let result = text;
    for (const [start, end] of spans) {
      result = result.slice(0, start) + ' '.repeat(end - start) + result.slice(end);
    }
    return result;
  }

  function validIso(year, month, day) {
    const iso = isoDate(year, month, day);
    return dateFromIso(iso).toISOString().slice(0, 10) === iso ? iso : null;
  }

  // Ohne Jahresangabe: dieses Jahr, oder nächstes, wenn das Datum schon vorbei ist
  function resolveDate(day, month, yearText, today) {
    let year = yearText ? Number(yearText.length === 2 ? '20' + yearText : yearText) : Number(today.slice(0, 4));
    let iso = validIso(year, month, day);
    if (iso && !yearText && iso < today) iso = validIso(year + 1, month, day);
    return iso;
  }

  // Monat für Angaben ohne Monat ("vom 16. bis 19."): der offene Kalendermonat, sonst der aktuelle
  function fallbackMonth(today) {
    const calendarOpen = document.body.classList.contains('calendar-open') && viewYear !== null;
    return calendarOpen
      ? { year: viewYear, month: viewMonth, fixed: true }
      : { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)), fixed: false };
  }

  // Zeitraum auflösen; ohne Jahr: dieses Jahr bzw. nächstes, wenn der Zeitraum schon vorbei ist
  function resolveRange(day1, month1, day2, month2, yearText, today) {
    if (!day1 || !day2) return null;
    let noMonth = false;
    let fallback = null;
    if (!month1 && !month2) {
      fallback = fallbackMonth(today);
      month1 = month2 = fallback.month;
      noMonth = true;
    }
    month1 = month1 || month2;
    month2 = month2 || month1;
    let year = yearText ? Number(yearText.length === 2 ? '20' + yearText : yearText) : (fallback ? fallback.year : Number(today.slice(0, 4)));
    const build = (y, m1, m2) => ({
      date: validIso(y, m1, day1),
      endDate: validIso(m2 < m1 ? y + 1 : y, m2, day2)
    });
    let range = build(year, month1, month2);
    if (!range.date || !range.endDate || range.endDate < range.date) return null;
    if (!yearText && range.endDate < today && !(fallback && fallback.fixed)) {
      if (noMonth) {
        const next = month1 === 12 ? { y: year + 1, m: 1 } : { y: year, m: month1 + 1 };
        range = build(next.y, next.m, next.m);
      } else {
        range = build(year + 1, month1, month2);
      }
    }
    return range.date && range.endDate && range.endDate > range.date ? range : null;
  }

  function parseDate(text, today) {
    // Zeitraum: "vom 16. bis zum 19. (Oktober)", "vom 16. Oktober bis 2. November"
    const namedRange = findFirst(rx(String.raw`\b(?:vom|von)\s+${NUM}\.?\s*(?:(${MONTH_NAMES})\s+)?(?:bis(?:\s+(?:zum|einschließlich|einschliesslich))?|-|–)\s*${NUM}\.?(?:\s*(${MONTH_NAMES}))?(?:\s+(\d{4}))?\b`), text, m =>
      resolveRange(toNumber(m[1]), MONTHS[m[2]], toNumber(m[3]), MONTHS[m[4]], m[5], today));
    if (namedRange) return namedRange;

    // Zeitraum: "16.10. bis 19.10.", "vom 24.12.2026 - 26.12.2026"
    const numericRange = findFirst(rx(String.raw`\b(?:(?:vom|von)\s+)?(\d{1,2})\.(\d{1,2})\.?(?:(\d{4}))?\s*(?:bis(?:\s+zum)?|-|–)\s*(\d{1,2})\.(\d{1,2})\.?(\d{4})?`), text, m =>
      resolveRange(Number(m[1]), Number(m[2]), Number(m[4]), Number(m[5]), m[6] || m[3], today));
    if (numericRange) return numericRange;

    // Zeitraum ohne "vom": "16. bis 19. Oktober"
    const shortRange = findFirst(rx(String.raw`\b(\d{1,2})\.\s*(?:(${MONTH_NAMES})\s*)?bis\s+(?:zum\s+)?${NUM}\.?\s*(${MONTH_NAMES})(?:\s+(\d{4}))?\b`), text, m =>
      resolveRange(Number(m[1]), MONTHS[m[2]], toNumber(m[3]), MONTHS[m[4]], m[5], today));
    if (shortRange) return shortRange;

    // heute / morgen / übermorgen
    const relative = findFirst(rx(String.raw`\b(heute|übermorgen|uebermorgen|morgen)\b`), text, m => {
      const offset = { heute: 0, morgen: 1, übermorgen: 2, uebermorgen: 2 }[m[1]];
      return { date: addDays(today, offset) };
    });
    if (relative) return relative;

    // 17.10. / 17.10.2026
    const numeric = findFirst(rx(String.raw`\b(\d{1,2})\.(\d{1,2})(?:\.(\d{4}|\d{2}))?\.?(?![\d:])(?!\s*uhr)`), text, m => {
      const date = resolveDate(Number(m[1]), Number(m[2]), m[3], today);
      return date && { date };
    });
    if (numeric) return numeric;

    // (am) 17. Oktober (2027) / siebzehnten Oktober
    const dayMonth = findFirst(rx(String.raw`\b(?:(?:am|den|der|dem)\s+)?${NUM}\.?\s*(?:(?:im|des)\s+)?(${MONTH_NAMES})(?:\s+(\d{4}))?\b`), text, m => {
      const day = toNumber(m[1]);
      const date = day && resolveDate(day, MONTHS[m[2]], m[3], today);
      return date && { date };
    });
    if (dayMonth) return dayMonth;

    // Oktober, der 17.
    const monthDay = findFirst(rx(String.raw`\b(${MONTH_NAMES})\s*(?:(?:der|den|am)\s+)?${NUM}\.?(?![\d:])(?!\s*uhr)`), text, m => {
      const day = toNumber(m[2]);
      const date = day && resolveDate(day, MONTHS[m[1]], null, today);
      return date && { date };
    });
    if (monthDay) return monthDay;

    // (nächsten) Freitag / jeden Montag (= wöchentlich)
    const weekday = findFirst(rx(String.raw`\b(?:(jeden|jede)\s+)?(?:(?:am|den)\s+)?(?:(nächsten|naechsten|nächster|kommenden|diesen|diesem)\s+)?(${WEEKDAY_NAMES})\b`), text, m => {
      const todayDow = dateFromIso(today).getUTCDay();
      let ahead = (WEEKDAYS[m[3]] - todayDow + 7) % 7;
      if (ahead === 0 && !m[1] && m[2] !== 'diesen' && m[2] !== 'diesem') ahead = 7;
      return { date: addDays(today, ahead), weekly: Boolean(m[1]) };
    });
    if (weekday) return weekday;

    // am 17. – Monat aus dem offenen Kalender, sonst aktueller (bzw. nächster) Monat
    return findFirst(rx(String.raw`\b(?:am|den|der|zum)\s+${NUM}\.?(?![\d.:])(?!\s*uhr)`), text, m => {
      const day = toNumber(m[1]);
      if (!day || day > 31) return null;
      const calendarOpen = document.body.classList.contains('calendar-open') && viewYear !== null;
      if (calendarOpen) {
        const date = validIso(viewYear, viewMonth, day);
        return date && { date };
      }
      const year = Number(today.slice(0, 4));
      const month = Number(today.slice(5, 7));
      let date = validIso(year, month, day);
      if (!date || date < today) date = validIso(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, day);
      return date && { date };
    });
  }

  function hhmm(hour, minute) {
    if (hour === null || minute === null || hour < 0 || hour > 24 || minute < 0 || minute > 59) return null;
    return `${String(hour % 24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  // Uhrzeit: "um 10 Uhr", "10:30", "zehn Uhr dreißig", "halb drei", "viertel nach acht", "ganztägig"
  // bare = true: auch eine einzelne Zahl als Stunde verstehen (Antwort auf "Um wie viel Uhr?")
  function parseTime(text, bare = false) {
    const allDay = findFirst(rx(String.raw`\b(ganztägig|ganztaegig|ganztags|den ganzen tag|ganzen tag|ohne uhrzeit|keine uhrzeit)\b`), text, () => ({ allDay: true, time: '' }));
    if (allDay) return { ...allDay, spans: [[allDay.start, allDay.end]] };

    const patterns = [
      [String.raw`\b(?:um\s+)?halb\s+${NUM}\b`, m => hhmm(toNumber(m[1]) - 1, 30)],
      [String.raw`\b(?:um\s+)?viertel\s+nach\s+${NUM}\b`, m => hhmm(toNumber(m[1]), 15)],
      [String.raw`\b(?:um\s+)?(?:viertel\s+vor|dreiviertel)\s+${NUM}\b`, m => hhmm(toNumber(m[1]) - 1, 45)],
      [String.raw`\b(?:um\s+)?(\d{1,2})[:.](\d{2})(?:\s*uhr)?\b`, m => hhmm(Number(m[1]), Number(m[2]))],
      [String.raw`\b(?:um\s+)?${NUM}\s*uhr\b`, m => hhmm(toNumber(m[1]), 0)],
      [String.raw`\bum\s+${NUM}\b`, m => hhmm(toNumber(m[1]), 0)]
    ];
    if (bare) patterns.push([String.raw`^\s*${NUM}\s*$`, m => hhmm(toNumber(m[1]), 0)]);

    for (const [source, convert] of patterns) {
      const found = findFirst(rx(source), text, m => {
        const time = convert(m);
        return time && { time };
      });
      if (!found) continue;

      const spans = [[found.start, found.end]];
      let [hour, minute] = found.time.split(':').map(Number);

      // "zehn Uhr dreißig": Minuten nach "Uhr"
      if (/uhr$/.test(text.slice(found.start, found.end)) && minute === 0) {
        const after = /^\s+(\d{1,2}|[a-zäöüß]+)(?![a-zäöüß0-9])/.exec(text.slice(found.end));
        const extra = after && toNumber(after[1]);
        if (extra !== null && extra > 0 && extra < 60) {
          minute = extra;
          spans[0][1] = found.end + after[0].length;
        }
      }

      // abends / nachmittags → +12 Stunden
      const dayPart = findFirst(rx(String.raw`\b(abends|nachmittags|am abend|am nachmittag|nachts|in der nacht|mittags|am mittag|morgens|vormittags|früh|frueh|am vormittag)\b`), text, m => ({ part: m[1] }));
      if (dayPart) {
        if (hour < 12 && /abend|nachmittag/.test(dayPart.part)) hour += 12;
        if (hour < 6 && /mittag/.test(dayPart.part) && !/nachmittag/.test(dayPart.part)) hour += 12;
        spans.push([dayPart.start, dayPart.end]);
      }
      return { time: hhmm(hour, minute), allDay: false, spans };
    }
    return null;
  }

  // Wiederholung: loose = true erlaubt kurze Antworten ("immer", "einmal") auf Rückfragen
  function parseRepeat(text, loose = false) {
    const result = { repeat: null, repeatCount: null, countKnown: false, monthly: false, spans: [] };
    for (const [type, source] of REPEAT_PATTERNS) {
      const found = findFirst(rx(source), text, () => ({ ok: true }));
      if (found) {
        result.repeat = type;
        result.spans.push([found.start, found.end]);
        break;
      }
    }
    const monthly = findFirst(rx(MONTHLY), text, () => ({ ok: true }));
    if (monthly) {
      result.monthly = true;
      result.spans.push([monthly.start, monthly.end]);
    }
    const once = findFirst(rx(loose ? String.raw`\b(nur einmal|einmal|ein mal|eins|einen|1 mal|1x)\b` : COUNT_ONCE), text, () => ({ ok: true }));
    const forever = findFirst(rx(loose ? String.raw`\b(immer|dauerhaft|unbegrenzt|jedes mal|für immer|fuer immer)\b` : COUNT_FOREVER), text, () => ({ ok: true }));
    if (once) {
      result.repeatCount = 1;
      result.countKnown = true;
      result.spans.push([once.start, once.end]);
    } else if (forever) {
      result.countKnown = true;
      result.spans.push([forever.start, forever.end]);
    }
    return result;
  }

  function capitalize(text) {
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
  }

  // Titel = was übrig bleibt, ohne Füllwörter am Anfang und Ende jedes Satzteils
  // ("Zahnarzt, soll sich wiederholen, aber" → "Zahnarzt")
  function extractTitle(original, spans) {
    const clean = word => word.toLowerCase().replace(/[.,!?;:„“"()]/g, '');
    const parts = mask(original, spans).split(/[,;]/).map(part => {
      const words = part.split(/\s+/).filter(Boolean);
      while (words.length && (LEADING_FILLERS.has(clean(words[0])) || !clean(words[0]))) words.shift();
      while (words.length && (TRAILING_FILLERS.has(clean(words[words.length - 1])) || !clean(words[words.length - 1]))) words.pop();
      return words.join(' ').replace(/^[\s.:–-]+|[\s.:!?–-]+$/g, '');
    }).filter(Boolean);
    return capitalize(parts.join(', '));
  }

  function matchWake(text) {
    return findFirst(WAKE_WORD, lower(text), () => ({ ok: true }));
  }

  // Ganzer Satz → { date, time, timeKnown, repeat, repeatKnown, repeatCount, countKnown, title, … }
  function parseCommand(text) {
    const today = berlinStamp(new Date()).date;
    const spans = [];
    let work = lower(text);

    const wake = matchWake(text);
    if (wake && wake.start < 3) {
      spans.push([wake.start, wake.end]);
      work = mask(work, spans);
    }

    // "… Kommentar: Versicherungskarte mitbringen" – alles nach dem Wort ist der Kommentar
    let note = '';
    const noteMatch = findFirst(rx(String.raw`\b(?:mit\s+)?(?:dem\s+|der\s+)?(?:kommentar|notiz|bemerkung|hinweis)\b\s*:?\s*`), work, () => ({ ok: true }));
    if (noteMatch) {
      note = cleanNote(text.slice(noteMatch.end));
      spans.push([noteMatch.start, text.length]);
      work = mask(work, spans);
    }

    const date = parseDate(work, today);
    if (date) {
      spans.push([date.start, date.end]);
      work = mask(work, spans);
    }
    const time = parseTime(work);
    if (time) {
      spans.push(...time.spans);
      work = mask(work, spans);
    }
    const repeat = parseRepeat(work);
    spans.push(...repeat.spans);

    let repeatType = repeat.repeat;
    if (!repeatType && date && date.weekly) repeatType = 'weekly';
    const endDate = date && date.endDate ? date.endDate : null;

    // Kategorie nur aus dem eigentlichen Termin lesen, nicht aus dem Kommentar
    const commandText = noteMatch ? text.slice(0, noteMatch.start) : text;
    const category = detectCategory(commandText);
    let title = extractTitle(text, spans);
    if (category) title = stripCategoryWord(title, category);

    return {
      date: date ? date.date : null,
      endDate,
      time: time ? time.time : '',
      // Mehrtägige Termine sind ganztägig und wiederholen sich nicht – danach muss Edith nicht fragen
      timeKnown: Boolean(time) || Boolean(endDate),
      repeat: endDate ? 'none' : repeatType || 'none',
      repeatKnown: Boolean(repeatType) || Boolean(endDate),
      repeatCount: repeat.repeatCount,
      countKnown: repeat.countKnown,
      monthly: repeat.monthly && !endDate,
      note,
      noteKnown: Boolean(note),
      category,
      title
    };
  }

  // "Teammeeting Arbeit" / "Teammeeting, Kategorie Arbeit" → "Teammeeting"; ist der Titel nur
  // der Kategorie-Name ("Urlaub"), bleibt er stehen
  function stripCategoryWord(title, categoryId) {
    const name = categoryName(categoryId);
    if (!name || title.toLowerCase() === name.toLowerCase()) return title;
    const escaped = name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const stripped = title.replace(rx(String.raw`[,\s]*(?:\b(?:in der |für die |fuer die )?kategorie\s+)?\b${escaped}\b`, 'gi'), ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[\s,–-]+|[\s,–-]+$/g, '');
    return stripped ? capitalize(stripped) : title;
  }

  // Kategorie aus dem Satz erkennen: "Urlaub" → Kategorie "Urlaub" (längster passender Name gewinnt)
  function detectCategory(text) {
    const low = lower(text);
    const categories = [...(settings.categories || [])].sort((a, b) => b.name.length - a.name.length);
    for (const category of categories) {
      const name = category.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (name && rx(String.raw`\b${name}\b`, '').test(low)) return category.id;
    }
    return null;
  }

  // Kommentar-Text aufräumen: "schreib rein: …", "der Kommentar ist …" → nur der Inhalt
  function cleanNote(text) {
    const note = String(text || '')
      .replace(/^\s*(?:schreib(?:e)?|notier(?:e)?)\s+(?:rein|auf|dazu)?\s*:?\s*/i, '')
      .replace(/^\s*(?:der\s+)?(?:kommentar|notiz)\s*(?:ist|lautet|soll sein)?\s*:?\s*/i, '')
      .replace(/^\s*(?:dass\s+)/i, '')
      .trim();
    return capitalize(note);
  }

  // Antwort auf "Soll ich einen Kommentar schreiben?": { decision: 'no' | 'yes' } oder { note }
  function commentAnswer(text) {
    const low = lower(text).trim();
    if (rx(String.raw`\b(kein(?:en)? kommentar|nicht nötig|nicht noetig|brauch(?:e)? ich nicht|passt so|lass mal|ohne)\b`, '').test(low)) {
      return { decision: 'no' };
    }
    if (NO.test(low) && low.split(/\s+/).length <= 3) return { decision: 'no' };
    if (YES.test(low) || /^\s*(gern|klar|bitte)\b/.test(low)) {
      const rest = cleanNote(text.replace(/^\s*(?:ja|jo|jap|jawohl|genau|gerne|gern|okay|ok|klar|bitte|sicher|mach)\b[\s,.:!–-]*/i, '')
        .replace(/^\s*(?:bitte|gerne)\b[\s,.:!–-]*/i, ''));
      return rest.length >= 2 ? { note: rest } : { decision: 'yes' };
    }
    const note = cleanNote(text);
    return note ? { note } : { decision: 'no' };
  }

  // ======================================================================
  // 3. Gespräch
  // ======================================================================

  const spokenDateFormat = new Intl.DateTimeFormat('de-DE', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function speakDate(iso) {
    const today = berlinStamp(new Date()).date;
    const days = daysBetween(today, iso);
    const base = spokenDateFormat.format(dateFromIso(iso));
    if (days === 0) return `heute, ${base}`;
    if (days === 1) return `morgen, ${base}`;
    return base;
  }

  // "morgen, Samstag, 17. Oktober" bzw. "am Montag, 20. Oktober"
  function onDay(iso) {
    const spoken = speakDate(iso);
    return /^(heute|morgen)/.test(spoken) ? spoken : `am ${spoken}`;
  }

  function speakTime(time) {
    const [hour, minute] = time.split(':').map(Number);
    return minute === 0 ? `${hour} Uhr` : `${hour}:${String(minute).padStart(2, '0')} Uhr`;
  }

  function categoryName(id) {
    const category = (settings.categories || []).find(item => item.id === id);
    return category ? category.name : '';
  }

  // "vom Freitag, 16. Oktober bis Montag, 19. Oktober"
  function spokenRange(start, end) {
    return `vom ${spokenDateFormat.format(dateFromIso(start))} bis ${spokenDateFormat.format(dateFromIso(end))}`;
  }

  function describe(draft) {
    const category = draft.category && categoryName(draft.category) ? ` (Kategorie ${categoryName(draft.category)})` : '';
    if (draft.endDate) {
      const note = draft.note ? ` mit dem Kommentar „${draft.note}“` : '';
      return `„${draft.title}“ ${spokenRange(draft.date, draft.endDate)}${category}${note}`;
    }
    const time = draft.time ? ` um ${speakTime(draft.time)}` : ' ganztägig';
    let repeat = '';
    if (draft.repeat && draft.repeat !== 'none') {
      repeat = draft.repeatCount === 1
        ? `, ${REPEAT_SPOKEN[draft.repeat]} wiederholt, aber nur ein weiteres Mal`
        : `, ${REPEAT_SPOKEN[draft.repeat]} wiederholt`;
    }
    const note = draft.note ? ` mit dem Kommentar „${draft.note}“` : '';
    return `„${draft.title}“ ${onDay(draft.date)}${time}${repeat}${category}${note}`;
  }

  // Kalender öffnen, Monat einstellen und das Eintragefeld unter dem Tag zeigen
  async function showDay(date) {
    const keepFocus = document.activeElement === ui.input;
    if (!document.body.classList.contains('calendar-open')) {
      openCalendar();
      await sleep(700); // Animation abwarten, damit das Feld richtig sitzt
    }
    const [year, month] = date.split('-').map(Number);
    if (viewYear !== year || viewMonth !== month) {
      viewYear = year;
      viewMonth = month;
      renderCalendar();
    }
    const cell = calendar.querySelector(`.day[data-date="${date}"]`);
    if (cell && selectedDate !== date) openEditor(cell);
    if (keepFocus) ui.input.focus();
  }

  // Entwurf in die Felder des Eintragefelds schreiben, damit man sieht, was Edith vorhat
  function fillEditor(draft, showSettings) {
    if (!selectedDate) return;
    editorText.value = draft.title || '';
    editorTime.value = draft.time || '';
    editorRepeat.value = draft.repeat && draft.repeat !== 'none' ? draft.repeat : 'none';
    editorCount.value = draft.repeatCount === 1 ? '1' : '0';
    editorNote.value = draft.note || '';
    editorEnd.value = draft.endDate || '';
    editorCategory.value = draft.category || '';
    if (showSettings) editorSettings.hidden = false;
    updateRepeatControls();
    positionEditor();
  }

  // Speichern; wurde noch nicht nach einem Kommentar gefragt, fragt Edith danach
  async function saveDraft(draft) {
    await showDay(draft.date);
    fillEditor(draft, false);
    editorForm.requestSubmit();
    const saved = events[events.length - 1];
    if (!draft.noteKnown && saved) {
      state.conversation = { draft, step: 'comment', retries: 0, savedId: saved.id };
      updateUi();
      await say(`Erledigt! Ich habe ${describe(draft)} eingetragen. Soll ich noch einen Kommentar dazu schreiben?`);
      return;
    }
    state.conversation = null;
    await say(`Erledigt! Ich habe ${describe(draft)} eingetragen.`);
    finishConversation();
  }

  // Kommentar nachträglich an den gerade gespeicherten Termin hängen
  async function finishSavedComment(conversation) {
    state.conversation = null;
    const { draft, savedId } = conversation;
    if (draft.note) {
      updateEventNote(savedId, draft.note);
      await say(`Okay, ich habe den Kommentar „${draft.note}“ hinzugefügt.`);
    } else {
      await say('Alles klar, ohne Kommentar.');
    }
    finishConversation();
  }

  function merge(draft, parsed, { includeTitle = false } = {}) {
    if (parsed.date) {
      draft.date = parsed.date;
      draft.endDate = parsed.endDate;
      if (parsed.endDate) {
        draft.timeKnown = true;
        draft.repeat = 'none';
        draft.repeatKnown = true;
      }
    }
    if (parsed.category) draft.category = parsed.category;
    if (parsed.timeKnown) {
      draft.time = parsed.time;
      draft.timeKnown = true;
    }
    if (parsed.repeatKnown) {
      draft.repeat = parsed.repeat;
      draft.repeatKnown = true;
    }
    if (parsed.countKnown) {
      draft.repeatCount = parsed.repeatCount;
      draft.countKnown = true;
    }
    if (parsed.noteKnown) {
      draft.note = parsed.note;
      draft.noteKnown = true;
    }
    if (includeTitle && parsed.title) draft.title = parsed.title;
  }

  async function startAppointment(parsed) {
    const draft = {
      date: parsed.date,
      endDate: parsed.endDate,
      category: parsed.category,
      title: parsed.title,
      time: parsed.time,
      timeKnown: parsed.timeKnown,
      repeat: parsed.repeat,
      repeatKnown: parsed.repeatKnown,
      repeatCount: parsed.repeatCount,
      countKnown: parsed.countKnown,
      note: parsed.note,
      noteKnown: parsed.noteKnown
    };
    if (parsed.monthly) {
      await say('Monatliche Wiederholungen kann ich noch nicht. Ich frage dich gleich nach einer anderen Wiederholung.');
      draft.repeatKnown = false;
    }

    // Alles Wichtige gesagt (Tag + Was) → direkt eintragen
    if (draft.date && draft.title && !parsed.monthly) {
      await saveDraft(draft);
      return;
    }

    // Sonst: Kalender und Einstellungen öffnen und nachfragen
    state.conversation = { draft, step: null, retries: 0 };
    if (draft.date) {
      await showDay(draft.date);
      fillEditor(draft, true);
    }
    await askNext();
  }

  async function askNext() {
    const conversation = state.conversation;
    if (!conversation) return;
    const draft = conversation.draft;

    if (draft.date && selectedDate !== draft.date) await showDay(draft.date);
    if (draft.date) fillEditor(draft, true);

    let step;
    let question;
    if (!draft.date) {
      step = 'date';
      question = draft.title
        ? `Für welchen Tag soll ich „${draft.title}“ eintragen?`
        : 'Für welchen Tag soll ich den Termin eintragen?';
    } else if (!draft.title) {
      step = 'title';
      question = `Was soll ich ${onDay(draft.date)} eintragen?`;
    } else if (!draft.timeKnown) {
      step = 'time';
      question = 'Um wie viel Uhr? Oder sag „ganztägig“.';
    } else if (!draft.repeatKnown) {
      step = 'repeat';
      question = 'Soll sich der Termin wiederholen? Jeden Tag, jede Woche, jedes Jahr – oder nein?';
    } else if (draft.repeat !== 'none' && !draft.countKnown) {
      step = 'count';
      question = 'Immer wiederholen oder nur ein einziges Mal?';
    } else if (!draft.noteKnown) {
      step = 'comment';
      question = 'Soll ich noch einen Kommentar dazu schreiben?';
    } else {
      step = 'confirm';
      question = `Ich trage ${describe(draft)} ein. Passt das?`;
    }
    if (conversation.step !== step) conversation.retries = 0;
    conversation.step = step;
    updateUi();
    await say(question);
  }

  async function retry(message) {
    const conversation = state.conversation;
    conversation.retries++;
    if (conversation.retries > 2) {
      state.conversation = null;
      await say('Ich verstehe es leider nicht. Ich breche ab – versuch es gern noch einmal.');
      finishConversation();
      return;
    }
    await say(message);
  }

  async function cancelConversation() {
    const conversation = state.conversation;
    state.conversation = null;
    if (conversation && conversation.savedId) {
      // Termin ist schon gespeichert, nur der Kommentar fällt weg
      await say('Okay, ohne Kommentar.');
      finishConversation();
      return;
    }
    closeEditor();
    await say('Okay, abgebrochen. Ich habe nichts eingetragen.');
    finishConversation();
  }

  async function handleAnswer(text) {
    const conversation = state.conversation;
    const draft = conversation.draft;
    const low = lower(text);

    if (CANCEL.test(low)) {
      await cancelConversation();
      return;
    }

    switch (conversation.step) {
      case 'date': {
        const parsed = parseCommand(text);
        if (!parsed.date) {
          await retry('Welcher Tag? Sag zum Beispiel „am 17. Oktober“ oder „morgen“.');
          return;
        }
        merge(draft, parsed, { includeTitle: !draft.title });
        break;
      }
      case 'title': {
        const parsed = parseCommand(text);
        const title = parsed.title || capitalize(text.trim().replace(/[.!?]+$/, ''));
        if (!title) {
          await retry('Was soll im Termin stehen?');
          return;
        }
        merge(draft, parsed);
        draft.title = title;
        break;
      }
      case 'time': {
        if (rx(String.raw`\b(ganztägig|ganztaegig|ganztags|ganzen tag|keine|ohne|egal|nein|nicht)\b`, '').test(low)) {
          draft.time = '';
          draft.timeKnown = true;
          break;
        }
        const time = parseTime(low, true);
        if (!time) {
          await retry('Welche Uhrzeit? Zum Beispiel „um 10 Uhr“, „halb drei“ oder „ganztägig“.');
          return;
        }
        draft.time = time.time;
        draft.timeKnown = true;
        break;
      }
      case 'repeat': {
        const repeat = parseRepeat(low, true);
        if (repeat.monthly) {
          await retry('Monatlich kann ich noch nicht. Jeden Tag, jede Woche, jedes Jahr – oder nein?');
          return;
        }
        if (repeat.repeat) {
          draft.repeat = repeat.repeat;
        } else if (NO.test(low) || rx(String.raw`\b(nie|keine|einmalig|nö)\b`, '').test(low)) {
          draft.repeat = 'none';
        } else if (rx(String.raw`\b(tag|täglich|taeglich)\b`, '').test(low)) {
          draft.repeat = 'daily';
        } else if (rx(String.raw`\b(woche|wöchentlich|woechentlich)\b`, '').test(low)) {
          draft.repeat = 'weekly';
        } else if (rx(String.raw`\b(jahr|jährlich|jaehrlich)\b`, '').test(low)) {
          draft.repeat = 'yearly';
        } else {
          await retry('Jeden Tag, jede Woche, jedes Jahr – oder gar nicht?');
          return;
        }
        draft.repeatKnown = true;
        if (repeat.countKnown) {
          draft.repeatCount = repeat.repeatCount;
          draft.countKnown = true;
        }
        break;
      }
      case 'count': {
        const repeat = parseRepeat(low, true);
        if (!repeat.countKnown) {
          await retry('Sag „immer“ oder „nur einmal“.');
          return;
        }
        draft.repeatCount = repeat.repeatCount;
        draft.countKnown = true;
        break;
      }
      case 'comment': {
        const answer = commentAnswer(text);
        if (answer.decision === 'yes') {
          conversation.step = 'commentText';
          await say('Was soll im Kommentar stehen?');
          return;
        }
        draft.note = answer.note || '';
        draft.noteKnown = true;
        break;
      }
      case 'commentText': {
        const note = cleanNote(text);
        if (!note) {
          await retry('Was soll im Kommentar stehen?');
          return;
        }
        draft.note = note;
        draft.noteKnown = true;
        break;
      }
      case 'confirm': {
        if (YES.test(low)) {
          await saveDraft(draft);
          return;
        }
        if (NO.test(low) && low.trim().split(/\s+/).length <= 2) {
          await cancelConversation();
          return;
        }
        // Korrektur, z. B. "nein, um 11 Uhr"
        const parsed = parseCommand(text.replace(/^\s*(nein|nee|doch)\b[\s,]*/i, ''));
        const before = JSON.stringify(draft);
        merge(draft, parsed);
        if (JSON.stringify(draft) === before) {
          await retry('Sag „ja“ zum Speichern, „nein“ zum Abbrechen – oder was ich ändern soll.');
          return;
        }
        break;
      }
    }
    // Termin war schon gespeichert (direkter Befehl) → nur noch den Kommentar anhängen
    if (conversation.savedId) {
      await finishSavedComment(conversation);
      return;
    }
    await askNext();
  }

  // "„Zahnarzt“ morgen, Samstag, 17. Oktober um 10:30 Uhr. Kommentar: …"
  function describeOccurrence(event, date, { withNote = true, verb = '' } = {}) {
    const noteText = event.note && !/[.!?]$/.test(event.note) ? `${event.note}.` : event.note;
    const note = withNote && event.note ? ` Kommentar: ${noteText}` : '';
    if (event.endDate) {
      const today = berlinStamp(new Date()).date;
      const when = today >= event.date && today <= event.endDate
        ? `läuft noch bis ${spokenDateFormat.format(dateFromIso(event.endDate))}`
        : `${verb ? verb + ' ' : ''}${spokenRange(event.date, event.endDate)}`;
      return `„${event.title}“ ${when}.${note}`;
    }
    const time = event.time ? ` um ${speakTime(event.time)}` : ', ganztägig';
    const repeat = event.repeat ? ` (${REPEAT_SPOKEN[event.repeat]}${event.repeatCount === 1 ? ', nur ein weiteres Mal' : ''})` : '';
    return `„${event.title}“${verb ? ' ' + verb : ''} ${onDay(date)}${time}${repeat}.${note}`;
  }

  // Nächster Termin: vorlesen und im großen Kalender zu dem Tag führen
  async function tellUpcoming() {
    const list = upcomingEvents(new Date(), 3);
    if (list.length === 0) {
      await say('Du hast keine anstehenden Termine.');
      return;
    }
    await showDay(list[0].date);
    let answer = `Dein nächster Termin ist ${describeOccurrence(list[0].event, list[0].date)}`;
    const later = list.slice(1).map(({ event, date }) => event.endDate
      ? `„${event.title}“ ${spokenRange(event.date, event.endDate)}`
      : `„${event.title}“ ${onDay(date)}${event.time ? ' um ' + speakTime(event.time) : ''}`);
    if (later.length) answer += ` Danach: ${later.join(', dann ')}.`;
    await say(answer);
  }

  // Wörter, die bei "Wann ist mein Zahnarzttermin?" nicht zum Suchbegriff gehören
  const QUERY_FILLERS = new Set(`
    wann ist sind war habe hab hast ich mein meine meinen meinem meiner der die das den dem des
    termin termine terminen beim bei zum zur zu ein eine einen nochmal noch mal bitte denn eigentlich
    erzähl erzähle erzaehl mir mehr über ueber infos info details was weißt weisst du steht an hat gibt
    es und oder wieder genau kommt kommende nächste naechste nächster nächsten edith sag sage
  `.trim().split(/\s+/));

  // "Wann ist der Zahnarzt?" → passenden Termin suchen, vorlesen und den Tag öffnen
  async function tellAppointment(rest) {
    // "zahnarzttermin" → "zahnarzt"
    const keywords = rest.replace(/[.?!:]/g, ' ').split(/\s+/)
      .filter(word => word.length >= 3 && !QUERY_FILLERS.has(word))
      .map(word => (/^.{3,}termine?n?$/.test(word) ? word.replace(/termine?n?$/, '') : word));
    if (!keywords.length) {
      await tellUpcoming();
      return;
    }
    const today = berlinStamp(new Date()).date;
    const matches = events.map(event => {
      const haystack = `${event.title} ${event.note || ''}`.toLowerCase();
      const words = haystack.split(/[^a-zäöüß0-9]+/).filter(word => word.length >= 4);
      const score = keywords.filter(keyword =>
        haystack.includes(keyword) || words.some(word => keyword.includes(word))).length;
      return { event, score, date: nextOccurrence(event, today) };
    }).filter(match => match.score > 0);

    if (!matches.length) {
      await say(`Ich habe keinen Termin zu „${keywords.join(' ')}“ gefunden.`);
      return;
    }
    const best = Math.max(...matches.map(match => match.score));
    const candidates = matches.filter(match => match.score === best);
    const upcoming = candidates.filter(match => match.date).sort((a, b) => a.date.localeCompare(b.date));
    if (upcoming.length) {
      const { event, date } = upcoming[0];
      await showDay(date);
      const more = upcoming.length > 1 ? ` Ich habe noch ${upcoming.length - 1} weitere passende Termine gefunden.` : '';
      await say(`${describeOccurrence(event, date, { verb: 'ist' })}${more}`);
      return;
    }
    // Nur vergangene Termine gefunden
    const last = candidates.sort((a, b) => b.event.date.localeCompare(a.event.date))[0].event;
    await showDay(last.date);
    await say(`„${last.title}“ war am ${spokenDateFormat.format(dateFromIso(last.date))}. Danach kommt er nicht mehr.`);
  }

  // "Was habe ich morgen?" → Termine des Tages vorlesen und den Tag öffnen
  async function tellDay(date) {
    await showDay(date);
    const list = eventsOn(date);
    const day = onDay(date);
    if (!list.length) {
      await say(`${capitalize(day)} hast du keine Termine.`);
      return;
    }
    const parts = list.map(event => {
      const time = event.endDate ? ` (${spokenRange(event.date, event.endDate)})`
        : event.time ? ` um ${speakTime(event.time)}` : ' (ganztägig)';
      return `„${event.title}“${time}${event.note ? ` – ${event.note}` : ''}`;
    });
    await say(`${capitalize(day)} hast du: ${parts.join(', ')}.`);
  }

  async function handleCommand(text) {
    const low = lower(text);
    const wake = matchWake(text);
    const rest = wake && wake.start < 3 ? low.slice(wake.end) : low;

    if (!rest.trim()) {
      startAwaiting();
      await say('Ja? Was kann ich für dich tun?');
      return;
    }
    if (rx(String.raw`\b(hilfe|was kannst du)\b`, '').test(rest)) {
      await say('Ich kann Termine eintragen. Sag zum Beispiel: „Trag am 17. Oktober um 10 Uhr Zahnarzt ein.“ Oder frag mich: „Was ist mein nächster Termin?“, „Wann ist der Zahnarzt?“ oder „Was habe ich morgen?“');
      finishConversation();
      return;
    }
    if (rx(String.raw`\b(nächste[nrs]?|naechste[nrs]?|kommende[nrs]?)\s+termin`, '').test(rest) ||
        rx(String.raw`\b(was steht an|welche termine stehen an|was habe ich vor|was hab ich vor|was kommt als nächstes|was kommt als naechstes)\b`, '').test(rest)) {
      await tellUpcoming();
      finishConversation();
      return;
    }
    // "Wie läuft mein Winter Arc?" / "Welcher Tag Winter Arc?" → Stand vorlesen und Ansicht öffnen
    // (auch "Arc" allgemein oder der selbst gewählte Name, z. B. "Summer Arc")
    const arcName = window.Tracker && window.Tracker.arcName ? window.Tracker.arcName().toLowerCase() : '';
    if (window.Tracker && (rx(String.raw`\b(winter\s*-?\s*arc|winterarc|winter ark|winterark|arc|ark)\b`, '').test(rest) || (arcName && rest.toLowerCase().includes(arcName)))) {
      openView('#winterarc');
      await say(window.Tracker.winterSummary());
      finishConversation();
      return;
    }
    // "Ich brauche Motivation" / "Motivier mich" / "Ich habe keine Lust" → Motivationsvideo
    if (rx(String.raw`\b(motivation|motivier|motiviere|motivieren|keine lust|kein bock|antriebslos|null bock)\b`, '').test(rest) && window.Tracker) {
      await say('Hier ist ein bisschen Motivation für dich!');
      window.Tracker.showMotivation();
      finishConversation();
      return;
    }
    const wantsCreate = rx(String.raw`\b(trag|trage|eintragen|notier|notiere|plan|plane|erstell|erstelle|leg|lege|schreib)`, '').test(rest);
    // "Wann ist der Zahnarzt?" / "Erzähl mir mehr über den Zahnarzt"
    if (!wantsCreate && (rx(String.raw`^\s*wann\b`, '').test(rest) ||
        rx(String.raw`\b(erzähl|erzähle|erzaehl|infos?|details|was weißt du|was weisst du)\b.*\b(über|ueber|zu|zum|zur|beim|vom)\b`, '').test(rest))) {
      await tellAppointment(rest);
      finishConversation();
      return;
    }
    // "Was habe ich morgen?" / "Welche Termine habe ich am 24. Oktober?"
    const question = rx(String.raw`^\s*(was|welche|wie viele|habe ich|hab ich|hast du|gibt es|steht|ist|sind)\b`, '').test(rest) || /\?\s*$/.test(text);
    if (question && !wantsCreate) {
      const askedDate = parseDate(rest, berlinStamp(new Date()).date);
      if (askedDate) {
        await tellDay(askedDate.date);
        finishConversation();
        return;
      }
    }
    if (rx(String.raw`\b(einstellungen)\b`, '').test(rest)) {
      openSettings();
      await say('Hier sind die Einstellungen.');
      finishConversation();
      return;
    }
    if (rx(String.raw`\b(schließ|schließe|schliess|zurück|zurueck|startseite|home)\b`, '').test(rest) && !/termin/.test(rest)) {
      goHome();
      await say('Okay, zurück zur Startseite.');
      finishConversation();
      return;
    }

    const parsed = parseCommand(text);
    const wantsAppointment = rx(String.raw`\b(termin|trag|trage|eintragen|eintrag|notier|notiere|erinner|plan|plane|schreib)`, '').test(rest);
    if (parsed.date || wantsAppointment) {
      await startAppointment(parsed);
      return;
    }
    if (/kalender/.test(rest)) {
      openCalendar();
      await say('Hier ist dein Kalender.');
      finishConversation();
      return;
    }
    await say('Das kann ich noch nicht. Im Moment kann ich Termine eintragen, Kommentare dazu schreiben und dir sagen, wann was ansteht.');
    finishConversation();
  }

  let queue = Promise.resolve();

  // Eingang für alles, was Edith hört oder liest (nacheinander abarbeiten)
  function handle(text, { fromUser = true } = {}) {
    if (!text || !text.trim()) return queue;
    queue = queue.then(async () => {
      showPanel();
      if (fromUser) log(text.trim(), 'user');
      stopAwaiting();
      if (state.conversation) {
        await handleAnswer(text);
      } else {
        await handleCommand(text);
      }
    }).catch(error => {
      console.error('Edith:', error);
      state.conversation = null;
      log('Da ist etwas schiefgelaufen.', 'bot');
    }).finally(updateUi);
    return queue;
  }

  // ======================================================================
  // 4. Hören & Sprechen
  // ======================================================================

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const state = {
    enabled: false,
    wakeWord: true,
    speakReplies: true,
    running: false,
    speaking: false,
    awaiting: false,
    awaitTimer: null,
    conversation: null,
    micBlocked: false,
    retryDelay: 300
  };
  let recognition = null;

  function shouldListen() {
    return Boolean(Recognition) && state.enabled && !state.micBlocked && !state.muted &&
      (state.wakeWord || state.awaiting || Boolean(state.conversation));
  }

  function getRecognition() {
    if (recognition || !Recognition) return recognition;
    recognition = new Recognition();
    recognition.lang = 'de-DE';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;

    recognition.onstart = () => {
      state.running = true;
      state.retryDelay = 300;
      updateUi();
    };
    recognition.onend = () => {
      state.running = false;
      updateUi();
      if (shouldListen() && !state.speaking) setTimeout(refreshListening, state.retryDelay);
    };
    recognition.onerror = event => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        state.micBlocked = true;
        updateStatus();
        reportProblem('mic', 'Ich darf das Mikrofon nicht benutzen. Erlaube es über das Symbol links in der Adressleiste.');
      } else if (event.error === 'network') {
        state.retryDelay = 4000;
        reportProblem('network', 'Die Spracherkennung des Browsers ist gerade nicht erreichbar (braucht Internet). Ich versuche es weiter.');
      } else if (event.error === 'audio-capture') {
        state.retryDelay = 4000;
        reportProblem('audio', 'Ich finde kein Mikrofon. Ist eins angeschlossen und in Windows ausgewählt?');
      } else if (event.error === 'language-not-supported') {
        reportProblem('lang', 'Dieser Browser kann kein Deutsch erkennen. Nutze bitte Chrome oder Edge.');
      }
    };
    recognition.onresult = event => {
      if (state.speaking) return;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const alternatives = Array.from(result, alternative => alternative.transcript.trim()).filter(Boolean);
        if (!alternatives.length) continue;
        if (!result.isFinal) {
          showLive(alternatives[0]);
          continue;
        }
        clearLive();
        heard(alternatives);
      }
    };
    return recognition;
  }

  // ---------- Live-Anzeige: was gerade erkannt wird ----------
  let liveText = '';
  let recognizingTimer = null;

  // Zwischenergebnis: Knopf leuchtet grün, Text erscheint live im Eingabefeld
  function showLive(text) {
    ui.orb.classList.add('recognizing');
    clearTimeout(recognizingTimer);
    recognizingTimer = setTimeout(() => ui.orb.classList.remove('recognizing'), 1200);

    const wake = state.wakeWord && matchWake(text);
    const engaged = state.awaiting || state.conversation || wake || !ui.panel.hidden;
    if (!engaged) return;
    if (wake) showPanel();
    if (state.awaiting) startAwaiting(); // solange gesprochen wird, nicht abbrechen
    // Nicht überschreiben, wenn du gerade selbst tippst
    if (ui.input.value === '' || ui.input.value === liveText) {
      ui.input.value = text;
      liveText = text;
      ui.input.classList.add('live');
    }
  }

  function clearLive() {
    if (ui.input.value === liveText) ui.input.value = '';
    liveText = '';
    ui.input.classList.remove('live');
  }

  // Probleme einmalig im Edith-Fenster und in den Einstellungen anzeigen
  const reportedProblems = new Set();
  function reportProblem(kind, message) {
    setStatus(message, true);
    if (reportedProblems.has(kind)) return;
    reportedProblems.add(kind);
    showPanel();
    log(message, 'bot');
  }

  // ---------- Mikrofon-Pegel für die Animation am Knopf ----------
  const meter = { stream: null, context: null, analyser: null, frame: 0, level: 0 };

  async function startMeter() {
    if (meter.stream || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    try {
      meter.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
    } catch (error) {
      meter.stream = null;
      if (error && error.name === 'NotAllowedError') {
        state.micBlocked = true;
        updateStatus();
        reportProblem('mic', 'Ich darf das Mikrofon nicht benutzen. Erlaube es über das Symbol links in der Adressleiste.');
      } else if (error && error.name === 'NotFoundError') {
        reportProblem('audio', 'Ich finde kein Mikrofon. Ist eins angeschlossen und in Windows ausgewählt?');
      }
      return;
    }
    if (!state.enabled) {
      stopMeter();
      return;
    }
    meter.context = new (window.AudioContext || window.webkitAudioContext)();
    meter.analyser = meter.context.createAnalyser();
    meter.analyser.fftSize = 512;
    meter.context.createMediaStreamSource(meter.stream).connect(meter.analyser);
    const samples = new Uint8Array(meter.analyser.fftSize);
    const tick = () => {
      meter.analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
      const rms = Math.sqrt(sum / samples.length);
      // weich nachziehen, damit der Ring nicht flackert
      meter.level = Math.max(Math.min(1, rms * 6), meter.level * 0.85);
      ui.orb.style.setProperty('--level', meter.level.toFixed(3));
      ui.orb.classList.toggle('hearing', meter.level > 0.12);
      meter.frame = requestAnimationFrame(tick);
    };
    tick();
  }

  function stopMeter() {
    cancelAnimationFrame(meter.frame);
    if (meter.stream) meter.stream.getTracks().forEach(track => track.stop());
    if (meter.context) meter.context.close().catch(() => {});
    Object.assign(meter, { stream: null, context: null, analyser: null, frame: 0, level: 0 });
    ui.orb.style.setProperty('--level', '0');
    ui.orb.classList.remove('hearing');
  }

  // Browser starten Audio erst nach einem Klick – dann den Pegelmesser aufwecken
  document.addEventListener('pointerdown', () => {
    if (meter.context && meter.context.state === 'suspended') meter.context.resume();
  });

  function refreshListening() {
    const rec = getRecognition();
    if (!rec) return;
    if (shouldListen() && !state.speaking) {
      if (!state.running) {
        try { rec.start(); } catch (error) { /* läuft bereits */ }
      }
    } else if (state.running) {
      rec.abort();
    }
  }

  // Erkannter Satz: im Gespräch direkt verarbeiten, sonst nur nach dem Aktivierungswort
  function heard(alternatives) {
    if (state.awaiting || state.conversation) {
      handle(alternatives[0]);
      return;
    }
    if (!state.wakeWord) return;
    for (const text of alternatives) {
      const wake = matchWake(text);
      if (wake) {
        handle(text.slice(wake.start));
        return;
      }
    }
  }

  // Nach "Edith" oder Klick auf den Knopf: der nächste Satz ist ein Befehl
  function startAwaiting() {
    const wasAwaiting = state.awaiting;
    state.awaiting = true;
    clearTimeout(state.awaitTimer);
    state.awaitTimer = setTimeout(() => {
      state.awaiting = false;
      clearLive();
      updateUi();
      refreshListening();
      hidePanelSoon();
    }, 12000);
    if (!wasAwaiting) {
      updateUi();
      refreshListening();
    }
  }

  function stopAwaiting() {
    state.awaiting = false;
    clearTimeout(state.awaitTimer);
  }

  function germanVoice() {
    const voices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
    const german = voices.filter(voice => voice.lang && voice.lang.toLowerCase().startsWith('de'));
    return german.find(voice => /natural|online|neural/i.test(voice.name)) ||
      german.find(voice => /google/i.test(voice.name)) || german[0] || null;
  }

  // Antwort anzeigen und (wenn eingeschaltet) vorlesen; währenddessen hört Edith nicht zu
  function say(text) {
    log(text, 'bot');
    if (!state.speakReplies || !window.speechSynthesis) return Promise.resolve();
    state.speaking = true;
    updateUi();
    if (state.running && recognition) recognition.abort();
    return new Promise(resolve => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        state.speaking = false;
        updateUi();
        setTimeout(refreshListening, 150);
        resolve();
      };
      const utterance = new SpeechSynthesisUtterance(text.replace(/[„“]/g, ''));
      utterance.lang = 'de-DE';
      const voice = germanVoice();
      if (voice) utterance.voice = voice;
      utterance.rate = 1.05;
      utterance.onend = finish;
      utterance.onerror = finish;
      speechSynthesis.cancel();
      speechSynthesis.speak(utterance);
      setTimeout(finish, Math.min(20000, 1500 + text.length * 90)); // Sicherheitsnetz
    });
  }

  // ======================================================================
  // 5. Oberfläche
  // ======================================================================

  const ui = {
    root: document.getElementById('edith'),
    orb: document.getElementById('edith-orb'),
    panel: document.getElementById('edith-panel'),
    state: document.getElementById('edith-state'),
    log: document.getElementById('edith-log'),
    interim: document.getElementById('edith-interim'),
    form: document.getElementById('edith-form'),
    input: document.getElementById('edith-input'),
    close: document.getElementById('edith-close'),
    status: document.getElementById('assistant-status')
  };
  let hideTimer = null;

  function log(text, who) {
    const message = document.createElement('div');
    message.className = `edith-msg ${who}`;
    message.textContent = text;
    ui.log.appendChild(message);
    while (ui.log.children.length > 12) ui.log.firstChild.remove();
    ui.log.scrollTop = ui.log.scrollHeight;
  }

  function showPanel() {
    clearTimeout(hideTimer);
    ui.panel.hidden = false;
  }

  function hidePanelSoon(delay = 8000) {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      const busy = state.conversation || state.awaiting || document.activeElement === ui.input || ui.panel.matches(':hover');
      if (busy) {
        hidePanelSoon(delay);
      } else {
        ui.panel.hidden = true;
      }
    }, delay);
  }

  function finishConversation() {
    updateUi();
    refreshListening();
    hidePanelSoon();
  }

  function setStatus(text, warn = false) {
    ui.status.textContent = text;
    ui.status.classList.toggle('warn', warn);
  }

  function updateStatus() {
    if (!state.enabled) {
      setStatus('');
    } else if (state.muted) {
      setStatus('🔇 Edith ist stummgeschaltet und nimmt nichts auf. Doppelklick (oder lange drücken) auf den roten Knopf unten links schaltet sie wieder ein.');
    } else if (!Recognition) {
      setStatus('Dein Browser kann keine Sprache erkennen – nutze Chrome oder Edge. Schreiben im Edith-Fenster (Knopf unten links) geht trotzdem.', true);
    } else if (state.micBlocked) {
      setStatus('Das Mikrofon ist blockiert. Erlaube den Zugriff über das Symbol links in der Adressleiste (Website-Einstellungen → Mikrofon) und schalte Edith aus und wieder ein. Schreiben im Edith-Fenster geht trotzdem.', true);
    } else if (state.wakeWord) {
      setStatus('Edith hört zu. Sag zum Beispiel: „Edith, trag am 17. Oktober um 10 Uhr Zahnarzt ein.“');
    } else {
      setStatus('Klicke auf den runden Knopf unten links und sprich.');
    }
  }

  function updateUi() {
    const active = Boolean(state.awaiting || state.conversation);
    ui.orb.classList.toggle('speaking', state.speaking);
    ui.orb.classList.toggle('active', active && !state.speaking);
    ui.orb.classList.toggle('listening', state.running && !active && !state.speaking);
    ui.orb.classList.toggle('muted', state.muted);
    ui.orb.title = state.muted
      ? 'Stummgeschaltet – Doppelklick oder lange drücken zum Einschalten'
      : 'Klick: Edith ansprechen · Doppelklick oder lange drücken: stummschalten';
    ui.state.textContent = state.muted ? '🔇 stumm – du kannst nur schreiben'
      : state.speaking ? 'spricht …'
      : active && state.running ? 'hört zu – sprich jetzt'
      : active ? 'wartet auf deine Antwort'
      : state.running ? 'wartet auf „Edith“'
      : 'bereit';
  }

  function applySettings(settings) {
    const wasEnabled = state.enabled;
    state.enabled = Boolean(settings.assistantEnabled);
    state.wakeWord = Boolean(settings.assistantWakeWord);
    state.speakReplies = Boolean(settings.assistantSpeak);
    state.muted = settings.assistantMuted === true;
    ui.root.hidden = !state.enabled;
    if (state.muted) stopAwaiting();

    if (state.enabled && !wasEnabled) {
      state.micBlocked = false;
      reportedProblems.clear();
    }
    if (!state.enabled) {
      state.conversation = null;
      stopAwaiting();
      ui.panel.hidden = true;
      if (window.speechSynthesis) speechSynthesis.cancel();
    }
    // Pegelmesser nur, solange Edith eingeschaltet und nicht stumm ist (stumm = Mikrofon ganz frei)
    if (state.enabled && Recognition && !state.muted) {
      startMeter();
    } else {
      stopMeter();
    }
    if (!state.speakReplies && window.speechSynthesis) speechSynthesis.cancel();
    updateStatus();
    updateUi();
    refreshListening();
  }

  // ---------- Knopf: Klick = sprechen, Doppelklick oder lange drücken = stumm an/aus ----------
  // Stumm wird in den Einstellungen gespeichert (assistantMuted) und bleibt nach dem Neuladen bestehen.
  function setMuted(muted) {
    settings.assistantMuted = muted;
    applySettings(settings);
    saveSettings();
    showPanel();
    log(muted
      ? '🔇 Stummgeschaltet – ich nehme nichts mehr auf. Schreiben geht weiterhin. Doppelklick oder lange drücken schaltet mich wieder ein.'
      : '🎙️ Ich höre wieder zu.', 'bot');
    hidePanelSoon();
  }

  // Einfacher Klick: wie bisher Edith ansprechen
  function orbSingleClick() {
    showPanel();
    if (state.muted) {
      ui.input.focus();
      updateUi();
      return;
    }
    if (!Recognition || state.micBlocked) {
      ui.input.focus();
      updateStatus();
      return;
    }
    if (state.awaiting && !state.conversation) {
      stopAwaiting();
      finishConversation();
      return;
    }
    startAwaiting();
  }

  const LONG_PRESS_MS = 600;
  const DOUBLE_CLICK_MS = 260;
  let clickTimer = null;
  let pressTimer = null;
  let longPressed = false;

  // Lange drücken (Maus oder Finger): nach 0,6 s stumm an/aus
  ui.orb.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    longPressed = false;
    ui.orb.classList.add('pressing');
    pressTimer = setTimeout(() => {
      longPressed = true;
      ui.orb.classList.remove('pressing');
      setMuted(!state.muted);
    }, LONG_PRESS_MS);
  });
  const cancelPress = () => {
    clearTimeout(pressTimer);
    ui.orb.classList.remove('pressing');
  };
  ui.orb.addEventListener('pointerup', cancelPress);
  ui.orb.addEventListener('pointerleave', cancelPress);
  ui.orb.addEventListener('pointercancel', cancelPress);
  ui.orb.addEventListener('contextmenu', event => event.preventDefault()); // langes Drücken am Handy

  // Klick kurz abwarten: kommt ein zweiter, ist es ein Doppelklick
  ui.orb.addEventListener('click', () => {
    if (longPressed) {
      longPressed = false;
      return;
    }
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
      setMuted(!state.muted);
      return;
    }
    clickTimer = setTimeout(() => {
      clickTimer = null;
      orbSingleClick();
    }, DOUBLE_CLICK_MS);
  });
  ui.form.addEventListener('submit', event => {
    event.preventDefault();
    const text = ui.input.value;
    ui.input.value = '';
    liveText = '';
    ui.input.classList.remove('live');
    handle(text);
  });
  ui.close.addEventListener('click', () => {
    ui.panel.hidden = true;
    if (state.conversation) {
      state.conversation = null;
      closeEditor();
    }
    stopAwaiting();
    updateUi();
    refreshListening();
  });

  document.addEventListener('settings-changed', event => applySettings(event.detail));
  if (window.speechSynthesis) speechSynthesis.addEventListener('voiceschanged', germanVoice);

  // Zum Testen und Weiter-Trainieren in der Browser-Konsole: Edith.parseCommand("…"), Edith.handle("…")
  // Edith.simulateHearing("…") zeigt den Text wie ein Zwischenergebnis der Spracherkennung an
  window.Edith = { handle, parseCommand, parseDate, parseTime, parseRepeat, matchWake, toNumber, simulateHearing: showLive };
})();
