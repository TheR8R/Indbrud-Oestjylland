// Data paths (relative to project root)
export const paths = {
  reportLinks: "./data/report_links.json",
  reportsCache: "./data/reports_cache.json",
  indbudData: "./data/indbrud_data.json",
  indbudFailures: "./data/indbrud_failures.json",
  skipList: "./data/notUsefulReports.json",
  geocodeCache: "./data/geocode_cache.json",
  geocodeFailures: "./data/geocode_failures.json",
  output: "./data/data.json",
  sanitized: "./docs/data_sanitized.json",
};

// External APIs
export const api = {
  politi: "https://politi.dk/api/news/getNewsResults",
  politiBase: "https://politi.dk",
  nominatim: "https://nominatim.openstreetmap.org/search",
};

// Scraping settings
export const scraping = {
  district: "OEstjyllands-Politi",
  itemId: "90DEB0B1-8DF0-4A2D-823B-CFD7A5ADD85F",
  pageSize: 10,
  batchSize: 10,
  startDate: "2018-12-14",
  sleepMs: 500,
};

// Geocoding settings
export const geo = {
  bounds: {
    latMin: 55.8,
    latMax: 56.6,
    lonMin: 9.5,
    lonMax: 11.0,
  },
  rateLimitMs: 1000,
  userAgent: "IndbrudScraper/1.0",
  aarhusSuburbs: [
    "risskov", "åbyhøj", "brabrand", "viby", "højbjerg", "hasle", "tilst",
    "skejby", "lisbjerg", "tranbjerg", "mårslet", "beder", "malling", "egå",
    "lystrup", "hjortshøj", "sabro", "gellerup", "hasselager", "skødstrup"
  ],
};

// Helper to get viewbox string for Nominatim
export function getViewbox() {
  const { lonMin, latMin, lonMax, latMax } = geo.bounds;
  return `${lonMin},${latMin},${lonMax},${latMax}`;
}

// Helper to check if coordinates are within bounds
export function isInBounds(lat, lon) {
  const { latMin, latMax, lonMin, lonMax } = geo.bounds;
  return lat >= latMin && lat <= latMax && lon >= lonMin && lon <= lonMax;
}