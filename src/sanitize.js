// Broad pattern that captures time info starting from common Danish time indicators
// Matches: sket, mellem, weekday + d./den, or date patterns following location
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
  // Remove "Sket" prefix from addresses
  return address.replace(/^sket\s+/i, "").trim();
}

function sanitizeData(data) {
  const sanitized = {};

  for (const [date, policeDistricts] of Object.entries(data)) {
    sanitized[date] = {};

    for (const [district, locations] of Object.entries(policeDistricts)) {
      sanitized[date][district] = {};

      for (const [location, incidents] of Object.entries(locations)) {
        const { cleanLocation, extractedTime } = extractTimeFromLocation(location);

        sanitized[date][district][cleanLocation] = incidents.map((incident) => ({
          ...incident,
          address: cleanAddress(incident.address),
          time: incident.time || extractedTime,
        }));
      }
    }
  }

  return sanitized;
}

async function main() {
const inputPath = process.argv[2] || "../data/data.json"; 
const outputPath = process.argv[3] || "../docs/data_sanitized.json";

  try {
    const rawData = await Bun.file(inputPath).json();
    const sanitized = sanitizeData(rawData);

    await Bun.write(outputPath, JSON.stringify(sanitized, null, 2));
    console.log(`✓ Sanitized data written to ${outputPath}`);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}

main();