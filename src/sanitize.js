import { loadJson, saveJson } from "./util/saveFile.js";
import { paths } from "./util/config.js";

const timePattern = /,?\s*((?:sket|mellem|blev der[^,]*mellem|i tidsrummet|forsøgt indbrud|anmeldt)\s.+|(?:mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag)\s+d\.?\s*\d.+|\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4}.*)$/i;

function extractTimeFromLocation(location) {
  const match = location.match(timePattern);
  if (match) {
    const extractedTime = match[1].trim();
    const cleanLocation = location.replace(timePattern, "").trim();
    return { cleanLocation, extractedTime };
  }
  return { cleanLocation: location, extractedTime: "" };
}

function cleanAddress(address) {
  return address.replace(/^sket\s+/i, "").trim();
}

function sanitizeEntry(incident, extractedTime) {
  return {
    ...incident,
    address: cleanAddress(incident.address),
    time: incident.time || extractedTime,
  };
}

function sanitizeData(data, existingSanitized = null, recentMode = false) {
  const sanitized = recentMode && existingSanitized ? { ...existingSanitized } : {};

  for (const [date, policeDistricts] of Object.entries(data)) {
    // Skip dates already processed in recent mode
    if (recentMode && sanitized[date]) continue;
    
    sanitized[date] = {};

    for (const [district, locations] of Object.entries(policeDistricts)) {
      sanitized[date][district] = {};

      for (const [location, incidents] of Object.entries(locations)) {
        const { cleanLocation, extractedTime } = extractTimeFromLocation(location);
        sanitized[date][district][cleanLocation] = incidents.map(
          incident => sanitizeEntry(incident, extractedTime)
        );
      }
    }
  }

  return sanitized;
}

async function main() {
  const args = process.argv.slice(2);
  const recentMode = args.includes("--recent");
  const inputPath = args.find(a => !a.startsWith("--")) || paths.output;
  const outputPath = args.find((a, i) => i > 0 && !a.startsWith("--")) || paths.sanitized;

  const rawData = await loadJson(inputPath);
  if (!rawData) {
    console.error(`Error: Could not read ${inputPath}`);
    process.exit(1);
  }

  let existingSanitized = null;
  if (recentMode) {
    existingSanitized = await loadJson(outputPath, {});
    const existingDates = Object.keys(existingSanitized).length;
    const newDates = Object.keys(rawData).filter(d => !existingSanitized[d]).length;
    console.log(`Processing ${newDates} new dates (${existingDates} already sanitized)...`);
    
    if (newDates === 0) {
      console.log("✓ No new data to sanitize");
      return;
    }
  }

  const sanitized = sanitizeData(rawData, existingSanitized, recentMode);
  await saveJson(outputPath, sanitized, { log: false });
  console.log(`✓ Sanitized data written to ${outputPath}`);
}

main();