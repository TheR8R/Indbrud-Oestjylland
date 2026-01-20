import { loadJson, saveJson } from "./util/saveFile.js";
import { paths } from "./util/config.js";
import * as p from "./util/patterns.js";

// --- Header Finding ---

function findH2H3Header(html) {
  const regex = new RegExp(p.headerTags.h2h3.source, "gi");
  let match;
  const fallbacks = [];
  
  while ((match = regex.exec(html)) !== null) {
    const text = p.stripHtml(match[1]);
    
    if (p.isNoBreakInsHeader(text)) {
      return { type: "no_breakins" };
    }
    if (p.isIndbrudHeader(text)) {
      return { match: match[0], index: match.index };
    }
    if (p.isSimpleIndbrudHeader(text)) {
      fallbacks.push({ match: match[0], index: match.index });
    }
  }
  
  // Check fallbacks for count summary following the header
  for (const fb of fallbacks) {
    const afterHeader = html.substring(fb.index + fb.match.length, fb.index + fb.match.length + 500);
    if (p.headers.countAfterHeader.test(afterHeader)) {
      return fb;
    }
  }
  
  return fallbacks[0] || null;
}

function findPStrongHeader(html) {
  const regex = new RegExp(p.headerTags.pStrong.source, "gi");
  let match;
  let fallback = null;
  
  while ((match = regex.exec(html)) !== null) {
    const text = p.stripHtml(match[1]);
    
    if (p.isNoBreakInsHeader(text)) {
      return { type: "no_breakins" };
    }
    if (p.headers.privateResidence.test(text)) {
      return { match: match[0], index: match.index };
    }
    if (!fallback && p.isSimpleIndbrudHeader(text)) {
      fallback = { match: match[0], index: match.index };
    }
  }
  
  return fallback;
}

function findFallbackHeader(html) {
  const patterns = [
    p.headerTags.countSummaryPlain,
    p.headerTags.plainIndbrud,
    p.headerTags.strongIndbrud,
    p.headerTags.strongCount,
    p.headerTags.strongSpanStart,
    p.headerTags.strongSpanCount,
  ];
  
  for (const pattern of patterns) {
    const regex = new RegExp(pattern.source, "gi");
    const match = regex.exec(html);
    if (match) {
      return { match: match[0], index: match.index };
    }
  }
  
  // Try strongSpanIndbrud with text validation
  const spanRegex = new RegExp(p.headerTags.strongSpanIndbrud.source, "gi");
  let match;
  while ((match = spanRegex.exec(html)) !== null) {
    const text = p.stripHtml(match[0]);
    if (/^Indbrud(?:\s+i\s+privat\s?beboelse)?[:.]?$/i.test(text)) {
      return { match: match[0], index: match.index };
    }
  }
  
  return null;
}

function findIndbrudHeader(html) {
  // Try structured headers first
  const h2h3 = findH2H3Header(html);
  if (h2h3?.type === "no_breakins") return h2h3;
  
  const pStrong = findPStrongHeader(html);
  if (pStrong?.type === "no_breakins") return pStrong;
  
  // Use first found or try fallbacks
  return h2h3 || pStrong || findFallbackHeader(html);
}

// --- Section Extraction ---

function findNextHeader(html, start) {
  const pStrongRegex = new RegExp(p.headerTags.pStrongContent.source, "gi");
  pStrongRegex.lastIndex = start;
  const pMatch = pStrongRegex.exec(html);
  
  const candidates = [
    html.indexOf("<h2", start),
    html.indexOf("<h3", start),
    pMatch?.index ?? -1,
  ].filter(x => x > 0);
  
  return candidates.length > 0 ? Math.min(...candidates) : -1;
}

function skipEmptyOrSummaryHeaders(html, nextHeader) {
  const pStrongRegex = new RegExp(p.headerTags.pStrongContent.source, "gi");
  
  while (nextHeader > 0) {
    let headerEnd = -1;
    let headerContent = "";
    
    const tag = html.substring(nextHeader, nextHeader + 3);
    if (tag === "<h2" || tag === "<h3") {
      const closeTag = html.indexOf(">", html.indexOf("</h", nextHeader));
      if (closeTag > 0) {
        headerEnd = closeTag + 1;
        headerContent = p.stripHtml(html.substring(nextHeader, headerEnd));
      }
    } else {
      const closeP = html.indexOf("</p>", nextHeader);
      if (closeP > 0) {
        headerEnd = closeP + 4;
        headerContent = p.stripHtml(html.substring(nextHeader, headerEnd));
      }
    }
    
    if (headerEnd < 0) break;
    
    const isEmpty = headerContent.length < 5;
    const isSummary = p.isCountSummaryHeader(headerContent);
    
    if (!isEmpty && !isSummary) break;
    
    // Find next header after this one
    const afterThis = headerEnd;
    pStrongRegex.lastIndex = afterThis;
    const nPMatch = pStrongRegex.exec(html);
    
    const cands = [
      html.indexOf("<h2", afterThis),
      html.indexOf("<h3", afterThis),
      nPMatch?.index ?? -1,
    ].filter(x => x > 0);
    
    nextHeader = cands.length > 0 ? Math.min(...cands) : -1;
  }
  
  return nextHeader;
}

