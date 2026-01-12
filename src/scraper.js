const INPUT_FILE = "../data/reports_cache.json";
const OUTPUT_FILE = "../data/indbrud_data.json";
const FAILURES_FILE = "../data/indbrud_failures.json";

const HTML_ENTITIES = {
  "&nbsp;": " ", "&amp;": "&", "&oslash;": "ø", "&Oslash;": "Ø",
  "&aring;": "å", "&Aring;": "Å", "&aelig;": "æ", "&AElig;": "Æ",
  "&eacute;": "é", "&Eacute;": "É", "&ndash;": "–", "&mdash;": "—",
  "&quot;": '"', "&lt;": "<", "&gt;": ">", "&rsquo;": "'", "&lsquo;": "'",
};

const DANISH_NUMBERS = /(?:\d+|et|en|to|tre|fire|fem|seks|syv|otte|ni|ti|elleve|tolv|tretten|fjorten|femten)/i;

function decode(text) {
  let r = text;
  for (const [e, c] of Object.entries(HTML_ENTITIES)) r = r.replaceAll(e, c);
  return r.replace(/&#(\d+);/g, (_, c) => String.fromCharCode(+c)).replace(/&[a-z]+;/gi, " ");
}

function strip(html) {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function isCountSummaryHeader(text) {
  return DANISH_NUMBERS.test(text) && /indbrud/i.test(text) && /anmeldt|privat beboelse/i.test(text);
}

function dateFromUrl(url) {
  const m = url.match(/\/(\d{4})\/(\d{2})\/(\d{2})\/?$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function extractBreakIns(html) {
  html = decode(html);
  
  // Find the dedicated "Indbrud" section header (h2, h3, or <p><strong>)
  // Prioritize "Indbrud i privat beboelse" over just "Indbrud"
  let indbudHeader = null;
  let fallbackHeader = null;
  
  // Try h2/h3 first
  const headerRe = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi;
  let headerMatch;
  while ((headerMatch = headerRe.exec(html)) !== null) {
    const innerText = strip(headerMatch[1]);
    if (/^Indbrud i privat beboelse[:.]?$/i.test(innerText) || isCountSummaryHeader(innerText)) {
      indbudHeader = { match: headerMatch[0], index: headerMatch.index };
      break;
    }
    if (!fallbackHeader && /^Indbrud[:.]?$/i.test(innerText)) {
      fallbackHeader = { match: headerMatch[0], index: headerMatch.index };
    }
  }
  
  // Fallback: try <p><strong> headers
  if (!indbudHeader) {
    const pStrongRe = /<p[^>]*>\s*<strong[^>]*>([\s\S]*?)<\/strong>\s*<\/p>/gi;
    while ((headerMatch = pStrongRe.exec(html)) !== null) {
      const innerText = strip(headerMatch[1]);
      if (/^Indbrud i privat beboelse[:.]?$/i.test(innerText)) {
        indbudHeader = { match: headerMatch[0], index: headerMatch.index };
        break;
      }
      if (!fallbackHeader && /^Indbrud[:.]?$/i.test(innerText)) {
        fallbackHeader = { match: headerMatch[0], index: headerMatch.index };
      }
    }
  }
  
  // Use fallback if no specific header found
  if (!indbudHeader) indbudHeader = fallbackHeader;
  if (!indbudHeader) return { entries: [], status: "no_section" };
  
  // Get content after header until next section
  const start = indbudHeader.index + indbudHeader.match.length;
  
  // Find next header (h2, h3, or <p><strong>)
  let nextHeader = -1;
  const nextH2 = html.indexOf("<h2", start);
  const nextH3 = html.indexOf("<h3", start);
  
  // Find next <p><strong> that looks like a section header
  let nextPStrong = -1;
  const pStrongRe2 = /<p[^>]*>\s*<strong[^>]*>[\s\S]*?<\/strong>\s*<\/p>/gi;
  pStrongRe2.lastIndex = start;
  const pMatch = pStrongRe2.exec(html);
  if (pMatch) nextPStrong = pMatch.index;
  
  // Get earliest header
  const candidates = [nextH2, nextH3, nextPStrong].filter(x => x > 0);
  nextHeader = candidates.length > 0 ? Math.min(...candidates) : -1;
  
  // Skip count summary and empty headers
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
  const text = strip(section).toLowerCase();
  
  // Check for "no break-ins"
  if ((text.includes("ikke") && text.includes("meldt") && text.includes("indbrud")) ||
      (text.includes("ikke") && text.includes("modtaget") && text.includes("anmeldelse")) ||
      text.includes("ingen indbrud") || text.includes("ingen anmeldte indbrud") ||
      /\b0\s+indbrud/.test(text)) {
    return { entries: [], status: "no_breakins" };
  }
  
  const entries = [];
  let m;
  
  // Try <li> tags first
  const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  while ((m = liRe.exec(section)) !== null) {
    const entry = strip(m[1]);
    if (entry.length > 10) entries.push(entry);
  }
  
  // Fallback: <p> tags with break-in patterns
  if (entries.length === 0) {
    const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    while ((m = pRe.exec(section)) !== null) {
      const entry = strip(m[1]);
      if (/^På\s+.+(?:begået|sket|mellem|kl\.|d\.)/i.test(entry) ||
          /\d{4}\s+[A-ZÆØÅa-zæøå]+.*(?:begået|sket)/i.test(entry)) {
        entries.push(entry);
      }
    }
  }
  
  // Fallback: entries separated by <br>
  if (entries.length === 0) {
    const brLines = section.split(/<br\s*\/?>/i).map(s => strip(s));
    for (const line of brLines) {
      const cleaned = line.replace(/^["•\-\*]\s*/, "");
      if (/^På\s+.+(?:begået|sket|mellem|kl\.|d\.)/i.test(cleaned) ||
          /\d{4}\s+[A-ZÆØÅa-zæøå]+.*(?:begået|sket)/i.test(cleaned)) {
        entries.push(cleaned);
      }
    }
  }
  
  // Last fallback: extract "På ... begået" from anywhere
  if (entries.length === 0) {
    const plainText = strip(section);
    const paaRe = /På\s+[A-ZÆØÅa-zæøå][^.]*?begået[^.]*?(?:kl\.\s*\d[\d.:]+|d\.\s*\d+\/\d+)[^.]*/gi;
    while ((m = paaRe.exec(plainText)) !== null) {
      entries.push(m[0].trim());
    }
  }
  
  // Final fallback: split by <br> for more patterns
  if (entries.length === 0) {
    const lines = section.split(/<br\s*\/?>/i).map(s => strip(s)).filter(s => s.length > 10);
    for (const line of lines) {
      const cleaned = line.replace(/^["•\-\*]\s*/, "");
      if (/^På\s+.+(?:begået|sket)/i.test(cleaned) ||
          /\d{4}\s+[A-ZÆØÅa-zæøå]+.*sket/i.test(cleaned)) {
        entries.push(cleaned);
      }
    }
  }
  
  if (entries.length === 0) return { entries: [], status: "no_entries" };
  return { entries, status: "found" };
}

async function loadJson(path) {
  const f = Bun.file(path);
  return await f.exists() ? await f.json() : null;
}

function debugReport(html) {
  html = decode(html);
  let found = null;
  let fallback = null;
  
  const headerRe = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi;
  let hm;
  while ((hm = headerRe.exec(html)) !== null) {
    const innerText = strip(hm[1]);
    if (/^Indbrud i privat beboelse[:.]?$/i.test(innerText) || isCountSummaryHeader(innerText)) {
      found = hm;
      break;
    }
    if (!fallback && /^Indbrud[:.]?$/i.test(innerText)) {
      fallback = hm;
    }
  }
  
  if (!found) {
    const pStrongRe = /<p[^>]*>\s*<strong[^>]*>([\s\S]*?)<\/strong>\s*<\/p>/gi;
    while ((hm = pStrongRe.exec(html)) !== null) {
      const innerText = strip(hm[1]);
      if (/^Indbrud i privat beboelse[:.]?$/i.test(innerText)) {
        found = hm;
        break;
      }
      if (!fallback && /^Indbrud[:.]?$/i.test(innerText)) {
        fallback = hm;
      }
    }
  }
  
  if (!found) found = fallback;
  
  console.log(`  DEBUG header found: ${!!found}`);
  if (found) {
    console.log(`  DEBUG header: ${found[0].substring(0, 100)}`);
    const start = found.index + found[0].length;
    
    let nextHeader = -1;
    const nextH2 = html.indexOf("<h2", start);
    const nextH3 = html.indexOf("<h3", start);
    const pStrongRe2 = /<p[^>]*>\s*<strong[^>]*>[\s\S]*?<\/strong>\s*<\/p>/gi;
    pStrongRe2.lastIndex = start;
    const pMatch = pStrongRe2.exec(html);
    const nextPStrong = pMatch ? pMatch.index : -1;
    
    const candidates = [nextH2, nextH3, nextPStrong].filter(x => x > 0);
    nextHeader = candidates.length > 0 ? Math.min(...candidates) : -1;
    
    while (nextHeader > 0) {
      let headerEnd = -1;
      let hText = "";
      if (html.substring(nextHeader, nextHeader + 3) === "<h2" || 
          html.substring(nextHeader, nextHeader + 3) === "<h3") {
        const closeTag = html.indexOf(">", html.indexOf("</h", nextHeader));
        if (closeTag > 0) {
          headerEnd = closeTag + 1;
          hText = strip(html.substring(nextHeader, headerEnd));
        }
      } else {
        const closeP = html.indexOf("</p>", nextHeader);
        if (closeP > 0) {
          headerEnd = closeP + 4;
          hText = strip(html.substring(nextHeader, headerEnd));
        }
      }
      if (headerEnd < 0) break;
      const isEmpty = hText.length < 5;
      const isSummary = isCountSummaryHeader(hText);
      if (isEmpty || isSummary) {
        console.log(`  DEBUG skipping header: "${hText.substring(0, 60)}" (empty=${isEmpty})`);
        const afterThis = headerEnd;
        const nH2 = html.indexOf("<h2", afterThis);
        const nH3 = html.indexOf("<h3", afterThis);
        pStrongRe2.lastIndex = afterThis;
        const nPMatch = pStrongRe2.exec(html);
        const nPStrong = nPMatch ? nPMatch.index : -1;
        const cands = [nH2, nH3, nPStrong].filter(x => x > 0);
        nextHeader = cands.length > 0 ? Math.min(...cands) : -1;
      } else break;
    }
    
    const section = html.substring(start, nextHeader > 0 ? nextHeader : undefined);
    console.log(`  DEBUG section length: ${section.length}`);
    console.log(`  DEBUG has <li>: ${section.includes("<li>")}`);
    console.log(`  DEBUG section:\n${section.substring(0, 800)}\n`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const retryMode = args.includes("--retry");
  const debug = args.includes("--debug");
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : Infinity;
  
  const cache = await loadJson(INPUT_FILE);
  if (!cache?.reports) {
    console.error(`No reports found in ${INPUT_FILE}`);
    process.exit(1);
  }
  
  const existingResults = await loadJson(OUTPUT_FILE) || [];
  const existingFailures = await loadJson(FAILURES_FILE) || [];
  
  let urlsToProcess;
  if (retryMode) {
    urlsToProcess = existingFailures.slice(0, limit).map(f => f.url);
    console.log(`Retrying ${urlsToProcess.length} of ${existingFailures.length} failed reports...\n`);
  } else {
    urlsToProcess = Object.keys(cache.reports).slice(0, limit);
    console.log(`Processing ${urlsToProcess.length} of ${Object.keys(cache.reports).length} reports...\n`);
  }
  
  const results = [];
  const failures = [];
  const stats = { found: 0, no_section: 0, no_breakins: 0, no_entries: 0 };
  
  for (const url of urlsToProcess) {
    const report = cache.reports[url];
    const date = dateFromUrl(url);
    
    if (!report?.content) {
      failures.push({ url, reason: "no_content", date });
      stats.no_entries++;
      console.log(`✗ ${date}: no content in cache`);
      continue;
    }
    
    const { entries, status } = extractBreakIns(report.content);
    stats[status]++;
    
    if (status === "found") {
      results.push({ url, date, entries });
      console.log(`✓ ${date}: ${entries.length} entries`);
    } else if (status === "no_breakins") {
      console.log(`○ ${date}: no break-ins reported`);
    } else {
      failures.push({ url, reason: status, date });
      console.log(`✗ ${date}: ${status}`);
      if (debug) debugReport(report.content);
    }
  }
  
  let finalResults, finalFailures;
  if (retryMode) {
    const fixedUrls = new Set(results.map(r => r.url));
    finalResults = [...existingResults, ...results];
    finalFailures = [...existingFailures.filter(f => !fixedUrls.has(f.url)), ...failures];
  } else {
    finalResults = results;
    finalFailures = failures;
  }
  
  finalResults.sort((a, b) => b.date.localeCompare(a.date));
  
  await Bun.write(OUTPUT_FILE, JSON.stringify(finalResults, null, 2));
  await Bun.write(FAILURES_FILE, JSON.stringify(finalFailures, null, 2));
  
  console.log(`\n--- Summary ---`);
  console.log(`Found: ${stats.found} | No break-ins: ${stats.no_breakins} | No section: ${stats.no_section} | No entries: ${stats.no_entries}`);
  console.log(`\nOutput: ${OUTPUT_FILE} (${finalResults.length} reports)`);
  console.log(`Failures: ${FAILURES_FILE} (${finalFailures.length} reports)`);
}

main();