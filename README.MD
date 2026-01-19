# Daily Police Report Visualization

Scraper and visualization tool for break-ins (indbrud) reports from Østjyllands Politi's daily reports (døgnrapporter).

## Overview

This project scrapes daily police reports, extracts break-in information, geocodes the addresses, and displays them on an interactive map.

## Dependencies & Services

- **[Bun](https://bun.sh/)** — JavaScript runtime
- **[OpenStreetMap Nominatim](https://nominatim.openstreetmap.org/)** — Geocoding API
- **[Leaflet.js](https://leafletjs.com/)** — Interactive map library
- **[Leaflet.markercluster](https://github.com/Leaflet/Leaflet.markercluster)** — Marker clustering plugin
- **[node-html-parser](https://www.npmjs.com/package/node-html-parser)** — HTML parsing

## Project Structure

```
├── src/
│   ├── run.js            # Pipeline runner
│   ├── getReports.js     # Fetches report links from the Politi API
│   ├── cacheReports.js   # Downloads and caches report HTML
│   ├── Scraper.js        # Extracts break-in data from cached reports
│   ├── geocoder.js       # Geocodes addresses using Nominatim
│   ├── sanitize.js       # Cleans and formats data for frontend
│   └── util/
|       ├── config.js     # Centralized configuration (paths, API URLs, settings)
│       ├── saveFile.js   # Shared JSON file utilities
│       └── patterns.js   # Regex patterns for HTML parsing
├── data/
│   ├── report_links.json     # Stored report links
│   ├── reports_cache.json    # Cached report HTML content
│   ├── indbrud_data.json     # Extracted break-in entries
│   ├── indbrud_failures.json # Reports that failed to parse
│   ├── notUsefulReports.json # URLs to skip during processing
│   ├── data.json             # Geocoded data (full)
│   ├── geocode_cache.json    # Cached geocoding results
│   └── geocode_failures.json # Failed geocoding attempts
└── docs/
    ├── index.html            # Frontend HTML
    ├── style.css             # Frontend styles
    ├── app.js                # Frontend map logic
    └── data_sanitized.json   # Cleaned data for frontend
```

## Quick Start

All commands should be run from the **project root**.

```bash
# Install dependencies
bun install

# Daily update (fetch recent, cache, scrape, geocode, sanitize)
bun src/run.js --recent

# Full rebuild (fetch all historical, process everything)
bun src/run.js --all

# Preview what will run
bun src/run.js --dry
```

## Pipeline

The pipeline runner (`src/run.js`) executes all steps in sequence:

| Step | Script | Description |
|------|--------|-------------|
| 1 | `getReports.js` | Fetch report URLs from the Politi API |
| 2 | `cacheReports.js` | Download and cache report HTML pages |
| 3 | `Scraper.js` | Parse break-in entries from cached HTML |
| 4 | `geocoder.js` | Convert addresses to coordinates via Nominatim |
| 5 | `sanitize.js` | Clean and format data for frontend |

### Pipeline Options

| Option | Description |
|--------|-------------|
| `--recent` | Process only new data (default) |
| `--all` | Full rebuild from scratch |
| `--skip=N` | Skip first N steps |
| `--only=N` | Run only step N (1-indexed) |
| `--dry` | Preview steps without running |
| `--help` | Show help |

In `--recent` mode, the pipeline exits early if no new reports are found.

## Data Flow

```
Politi API → getReports.js → report_links.json
                                    ↓
           cacheReports.js → reports_cache.json
                                    ↓
              Scraper.js → indbrud_data.json
                                    ↓
             geocoder.js → data.json
                                    ↓
             sanitize.js → docs/data_sanitized.json → Frontend
```

## Individual Scripts

### Fetch Report Links

```bash
bun src/getReports.js --recent              # Fetch new reports only
bun src/getReports.js --all                 # Fetch all historical reports
bun src/getReports.js --from 2020-01-01 --to 2020-06-01
```

### Cache Report HTML

```bash
bun src/cacheReports.js                     # Cache all uncached reports
bun src/cacheReports.js --recent            # Cache only new reports
```

### Extract Break-in Data

```bash
bun src/Scraper.js                          # Process all reports
bun src/Scraper.js --recent                 # Process only new reports
bun src/Scraper.js --retry                  # Retry failed reports
bun src/Scraper.js --limit 100              # Process max 100 reports
bun src/Scraper.js --debug                  # Show debug info for failures
```

### Geocode Addresses

```bash
bun src/geocoder.js                         # Geocode all entries
bun src/geocoder.js --recent                # Geocode only new entries
bun src/geocoder.js --retry                 # Retry failed geocodes
bun src/geocoder.js --limit 10              # Geocode max 10 entries
```

### Sanitize Output

```bash
bun src/sanitize.js                         # Sanitize all data
bun src/sanitize.js --recent                # Sanitize only new dates
```

## Frontend

The frontend is an interactive map visualization located in the `docs/` folder.

### Features

- Interactive map centered on Aarhus/Østjylland
- Marker clustering for performance with thousands of points
- Dual-range slider for filtering by date range
- Popup details showing address, city, date, and time
- Real-time count of visible markers

### Running Locally

```bash
# Using Bun
cd docs && bunx serve .

# Then open http://localhost:8000
```

## Output Format

The frontend consumes `docs/data_sanitized.json`:

```json
{
  "2026-01-09": {
    "Østjyllands Politi": {
      "Skødstrup": [
        {
          "address": "Hjelmagerparken",
          "time": "torsdag d. 8/1 mellem kl. 04.55 og kl. 05.05",
          "lat": 56.2787882,
          "lon": 10.3205657,
          "source_url": "https://politi.dk/..."
        }
      ]
    }
  }
}
```

## Configuration

All paths and settings are centralized in `src/config.js`:

- **paths** — File locations for all JSON data
- **api** — External API URLs (Politi, Nominatim)
- **scraping** — Batch sizes, rate limits, district settings
- **geo** — Geographic bounds, suburb lists, geocoding settings

## Notes

- Only scrapes Østjyllands Politi (other districts don't have standardized "Indbrud" sections)
- Geocoding uses OpenStreetMap Nominatim with 1 second rate limiting
- All results are cached to avoid duplicate API calls and downloads
- The scraper includes a 500ms delay between requests to be respectful to the server
- Reports that fall outside Østjylland's geographic bounds are logged as failures