function extractSection(html, header) {
  const start = header.index + header.match.length;
  let nextHeader = findNextHeader(html, start);
  nextHeader = skipEmptyOrSummaryHeaders(html, nextHeader);
  
  let section = html.substring(start, nextHeader > 0 ? nextHeader : undefined);
  
  // Handle short sections
  if (section.length < 20 && nextHeader > 0) {
    const nextMatch = new RegExp(p.headerTags.h2h3.source, "gi");
    nextMatch.lastIndex = nextHeader;
    const nm = nextMatch.exec(html);
    if (nm && /^Indbrud/i.test(p.stripHtml(nm[1]))) {
      const newStart = nm.index + nm[0].length;
      const newNextH2 = html.indexOf("<h2", newStart);
      const newNextH3 = html.indexOf("<h3", newStart);
      const cands = [newNextH2, newNextH3].filter(x => x > 0);
      const newNext = cands.length > 0 ? Math.min(...cands) : -1;
      section = html.substring(newStart, newNext > 0 ? newNext : undefined);
    }
  }
  
  // Handle content inside header tag
  if (section.length < 50 && header.match.length > 100) {
    const indbrudPos = header.match.search(p.html.indbrudInHeader);
    if (indbrudPos >= 0) {
      section = header.match.substring(indbrudPos);
    }
  }
  
  return section;
}

// --- Entry Extraction ---

function extractFromListItems(section) {
  const entries = [];
  const regex = new RegExp(p.html.listItem.source, "gi");
  let match;
  
  while ((match = regex.exec(section)) !== null) {
    const text = p.stripHtml(match[1]);
    if (text.length > 10) entries.push(text);
  }
  
  return entries;
}

function extractFromParagraphs(section) {
  const entries = [];
  const regex = new RegExp(p.html.paragraph.source, "gi");
  let match;
  
  while ((match = regex.exec(section)) !== null) {
    const content = match[1];
    
    if (p.html.brSplit.test(content)) {
      const lines = content.split(p.html.brSplit).map(s => p.stripHtml(s));
      for (const line of lines) {
        const cleaned = p.cleanEntryLine(line);
        if (p.isEntryLine(cleaned)) entries.push(cleaned);
      }
    } else {
      const text = p.stripHtml(content);
      if (p.isEntryLine(text)) entries.push(text);
    }
  }
  
  return entries;
}

function extractFromBrLines(section) {
  const entries = [];
  const lines = section.split(p.html.brSplit).map(s => p.stripHtml(s));
  
  for (const line of lines) {
    const cleaned = p.cleanEntryLine(line);
    if (p.isEntryLine(cleaned)) entries.push(cleaned);
  }
  
  return entries;
}

function extractFromPlainText(section) {
  const entries = [];
  const plainText = p.stripHtml(section);
  const regex = new RegExp(p.entries.paaExtract.source, "gi");
  let match;
  
  while ((match = regex.exec(plainText)) !== null) {
    entries.push(match[0].trim());
  }
  
  return entries;
}

function extractFromBrLinesRelaxed(section) {
  const entries = [];
  const lines = section.split(p.html.brSplit)
    .map(s => p.stripHtml(s))
    .filter(s => s.length > 10);
  
  for (const line of lines) {
    const cleaned = p.cleanEntryLine(line);
    if (p.isEntryLineRelaxed(cleaned)) entries.push(cleaned);
  }
  
  return entries;
}

function extractEntries(section) {
  // Try extraction methods in order of specificity
  let entries = extractFromListItems(section);
  if (entries.length > 0) return entries;
  
  entries = extractFromParagraphs(section);
  if (entries.length > 0) return entries;
  
  entries = extractFromBrLines(section);
  if (entries.length > 0) return entries;
  
  entries = extractFromPlainText(section);
  if (entries.length > 0) return entries;
  
  entries = extractFromBrLinesRelaxed(section);
  return entries;
}

// --- Main Extraction ---

function extractBreakIns(html) {
  html = p.decode(html);
  
  const header = findIndbrudHeader(html);
  
  if (!header) return { entries: [], status: "no_section" };
  if (header.type === "no_breakins") return { entries: [], status: "no_breakins" };
  
  const section = extractSection(html, header);
  const entries = extractEntries(section);
  
  if (entries.length === 0) {
    const text = p.stripHtml(section).toLowerCase();
    if (p.hasNoBreakInsInText(text)) {
      return { entries: [], status: "no_breakins" };
    }
    return { entries: [], status: "no_entries" };
  }
  
  return { entries, status: "found" };
}

function dateFromUrl(url) {
  const match = url.match(/\/(\d{4})\/(\d{2})\/(\d{2})\/?$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

// --- Main ---

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
  
  const existingResults = await loadJson(paths.indbrudData, []);
  const existingFailures = await loadJson(paths.indbrudFailures, []);
  const skipList = new Set((await loadJson(paths.skipList, [])).filter(u => u && u.length > 0));
  
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
  
  await saveJson(paths.indbrudData, finalResults, { log: false });
  await saveJson(paths.indbrudFailures, finalFailures, { log: false });
  
  console.log(`\n--- Summary ---`);
  console.log(`Found: ${stats.found} | No break-ins: ${stats.no_breakins} | No section: ${stats.no_section} | No entries: ${stats.no_entries}`);
  const totalEntries = finalResults.reduce((sum, r) => sum + r.entries.length, 0);
  console.log(`Total entries: ${totalEntries}`);
  console.log(`\nOutput: ${paths.indbrudData} (${finalResults.length} reports)`);
  console.log(`Failures: ${paths.indbrudFailures} (${finalFailures.length} reports)`);
}

main();