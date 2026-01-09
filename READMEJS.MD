# Østjyllands Politi Indbrud Scraper

Scraper for extracting break-in (indbrud) reports from Østjyllands Politi's daily reports (døgnrapporter).

## Requirements

- [Bun](https://bun.sh/) runtime

## Project Structure

```
├── src/
│   ├── getReports.js    # Fetches report links from the Politi API
│   ├── scraper.js       # Scrapes break-in data from each report
│   ├── geocoder.js      # Geocodes addresses using Nominatim
│   └── orchestrator.js  # Runs the full pipeline
├── data/
│   ├── report_links.json         # Stored report links
│   ├── indbrud_data.json         # Extracted break-in entries
│   ├── indbrud_data_failures.json # Reports that failed to parse
│   ├── data.json                 # Geocoded data (full)
│   ├── geocode_cache.json        # Cached geocoding results
│   └── geocode_failures.json     # Failed geocoding attempts
└── docs/
    ├── data.json        # Cleaned data for frontend
    └── (frontend files)
```

## Quick Start

```bash
cd src

# Daily update (fetch recent, scrape, geocode, clean)
bun run orchestrator.js daily

# Full rebuild (fetch all, scrape all, geocode all, clean)
bun run orchestrator.js full

# Retry all failures
bun run orchestrator.js retry
```

## Orchestrator Modes

| Mode | Description |
|------|-------------|
| `daily` | Fetch recent reports, scrape, geocode, clean (default) |
| `full` | Full rebuild: fetch all, scrape all, geocode all, clean |
| `scrape` | Scrape and geocode only (skip fetching) |
| `geocode` | Geocode only (skip fetching and scraping) |
| `retry` | Retry all failures (scraping and geocoding) |
| `clean` | Just clean/format data for frontend |

## Individual Scripts

### 1. Fetch Report Links

```bash
bun run getReports.js --recent    # Fetch new reports only
bun run getReports.js --all       # Fetch all historical reports
bun run getReports.js --from 2020-01-01 --to 2020-06-01
```

### 2. Scrape Break-in Data

```bash
bun run scraper.js                # Scrape first 5 reports
bun run scraper.js --limit 100    # Scrape 100 reports
bun run scraper.js --all          # Scrape all reports
bun run scraper.js --retry        # Retry failed reports
```

### 3. Geocode Addresses

```bash
bun run geocoder.js               # Geocode all addresses
bun run geocoder.js --limit 10    # Geocode 10 addresses
bun run geocoder.js --retry       # Retry failed geocodes
```

## Output Format

The frontend consumes `docs/data.json`:

```json
{
  "2026-01-09": {
    "Østjyllands Politi": {
      "Skødstrup": [
        {
          "address": "Hjelmagerparken",
          "time": "torsdag d. 8/1 mellem kl. 04.55 og kl. 05.05",
          "lat": 56.2787882,
          "lon": 10.3205657
        }
      ]
    }
  }
}
```

## Notes

- Only scrapes Østjyllands Politi (other districts don't have standardized "Indbrud" sections)
- Geocoding uses OpenStreetMap Nominatim with 1 second rate limiting
- Results are cached to avoid duplicate API calls
- Frontend only receives entries with valid coordinates

## Output Format

### report_links.json
```json
{
  "district": "OEstjyllands-Politi",
  "links": [
    "https://politi.dk/oestjyllands-politi/doegnrapporter/..."
  ],
  "lastUpdated": "2026-01-09T12:00:00.000Z"
}
```

### indbrud_data.json
```json
[
  {
    "url": "https://politi.dk/...",
    "date": "2026-01-09",
    "entries": [
      "På Examplevej i Aarhus begået mellem den 8/1 kl. 08.00 og den 9/1 kl. 12.00"
    ]
  }
]
```

### indbrud_data_failures.json
```json
{
  "failures": [
    {
      "url": "https://politi.dk/...",
      "reason": "No Indbrud section found",
      "date": "2026-01-04",
      "checkedAt": "2026-01-09T12:00:00.000Z"
    }
  ],
  "lastUpdated": "2026-01-09T12:00:00.000Z"
}
```

## Notes

- Only scrapes Østjyllands Politi as other districts don't have a standardized "Indbrud" section
- Reports with parsing issues are logged to `indbrud_data_failures.json` for manual review
- The scraper includes a 500ms delay between requests to be respectful to the server