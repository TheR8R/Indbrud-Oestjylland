import { loadJson, saveJson } from "./util/saveFile.js";
import { paths } from "./util/config.js";

const HTML_ENTITIES = {
  "&nbsp;": " ", "&amp;": "&", "&oslash;": "ø", "&Oslash;": "Ø",
  "&aring;": "å", "&Aring;": "Å", "&aelig;": "æ", "&AElig;": "Æ",
  "&eacute;": "é", "&Eacute;": "É", "&ndash;": "–", "&mdash;": "—",
  "&quot;": '"', "&lt;": "<", "&gt;": ">", "&rsquo;": "'", "&lsquo;": "'",
};

function decode(text) {
  let r = text;
  for (const [e, c] of Object.entries(HTML_ENTITIES)) r = r.replaceAll(e, c);
  return r.replace(/&#(\d+);/g, (_, c) => String.fromCharCode(+c)).replace(/&[a-z]+;/gi, " ");
}

function strip(html) {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function isCountSummaryHeader(text) {
  return /anmeldt\s+(?:\d+|et|ét|én|en|to|tre|fire|fem|seks|syv|otte|ni|ti|elleve|tolv|tretten|fjorten|femten|følgende)?(?:\s+antal)?\s*indbrud/i.test(text) ||
         /(?:\d+|et|ét|én|en|to|tre|fire|fem|seks|syv|otte|ni|ti|elleve|tolv|tretten|fjorten|femten)(?:\s+antal)?\s+indbrud\s+(?:i\s+privat|anmeldt)/i.test(text);
}

function dateFromUrl(url) {
  const m = url.match(/\/(\d{4})\/(\d{2})\/(\d{2})\/?$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function extractBreakIns(html) {
  html = decode(html);
  
  let indbudHeader = null;
  let fallbackHeader = null;
  
  const headerRe = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi;
  let headerMatch;
  let fallbackHeaders = [];
  while ((headerMatch = headerRe.exec(html)) !== null) {
    const innerText = strip(headerMatch[1]);
    if (/ingen\s+(?:anmeldte\s+)?indbrud/i.test(innerText) ||
        /ikke\s+anmeldt\s+(?:nogen\s+)?indbrud/i.test(innerText)) {
      return { entries: [], status: "no_breakins" };
    }
    if (/^Indbrud i privat\s?beboelse[:.]?$/i.test(innerText) || 
        isCountSummaryHeader(innerText) ||
        /^Seneste\s+døgns?\s+anmeldelser\s+om\s+indbrud/i.test(innerText)) {
      indbudHeader = { match: headerMatch[0], index: headerMatch.index };
      break;
    }
    if (/^Indbrud[:.]?$/i.test(innerText)) {
      fallbackHeaders.push({ match: headerMatch[0], index: headerMatch.index });
    }
  }
  
  if (!indbudHeader && fallbackHeaders.length > 0) {
    for (const fh of fallbackHeaders) {
      const afterHeader = html.substring(fh.index + fh.match.length, fh.index + fh.match.length + 500);
      if (/(?:Der (?:er|var)|Det seneste?)[^<]*?anmeldt\s+(?:\d+|et|ét|én|en|to|tre|fire|fem|seks|syv|otte|ni|ti)/i.test(afterHeader)) {
        fallbackHeader = fh;
        break;
      }
    }
    if (!fallbackHeader) fallbackHeader = fallbackHeaders[0];
  }
  
  if (!indbudHeader) {
    const pStrongRe = /<p[^>]*>(?:\s*<span[^>]*>)?\s*<strong[^>]*>([\s\S]*?)<\/strong>(?:\s*<\/span>)?\s*<\/p>/gi;
    while ((headerMatch = pStrongRe.exec(html)) !== null) {
      const innerText = strip(headerMatch[1]);
      if (/ingen\s+(?:anmeldte\s+)?indbrud/i.test(innerText) ||
          /ikke\s+anmeldt\s+(?:nogen\s+)?indbrud/i.test(innerText)) {
        return { entries: [], status: "no_breakins" };
      }
      if (/^Indbrud i privat\s?beboelse[:.]?$/i.test(innerText)) {
        indbudHeader = { match: headerMatch[0], index: headerMatch.index };
        break;
      }
      if (!fallbackHeader && /^Indbrud[:.]?$/i.test(innerText)) {
        fallbackHeader = { match: headerMatch[0], index: headerMatch.index };
      }
    }
  }
  
  if (!indbudHeader) indbudHeader = fallbackHeader;
  
  if (!indbudHeader) {
    const countSummaryRe = /(?:Der (?:er|var)|Det seneste?)[^<]*?anmeldt\s+(?:\d+|et|ét|én|en|to|tre|fire|fem|seks|syv|otte|ni|ti|elleve|tolv|tretten|fjorten|femten|følgende)?(?:\s+antal)?\s*indbrud[^<]*?(?:politikreds|beboelse)/gi;
    const match = countSummaryRe.exec(html);
    if (match) {
      indbudHeader = { match: match[0], index: match.index };
    }
  }
  
  if (!indbudHeader) {
    const plainIndbudRe = /(?:^|>)\s*Indbrud(?:\s+i\s+privat\s?beboelse)?[:.]?\s*<br/gi;
    const match = plainIndbudRe.exec(html);
    if (match) {
      indbudHeader = { match: match[0], index: match.index };
    }
  }
  
  if (!indbudHeader) {
    const strongIndbudRe = /<strong[^>]*>(?:\s*<br\s*\/?>)*\s*Indbrud(?:\s+i\s+privat\s?beboelse)?[^<]*?(?:<span[^>]*>\s*<\/span>)?\s*<\/strong>/gi;
    const match = strongIndbudRe.exec(html);
    if (match) {
      indbudHeader = { match: match[0], index: match.index };
    }
  }
  
  if (!indbudHeader) {
    const strongCountRe = /<strong[^>]*>(?:Der (?:er|var)|Det seneste?)[^<]*?anmeldt\s+(?:\d+|et|ét|én|en|to|tre|fire|fem|seks|syv|otte|ni|ti|elleve|tolv|tretten|fjorten|femten|følgende)(?:\s+antal)?\s+indbrud[\s\S]*?<\/strong>/gi;
    const match = strongCountRe.exec(html);
    if (match) {
      indbudHeader = { match: match[0], index: match.index };
    }
  }
  
  if (!indbudHeader) {
    const strongSpanStartRe = /<strong[^>]*>\s*<span[^>]*>(?:\s*<br\s*\/?>)*\s*Indbrud(?:\s+i\s+privat\s?beboelse)?[:.]?\s*(?:<br\s*\/?>)?\s*<\/span>\s*<\/strong>/gi;
    const match = strongSpanStartRe.exec(html);
    if (match) {
      indbudHeader = { match: match[0], index: match.index };
    }
  }
  
  if (!indbudHeader) {
    const strongSpanCountRe = /<strong[^>]*>\s*<span[^>]*>(?:\s*<br\s*\/?>)*\s*(?:Der (?:er|var)|Det seneste?)[^<]*?anmeldt\s+(?:\d+|et|ét|én|en|to|tre|fire|fem|seks|syv|otte|ni|ti|elleve|tolv|tretten|fjorten|femten|følgende)(?:\s+antal)?\s+indbrud[\s\S]*?<\/span>\s*<\/strong>/gi;
    const match = strongSpanCountRe.exec(html);
    if (match) {
      indbudHeader = { match: match[0], index: match.index };
    }
  }
  
  if (!indbudHeader) {
    const strongSpanIndbudRe = /<strong[^>]*>\s*<span[^>]*>[\s\S]*?Indbrud(?:\s+i\s+privat\s?beboelse)?[:.]?[\s\S]*?<\/span>\s*<\/strong>/gi;
    let match;
    while ((match = strongSpanIndbudRe.exec(html)) !== null) {
      const innerText = strip(match[0]);
      if (/^Indbrud(?:\s+i\s+privat\s?beboelse)?[:.]?$/i.test(innerText)) {
        indbudHeader = { match: match[0], index: match.index };
        break;
      }
    }
  }
  
  if (!indbudHeader) return { entries: [], status: "no_section" };
  
  const start = indbudHeader.index + indbudHeader.match.length;
  
  let nextHeader = -1;
  const nextH2 = html.indexOf("<h2", start);
  const nextH3 = html.indexOf("<h3", start);
  
  let nextPStrong = -1;
  const pStrongRe2 = /<p[^>]*>\s*<strong[^>]*>[\s\S]*?<\/strong>\s*<\/p>/gi;
  pStrongRe2.lastIndex = start;
  const pMatch = pStrongRe2.exec(html);
  if (pMatch) nextPStrong = pMatch.index;
  
  const candidates = [nextH2, nextH3, nextPStrong].filter(x => x > 0);
  nextHeader = candidates.length > 0 ? Math.min(...candidates) : -1;
  
  while (nextHeader > 0) {
    let headerEnd = -1;
    let headerContent = "";
    
    if (html.substring(nextHeader, nextHeader + 3) === "<h2" || 
        html.substring(nextHeader, nextHeader + 3) === "<h3") {
      const closeTag = html.indexOf(">", html.indexOf("</h", nextHeader));
      if (closeTag > 0) {
        headerEnd = closeTag + 1;
        headerContent = strip(html.substring(nextHeader, headerEnd));
      }
    } else {
      const closeP = html.indexOf("</p>", nextHeader);
      if (closeP > 0) {
        headerEnd = closeP + 4;
        headerContent = strip(html.substring(nextHeader, headerEnd));
      }
    }
    
    if (headerEnd < 0) break;
    
    const isEmpty = headerContent.length < 5;
    const isSummary = isCountSummaryHeader(headerContent);
    
    if (isEmpty || isSummary) {
      const afterThis = headerEnd;
      const nH2 = html.indexOf("<h2", afterThis);
      const nH3 = html.indexOf("<h3", afterThis);
      pStrongRe2.lastIndex = afterThis;
      const nPMatch = pStrongRe2.exec(html);
      const nPStrong = nPMatch ? nPMatch.index : -1;
      
      const cands = [nH2, nH3, nPStrong].filter(x => x > 0);
      nextHeader = cands.length > 0 ? Math.min(...cands) : -1;
    } else {
      break;
    }
  }
  
  const section = html.substring(start, nextHeader > 0 ? nextHeader : undefined);
  
  let effectiveSection = section;
  let effectiveStart = start;
  if (section.length < 20 && nextHeader > 0) {
    const nextHeaderMatch = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi;
    nextHeaderMatch.lastIndex = nextHeader;
    const nm = nextHeaderMatch.exec(html);
    if (nm && /^Indbrud/i.test(strip(nm[1]))) {
      effectiveStart = nm.index + nm[0].length;
      let newNextHeader = -1;
      const newNextH2 = html.indexOf("<h2", effectiveStart);
      const newNextH3 = html.indexOf("<h3", effectiveStart);
      const newCandidates = [newNextH2, newNextH3].filter(x => x > 0);
      newNextHeader = newCandidates.length > 0 ? Math.min(...newCandidates) : -1;
      
      effectiveSection = html.substring(effectiveStart, newNextHeader > 0 ? newNextHeader : undefined);
    }
  }
  
  if (effectiveSection.length < 50 && indbudHeader.match.length > 100) {
    const indbudInHeader = indbudHeader.match.search(/Indbrud[:.]?\s*<br/i);
    if (indbudInHeader >= 0) {
      effectiveSection = indbudHeader.match.substring(indbudInHeader);
    }
  }
  
  const text = strip(effectiveSection).toLowerCase();
  
  const entries = [];
  let m;
  
  const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  while ((m = liRe.exec(effectiveSection)) !== null) {
    const entry = strip(m[1]);
    if (entry.length > 10) entries.push(entry);
  }
  
  if (entries.length === 0) {
    const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    while ((m = pRe.exec(effectiveSection)) !== null) {
      const pContent = m[1];
      if (/<br/i.test(pContent)) {
        const lines = pContent.split(/<br\s*\/?>/i).map(s => strip(s));
        for (const line of lines) {
          const cleaned = line.replace(/^["•\-\*\t]\s*/, "");
          if (/^På\s+.+(?:begået|sket|mellem|kl\.|d\.)/i.test(cleaned) ||
              /^Sket\s+[A-ZÆØÅ]/i.test(cleaned) ||
              /\d{4}\s+[A-ZÆØÅa-zæøå]+.*(?:begået|sket)/i.test(cleaned) ||
              /^[A-ZÆØÅ][a-zæøåA-ZÆØÅ\s\.\-']+\s+(?:i\s+)?[A-ZÆØÅ][a-zæøå]+.*begået/i.test(cleaned) ||
              /^(?:Mellem\s+)?(?:mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag)\s+(?:den\s+)?\d+.*på\s+[A-ZÆØÅ]/i.test(cleaned)) {
            entries.push(cleaned);
          }
        }
      } else {
        const entry = strip(pContent);
        if (/^På\s+.+(?:begået|sket|mellem|kl\.|d\.)/i.test(entry) ||
            /^Sket\s+[A-ZÆØÅ]/i.test(entry) ||
            /\d{4}\s+[A-ZÆØÅa-zæøå]+.*(?:begået|sket)/i.test(entry) ||
            /^[A-ZÆØÅ][a-zæøåA-ZÆØÅ\s\.\-']+\s+(?:i\s+)?[A-ZÆØÅ][a-zæøå]+.*begået/i.test(entry) ||
            /^(?:Mellem\s+)?(?:mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag)\s+(?:den\s+)?\d+.*på\s+[A-ZÆØÅ]/i.test(entry)) {
          entries.push(entry);
        }
      }
    }
  }
  
  if (entries.length === 0) {
    const brLines = effectiveSection.split(/<br\s*\/?>/i).map(s => strip(s));
    for (const line of brLines) {
      const cleaned = line.replace(/^["•\-\*\t]\s*/, "");
      if (/^På\s+.+(?:begået|sket|mellem|kl\.|d\.)/i.test(cleaned) ||
          /^Sket\s+[A-ZÆØÅ]/i.test(cleaned) ||
          /\d{4}\s+[A-ZÆØÅa-zæøå]+.*(?:begået|sket)/i.test(cleaned) ||
          /^[A-ZÆØÅ][a-zæøåA-ZÆØÅ\s\.\-']+\s+(?:i\s+)?[A-ZÆØÅ][a-zæøå]+.*begået/i.test(cleaned) ||
          /^(?:Mellem\s+)?(?:mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag)\s+(?:den\s+)?\d+.*på\s+[A-ZÆØÅ]/i.test(cleaned)) {
        entries.push(cleaned);
      }
    }
  }
  
  if (entries.length === 0) {
    const plainText = strip(effectiveSection);
    const paaRe = /På\s+[A-ZÆØÅa-zæøå][^.]*?begået[^.]*?(?:kl\.\s*\d[\d.:]+|d\.\s*\d+\/\d+)[^.]*/gi;
    while ((m = paaRe.exec(plainText)) !== null) {
      entries.push(m[0].trim());
    }
  }
  
  if (entries.length === 0) {
    const lines = effectiveSection.split(/<br\s*\/?>/i).map(s => strip(s)).filter(s => s.length > 10);
    for (const line of lines) {
      const cleaned = line.replace(/^["•\-\*\t]\s*/, "");
      if (/^På\s+.+(?:begået|sket)/i.test(cleaned) ||
          /^Sket\s+[A-ZÆØÅ]/i.test(cleaned) ||
          /\d{4}\s+[A-ZÆØÅa-zæøå]+.*sket/i.test(cleaned) ||
          /^[A-ZÆØÅ][a-zæøåA-ZÆØÅ\s\.\-']+\s+(?:i\s+)?[A-ZÆØÅ][a-zæøå]+.*begået/i.test(cleaned) ||
          /^(?:Mellem\s+)?(?:mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag)\s+(?:den\s+)?\d+.*på\s+[A-ZÆØÅ]/i.test(cleaned)) {
        entries.push(cleaned);
      }
    }
  }
  
  if (entries.length === 0) {
    if (/ikke\s+anmeldt\s+indbrud/i.test(text) ||
        (text.includes("ikke") && text.includes("meldt") && text.includes("indbrud")) ||
        (text.includes("ikke") && text.includes("modtaget") && text.includes("anmeldelse")) ||
        text.includes("ingen indbrud") || text.includes("ingen anmeldte indbrud") ||
        /\b0\s+indbrud/.test(text)) {
      return { entries: [], status: "no_breakins" };
    }
    return { entries: [], status: "no_entries" };
  }
  return { entries, status: "found" };
}

function debugReport(html) {
  html = decode(html);
  let found = null;
  let fallback = null;
  
  console.log(`  DEBUG searching for headers...`);
  
  const headerRe = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi;
  let hm;
  let fallbackHeaders = [];
  while ((hm = headerRe.exec(html)) !== null) {
    const innerText = strip(hm[1]);
    if (/ingen\s+(?:anmeldte\s+)?indbrud/i.test(innerText) ||
        /ikke\s+anmeldt\s+(?:nogen\s+)?indbrud/i.test(innerText)) {
      console.log(`  DEBUG found "no break-ins" header: ${innerText.substring(0, 80)}`);
      return;
    }
    if (/^Indbrud i privat\s?beboelse[:.]?$/i.test(innerText) || 
        isCountSummaryHeader(innerText) ||
        /^Seneste\s+døgns?\s+anmeldelser\s+om\s+indbrud/i.test(innerText)) {
      found = hm;
      console.log(`  DEBUG found h2/h3 header`);
      break;
    }
    if (/^Indbrud[:.]?$/i.test(innerText)) {
      fallbackHeaders.push(hm);
    }
  }
  
  if (!found && fallbackHeaders.length > 0) {
    console.log(`  DEBUG found ${fallbackHeaders.length} fallback Indbrud headers, checking for count summary...`);
    for (const fh of fallbackHeaders) {
      const afterHeader = html.substring(fh.index + fh[0].length, fh.index + fh[0].length + 500);
      if (/(?:Der (?:er|var)|Det seneste?)[^<]*?anmeldt\s+(?:\d+|et|ét|én|en|to|tre|fire|fem|seks|syv|otte|ni|ti)/i.test(afterHeader)) {
        fallback = fh;
        console.log(`  DEBUG selected fallback with count summary`);
        break;
      }
    }
    if (!fallback) fallback = fallbackHeaders[0];
  }
  
  if (!found) {
    console.log(`  DEBUG trying p/strong patterns...`);
    const pStrongRe = /<p[^>]*>(?:\s*<span[^>]*>)?\s*<strong[^>]*>([\s\S]*?)<\/strong>(?:\s*<\/span>)?\s*<\/p>/gi;
    while ((hm = pStrongRe.exec(html)) !== null) {
      const innerText = strip(hm[1]);
      if (/ingen\s+(?:anmeldte\s+)?indbrud/i.test(innerText) ||
          /ikke\s+anmeldt\s+(?:nogen\s+)?indbrud/i.test(innerText)) {
        console.log(`  DEBUG found "no break-ins" header: ${innerText.substring(0, 80)}`);
        return;
      }
      if (/^Indbrud i privat\s?beboelse[:.]?$/i.test(innerText)) {
        found = hm;
        console.log(`  DEBUG found p/strong header`);
        break;
      }
      if (!fallback && /^Indbrud[:.]?$/i.test(innerText)) {
        fallback = hm;
      }
    }
  }
  
  if (!found) found = fallback;
  
  if (!found) {
    console.log(`  DEBUG trying count summary pattern...`);
    const countSummaryRe = /(?:Der (?:er|var)|Det seneste?)[^<]*?anmeldt\s+(?:\d+|et|ét|én|en|to|tre|fire|fem|seks|syv|otte|ni|ti|elleve|tolv|tretten|fjorten|femten|følgende)?(?:\s+antal)?\s*indbrud[^<]*?(?:politikreds|beboelse)/gi;
    const match = countSummaryRe.exec(html);
    if (match) {
      found = match;
      console.log(`  DEBUG found count summary`);
    }
  }
  
  if (!found) {
    console.log(`  DEBUG trying plain Indbrud<br> pattern...`);
    const plainIndbudRe = /(?:^|>)\s*Indbrud(?:\s+i\s+privat\s?beboelse)?[:.]?\s*<br/gi;
    const match = plainIndbudRe.exec(html);
    if (match) {
      found = match;
      console.log(`  DEBUG found plain Indbrud<br>`);
    }
  }
  
  if (!found) {
    console.log(`  DEBUG trying strong>Indbrud</strong> pattern...`);
    const strongIndbudRe = /<strong[^>]*>(?:\s*<br\s*\/?>)*\s*Indbrud(?:\s+i\s+privat\s?beboelse)?[^<]*?(?:<span[^>]*>\s*<\/span>)?\s*<\/strong>/gi;
    const match = strongIndbudRe.exec(html);
    if (match) {
      found = match;
      console.log(`  DEBUG found: ${match[0]}`);
    }
  }
  
  if (!found) {
    console.log(`  DEBUG trying strong count summary pattern...`);
    const strongCountRe = /<strong[^>]*>(?:Der (?:er|var)|Det seneste?)[^<]*?anmeldt\s+(?:\d+|et|ét|én|en|to|tre|fire|fem|seks|syv|otte|ni|ti|elleve|tolv|tretten|fjorten|femten|følgende)(?:\s+antal)?\s+indbrud[\s\S]*?<\/strong>/gi;
    const match = strongCountRe.exec(html);
    if (match) {
      found = match;
      console.log(`  DEBUG found: ${match[0].substring(0, 100)}`);
    }
  }
  
  if (!found) {
    console.log(`  DEBUG trying strong/span with Indbrud at START pattern...`);
    const strongSpanStartRe = /<strong[^>]*>\s*<span[^>]*>(?:\s*<br\s*\/?>)*\s*Indbrud(?:\s+i\s+privat\s?beboelse)?[:.]?\s*(?:<br\s*\/?>)?\s*<\/span>\s*<\/strong>/gi;
    const match = strongSpanStartRe.exec(html);
    if (match) {
      found = match;
      console.log(`  DEBUG found: ${match[0]}`);
    }
  }
  
  if (!found) {
    console.log(`  DEBUG trying strong/span count summary pattern...`);
    const strongSpanCountRe = /<strong[^>]*>\s*<span[^>]*>(?:\s*<br\s*\/?>)*\s*(?:Der (?:er|var)|Det seneste?)[^<]*?anmeldt\s+(?:\d+|et|ét|én|en|to|tre|fire|fem|seks|syv|otte|ni|ti|elleve|tolv|tretten|fjorten|femten|følgende)(?:\s+antal)?\s+indbrud[\s\S]*?<\/span>\s*<\/strong>/gi;
    const match = strongSpanCountRe.exec(html);
    if (match) {
      found = match;
      console.log(`  DEBUG found: ${match[0].substring(0, 100)}`);
    }
  }
  
  if (!found) {
    console.log(`  DEBUG trying strong/span/Indbrud pattern...`);
    const strongSpanIndbudRe = /<strong[^>]*>\s*<span[^>]*>[\s\S]*?Indbrud(?:\s+i\s+privat\s?beboelse)?[:.]?[\s\S]*?<\/span>\s*<\/strong>/gi;
    let match;
    while ((match = strongSpanIndbudRe.exec(html)) !== null) {
      const innerText = strip(match[0]);
      console.log(`  DEBUG found strong/span with text: "${innerText.substring(0, 80)}"`);
      if (/^Indbrud(?:\s+i\s+privat\s?beboelse)?[:.]?$/i.test(innerText)) {
        found = match;
        console.log(`  DEBUG matched as header!`);
        break;
      }
    }
  }
  
  console.log(`  DEBUG header found: ${!!found}`);
  if (found) {
    const matchText = found[0];
    const matchIndex = found.index;
    console.log(`  DEBUG header: ${matchText.substring(0, 100)}`);
    const start = matchIndex + matchText.length;
    
    let nextHeader = -1;
    const nextH2 = html.indexOf("<h2", start);
    const nextH3 = html.indexOf("<h3", start);
    const candidates = [nextH2, nextH3].filter(x => x > 0);
    if (candidates.length > 0) {
      nextHeader = Math.min(...candidates);
      const closeTag = html.indexOf(">", html.indexOf("</h", nextHeader));
      if (closeTag > 0) {
        const hText = strip(html.substring(nextHeader, closeTag + 1));
        if (isCountSummaryHeader(hText) || hText.length < 5) {
          console.log(`  DEBUG skipping: "${hText.substring(0, 60)}"`);
          nextHeader = -1;
        }
      }
    }
    
    const section = html.substring(start, nextHeader > 0 ? nextHeader : undefined);
    console.log(`  DEBUG section length: ${section.length}`);
    console.log(`  DEBUG has <li>: ${section.includes("<li>")}`);
    
    const pMatches = section.match(/<p[^>]*>/gi) || [];
    console.log(`  DEBUG p tags found: ${pMatches.length}`);
    
    const brLines = section.split(/<br\s*\/?>/i).map(s => strip(s)).filter(s => s.length > 10);
    console.log(`  DEBUG lines after br split: ${brLines.length}`);
    for (let i = 0; i < Math.min(5, brLines.length); i++) {
      const line = brLines[i];
      const matchesPaa = /^På\s+.+(?:begået|sket|mellem|kl\.|d\.)/i.test(line);
      console.log(`  DEBUG line[${i}] (matches=${matchesPaa}): "${line.substring(0, 60)}..."`);
    }
    
    console.log(`  DEBUG section preview:\n${section.substring(0, 600)}\n`);
  } else {
    const indbudIdx = html.toLowerCase().indexOf('indbrud');
    if (indbudIdx >= 0) {
      console.log(`  DEBUG 'indbrud' found at index ${indbudIdx}`);
      console.log(`  DEBUG context: ...${html.substring(Math.max(0, indbudIdx - 50), indbudIdx + 200)}...`);
    } else {
      console.log(`  DEBUG 'indbrud' not found in HTML`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const retryMode = args.includes("--retry");
  const recentMode = args.includes("--recent");
  const debug = args.includes("--debug");
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : Infinity;
  
  const cache = await loadJson(paths.reportsCache);
  if (!cache?.reports) {
    console.error(`No reports found in ${paths.reportsCache}`);
    process.exit(1);
  }
  
  const existingResults = await loadJson(paths.indbudData, []);
  const existingFailures = await loadJson(paths.indbudFailures, []);
  const skipList = new Set((await loadJson(paths.skipList, [])).filter(u => u && u.length > 0));
  
  // Track already processed URLs
  const processedUrls = new Set([
    ...existingResults.map(r => r.url),
    ...existingFailures.map(f => f.url)
  ]);
  
  let urlsToProcess;
  if (retryMode) {
    urlsToProcess = existingFailures
      .filter(f => !skipList.has(f.url) && cache.reports[f.url]?.content)
      .slice(0, limit)
      .map(f => f.url);
    console.log(`Retrying ${urlsToProcess.length} of ${existingFailures.length} failed reports (${skipList.size} in skip list)...`);
  } else {
    const allUrls = Object.keys(cache.reports);
    let eligibleUrls = allUrls.filter(url => !skipList.has(url));
    
    if (recentMode) {
      eligibleUrls = eligibleUrls.filter(url => !processedUrls.has(url));
      console.log(`Processing ${eligibleUrls.length} new reports (${processedUrls.size} already processed)...`);
    } else {
      const skippedCount = allUrls.length - eligibleUrls.length;
      console.log(`Processing ${eligibleUrls.length} of ${allUrls.length} reports (${skippedCount} skipped)...`);
    }
    
    urlsToProcess = eligibleUrls.slice(0, limit);
  }
  
  const results = [];
  const failures = [];
  const stats = { found: 0, no_section: 0, no_breakins: 0, no_entries: 0, skipped: 0 };
  
  for (const url of urlsToProcess) {
    if (skipList.has(url)) {
      stats.skipped++;
      continue;
    }
    
    const report = cache.reports[url];
    const date = dateFromUrl(url);
    
    if (!report?.content) {
      failures.push({ url, reason: "no_content", date });
      stats.no_entries++;
      continue;
    }
    
    const { entries, status } = extractBreakIns(report.content);
    stats[status]++;
    
    if (status === "found") {
      results.push({ url, date, entries });
    } else {
      failures.push({ url, reason: status, date });
      if (debug) {
        console.log(`✗ ${date}: ${status}`);
        debugReport(report.content);
      }
    }
  }
  
  let finalResults, finalFailures;
  if (retryMode || recentMode) {
    const fixedUrls = new Set(results.map(r => r.url));
    finalResults = [...existingResults.filter(r => !fixedUrls.has(r.url)), ...results];
    finalFailures = [...existingFailures.filter(f => !fixedUrls.has(f.url) && !skipList.has(f.url)), ...failures];
  } else {
    finalResults = results;
    finalFailures = failures;
  }
  
  finalResults.sort((a, b) => b.date.localeCompare(a.date));
  
  await saveJson(paths.indbudData, finalResults, { log: false });
  await saveJson(paths.indbudFailures, finalFailures, { log: false });
  
  console.log(`\n--- Summary ---`);
  console.log(`Found: ${stats.found} | No break-ins: ${stats.no_breakins} | No section: ${stats.no_section} | No entries: ${stats.no_entries}`);
  const totalEntries = finalResults.reduce((sum, r) => sum + r.entries.length, 0);
  console.log(`Total entries: ${totalEntries}`);
  console.log(`\nOutput: ${paths.indbudData} (${finalResults.length} reports)`);
  console.log(`Failures: ${paths.indbudFailures} (${finalFailures.length} reports)`);
}

main();