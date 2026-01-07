# Indbrudskort Østjylland

An interactive map showing break-ins in Østjylland, Denmark, scraped from Østjyllands Politi's daily reports.

## How It Works

### 1. Scraping (`scraper.py`)

The scraper fetches break-in data from Østjyllands Politi's daily reports (døgnrapporter).

**Technology:** Python + Playwright (headless Chromium)

**Flow:**
1. **Fetch listing page** - Navigates to `politi.dk/doegnrapporter` using Playwright (needed because the site uses Angular/JavaScript)
2. **Extract report links** - Finds Østjylland report links matching the date pattern `/YYYY/MM/DD`
3. **Scrape each report** - For each report page:
   - Extracts the "Indbrud" (break-in) section
   - Parses individual entries starting with "På" (address)
   - Handles many inconsistent date/time formats from the police reports
   - Correctly handles year boundaries (December incidents in January reports)
4. **Geocode addresses** - Converts addresses to lat/lon coordinates using Nominatim (OpenStreetMap)
   - Uses bounding box to prefer results within Østjylland region
   - Handles Aarhus suburb variations (Risskov, Åbyhøj, etc.)
   - Sanitizes malformed addresses
   - Caches successful results in `geocode_cache.json`
   - Logs failures to `geocode_failures.json` for manual review
5. **Merge & save** - Merges new data with existing `docs/data.json`, avoiding duplicates

**Output structure:**
```json
{
  "2025-12-27": {
    "Østjyllands Politi": {
      "Aarhus N": [
        {
          "address": "Katrinebjergvej",
          "time": "23/12 12.00 - 26/12 08.00",
          "lat": 56.1234,
          "lon": 10.5678,
          "source_url": "https://politi.dk/..."
        }
      ]
    }
  }
}
```

### 2. Frontend (`docs/index.html`)

A static page that displays break-ins on an interactive map.

**Technology:** Vanilla JS + Leaflet + OpenStreetMap

**Features:**
- Marker clustering for overlapping pins
- Popups with address, city, date, and time
- Stats panel showing total count and date range
- Instant loading (coordinates pre-geocoded by scraper)

### 3. Automation (GitHub Actions)

*Coming soon* - Daily scheduled scraping via GitHub Actions.

## Usage

### Prerequisites

```bash
pip install playwright requests
playwright install chromium --with-deps
```

### Run the scraper

```bash
# Default: 30 reports, 3 pages
python scraper.py

# Quick daily update
python scraper.py -l 5 -p 1

# Backfill more history
python scraper.py -l 100 -p 11

# Custom output file
python scraper.py -o backfill.json

# Debug mode (visible browser)
python scraper.py --no-headless

# Show all options
python scraper.py --help
```

### Local development

```bash
cd docs
python -m http.server 8000
# Open http://localhost:8000
```

## Project Structure

```
indbrud/
├── scraper.py              # Main scraper script
├── geocode_cache.json      # Cached geocoding results (gitignored)
├── geocode_failures.json   # Failed geocodes for review (gitignored)
├── README.md
└── docs/                   # GitHub Pages root
    ├── index.html          # Map frontend
    └── data.json           # Break-in data with coordinates
```

## Limitations

- **Østjylland only** - Other police regions don't include break-in details in their reports
- **Geocoding failures** - Some addresses can't be geocoded due to typos in police reports or missing OpenStreetMap data
- **Rate limited** - Nominatim allows 1 request/second, so initial geocoding is slow (cached afterward)
- **Date range** - The police website only shows ~1 month of reports by default

## Data Sources

- **Police reports:** [politi.dk/doegnrapporter](https://politi.dk/doegnrapporter)
- **Geocoding:** [Nominatim / OpenStreetMap](https://nominatim.openstreetmap.org/)
- **Map tiles:** OpenStreetMap