// HTML entity mappings for decoding
export const HTML_ENTITIES = {
  "&nbsp;": " ", "&amp;": "&", "&oslash;": "ø", "&Oslash;": "Ø",
  "&aring;": "å", "&Aring;": "Å", "&aelig;": "æ", "&AElig;": "Æ",
  "&eacute;": "é", "&Eacute;": "É", "&ndash;": "–", "&mdash;": "—",
  "&quot;": '"', "&lt;": "<", "&gt;": ">", "&rsquo;": "'", "&lsquo;": "'",
};

// Patterns for detecting "no break-ins" statements
export const noBreakIns = {
  header: /ingen\s+(?:anmeldte\s+)?indbrud/i,
  notReported: /ikke\s+anmeldt\s+(?:nogen\s+)?indbrud/i,
  inText: /ikke\s+anmeldt\s+indbrud/i,
  zeroCount: /\b0\s+indbrud/,
};

// Patterns for identifying section headers
export const headers = {
  // Primary header patterns
  privateResidence: /^Indbrud i privat\s?beboelse[:.]?$/i,
  simpleIndbrud: /^Indbrud[:.]?$/i,
  recentReports: /^Seneste\s+døgns?\s+anmeldelser\s+om\s+indbrud/i,
  
  // Count summary patterns (e.g., "Der er anmeldt 5 indbrud...")
  countSummary: /anmeldt\s+(?:\d+|et|ét|én|en|to|tre|fire|fem|seks|syv|otte|ni|ti|elleve|tolv|tretten|fjorten|femten|følgende)?(?:\s+antal)?\s*indbrud/i,
  countSummaryAlt: /(?:\d+|et|ét|én|en|to|tre|fire|fem|seks|syv|otte|ni|ti|elleve|tolv|tretten|fjorten|femten)(?:\s+antal)?\s+indbrud\s+(?:i\s+privat|anmeldt)/i,
  countAfterHeader: /(?:Der (?:er|var)|Det seneste?)[^<]*?anmeldt\s+(?:\d+|et|ét|én|en|to|tre|fire|fem|seks|syv|otte|ni|ti)/i,
};

// HTML tag patterns for finding headers
export const headerTags = {
  h2h3: /<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi,
  pStrong: /<p[^>]*>(?:\s*<span[^>]*>)?\s*<strong[^>]*>([\s\S]*?)<\/strong>(?:\s*<\/span>)?\s*<\/p>/gi,
  pStrongContent: /<p[^>]*>\s*<strong[^>]*>[\s\S]*?<\/strong>\s*<\/p>/gi,
  
  // Fallback patterns for less structured content
  plainIndbrud: /(?:^|>)\s*Indbrud(?:\s+i\s+privat\s?beboelse)?[:.]?\s*<br/gi,
  strongIndbrud: /<strong[^>]*>(?:\s*<br\s*\/?>)*\s*Indbrud(?:\s+i\s+privat\s?beboelse)?[^<]*?(?:<span[^>]*>\s*<\/span>)?\s*<\/strong>/gi,
  strongCount: /<strong[^>]*>(?:Der (?:er|var)|Det seneste?)[^<]*?anmeldt\s+(?:\d+|et|ét|én|en|to|tre|fire|fem|seks|syv|otte|ni|ti|elleve|tolv|tretten|fjorten|femten|følgende)(?:\s+antal)?\s+indbrud[\s\S]*?<\/strong>/gi,
  strongSpanStart: /<strong[^>]*>\s*<span[^>]*>(?:\s*<br\s*\/?>)*\s*Indbrud(?:\s+i\s+privat\s?beboelse)?[:.]?\s*(?:<br\s*\/?>)?\s*<\/span>\s*<\/strong>/gi,
  strongSpanCount: /<strong[^>]*>\s*<span[^>]*>(?:\s*<br\s*\/?>)*\s*(?:Der (?:er|var)|Det seneste?)[^<]*?anmeldt\s+(?:\d+|et|ét|én|en|to|tre|fire|fem|seks|syv|otte|ni|ti|elleve|tolv|tretten|fjorten|femten|følgende)(?:\s+antal)?\s+indbrud[\s\S]*?<\/span>\s*<\/strong>/gi,
  strongSpanIndbrud: /<strong[^>]*>\s*<span[^>]*>[\s\S]*?Indbrud(?:\s+i\s+privat\s?beboelse)?[:.]?[\s\S]*?<\/span>\s*<\/strong>/gi,
  
  // Count summary as plain text (no header)
  countSummaryPlain: /(?:Der (?:er|var)|Det seneste?)[^<]*?anmeldt\s+(?:\d+|et|ét|én|en|to|tre|fire|fem|seks|syv|otte|ni|ti|elleve|tolv|tretten|fjorten|femten|følgende)?(?:\s+antal)?\s*indbrud[^<]*?(?:politikreds|beboelse)/gi,
};

// Patterns for identifying break-in entry lines
export const entries = {
  // Standard format: "På [address] i [city] begået..."
  paaAddress: /^På\s+.+(?:begået|sket|mellem|kl\.|d\.)/i,
  
  // "Sket [location]" format
  sket: /^Sket\s+[A-ZÆØÅ]/i,
  
  // Postal code format: "8000 Aarhus... begået/sket"
  postalCode: /\d{4}\s+[A-ZÆØÅa-zæøå]+.*(?:begået|sket)/i,
  
  // Address with city: "[Street] i [City]... begået"
  addressCity: /^[A-ZÆØÅ][a-zæøåA-ZÆØÅ\s\.\-']+\s+(?:i\s+)?[A-ZÆØÅ][a-zæøå]+.*begået/i,
  
  // Weekday format: "Mandag d. 5... på [address]"
  weekday: /^(?:Mellem\s+)?(?:mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag)\s+(?:den\s+)?\d+.*på\s+[A-ZÆØÅ]/i,
  
  // Relaxed "På... begået/sket" (for final fallback)
  paaRelaxed: /^På\s+.+(?:begået|sket)/i,
  
  // Postal code with "sket" only
  postalCodeSket: /\d{4}\s+[A-ZÆØÅa-zæøå]+.*sket/i,
  
  // Extract "På ... begået ... kl/d." from plain text
  paaExtract: /På\s+[A-ZÆØÅa-zæøå][^.]*?begået[^.]*?(?:kl\.\s*\d[\d.:]+|d\.\s*\d+\/\d+)[^.]*/gi,
};

// HTML extraction patterns
export const html = {
  listItem: /<li[^>]*>([\s\S]*?)<\/li>/gi,
  paragraph: /<p[^>]*>([\s\S]*?)<\/p>/gi,
  brSplit: /<br\s*\/?>/i,
  numericEntity: /&#(\d+);/g,
  namedEntity: /&[a-z]+;/gi,
  tags: /<[^>]+>/g,
  whitespace: /\s+/g,
  bulletPrefix: /^["•\-\*\t]\s*/,
  indbrudInHeader: /Indbrud[:.]?\s*<br/i,
};

// URL patterns
export const url = {
  dateFromPath: /\/(\d{4})\/(\d{2})\/(\d{2})\/?$/,
};

// Helper functions

export function decode(text) {
  let result = text;
  for (const [entity, char] of Object.entries(HTML_ENTITIES)) {
    result = result.replaceAll(entity, char);
  }
  return result
    .replace(html.numericEntity, (_, code) => String.fromCharCode(+code))
    .replace(html.namedEntity, " ");
}

export function stripHtml(text) {
  return text.replace(html.tags, "").replace(html.whitespace, " ").trim();
}

export function isNoBreakInsHeader(text) {
  return noBreakIns.header.test(text) || noBreakIns.notReported.test(text);
}

export function isIndbrudHeader(text) {
  return headers.privateResidence.test(text) ||
         headers.countSummary.test(text) ||
         headers.recentReports.test(text);
}

export function isSimpleIndbrudHeader(text) {
  return headers.simpleIndbrud.test(text);
}

export function isCountSummaryHeader(text) {
  return headers.countSummary.test(text) || headers.countSummaryAlt.test(text);
}

export function isEntryLine(text) {
  return entries.paaAddress.test(text) ||
         entries.sket.test(text) ||
         entries.postalCode.test(text) ||
         entries.addressCity.test(text) ||
         entries.weekday.test(text);
}

export function isEntryLineRelaxed(text) {
  return entries.paaRelaxed.test(text) ||
         entries.sket.test(text) ||
         entries.postalCodeSket.test(text) ||
         entries.addressCity.test(text) ||
         entries.weekday.test(text);
}

export function hasNoBreakInsInText(text) {
  const lower = text.toLowerCase();
  return noBreakIns.inText.test(text) ||
         (lower.includes("ikke") && lower.includes("meldt") && lower.includes("indbrud")) ||
         (lower.includes("ikke") && lower.includes("modtaget") && lower.includes("anmeldelse")) ||
         lower.includes("ingen indbrud") ||
         lower.includes("ingen anmeldte indbrud") ||
         noBreakIns.zeroCount.test(text);
}

export function dateFromUrl(url) {
  const match = url.match(url.dateFromPath);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

export function cleanEntryLine(text) {
  return text.replace(html.bulletPrefix, "");
}