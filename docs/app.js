// Initialize map centered on Aarhus
const map = L.map('map').setView([56.15, 10.2], 10);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

// Marker cluster group
const markers = L.markerClusterGroup();
map.addLayer(markers);

// Data storage
let allEntries = [];
let allDates = [];
let currentStartDate = null;
let currentEndDate = null;

// DOM elements
const startDateEl = document.getElementById('startDate');
const endDateEl = document.getElementById('endDate');
const startLabel = document.getElementById('startLabel');
const endLabel = document.getElementById('endLabel');
const countEl = document.getElementById('count');
const totalEl = document.getElementById('total');
const loadingEl = document.getElementById('loading');
const presetBtns = document.querySelectorAll('.preset-btn');
const timelinePanel = document.getElementById('timelinePanel');
const timelineHeader = document.querySelector('.timeline-header');
const infoPanel = document.getElementById('infoPanel');
const infoHeader = document.querySelector('.info-header');

// Toggle panel collapse
function toggleTimeline() {
  timelinePanel.classList.toggle('collapsed');
}

function toggleInfo() {
  infoPanel.classList.toggle('collapsed');
}

timelineHeader.addEventListener('click', toggleTimeline);
infoHeader.addEventListener('click', toggleInfo);

// Format date as DD/MM/YY
function formatDateLong(dateStr) {
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year.slice(2)}`;
}

// Clear preset button selection
function clearPresetSelection() {
  presetBtns.forEach(btn => btn.classList.remove('active'));
}

// Set preset time range
function setPreset(days) {
  if (days === 0) {
    // Show all data
    currentStartDate = allDates[0];
    currentEndDate = allDates[allDates.length - 1];
  } else {
    // Calculate date X days ago
    const end = new Date(allDates[allDates.length - 1]);
    const start = new Date(end);
    start.setDate(start.getDate() - days);
    
    currentStartDate = start.toISOString().split('T')[0];
    currentEndDate = allDates[allDates.length - 1];
    
    // Clamp to available data
    if (currentStartDate < allDates[0]) {
      currentStartDate = allDates[0];
    }
  }
  
  updateDatePickers();
  filterAndDisplayMarkers();
}

// Update date picker values
function updateDatePickers() {
  if (currentStartDate) startDateEl.value = currentStartDate;
  if (currentEndDate) endDateEl.value = currentEndDate;
}

// Filter markers based on current date range
function filterAndDisplayMarkers() {
  if (allDates.length === 0 || !currentStartDate || !currentEndDate) return;
  
  // Update labels
  startLabel.textContent = formatDateLong(currentStartDate);
  endLabel.textContent = formatDateLong(currentEndDate);
  
  // Clear and re-add markers
  markers.clearLayers();
  
  let count = 0;
  for (const entry of allEntries) {
    if (entry.date >= currentStartDate && entry.date <= currentEndDate && entry.lat && entry.lon) {
      const marker = L.marker([entry.lat, entry.lon]);
      marker.bindPopup(`
        <div class="popup-title">${entry.address}</div>
        <div class="popup-city">${entry.city}</div>
        <div class="popup-date">${entry.date}</div>
        <div class="popup-time">Tidspunkt: ${entry.time}</div>
      `);
      markers.addLayer(marker);
      count++;
    }
  }
  
  countEl.textContent = count.toLocaleString('da-DK');
}

// Event listeners for presets
presetBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    presetBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const days = parseInt(btn.dataset.days);
    setPreset(days);
  });
});

// Event listeners for date pickers
startDateEl.addEventListener('change', () => {
  currentStartDate = startDateEl.value;
  clearPresetSelection();
  filterAndDisplayMarkers();
});

endDateEl.addEventListener('change', () => {
  currentEndDate = endDateEl.value;
  clearPresetSelection();
  filterAndDisplayMarkers();
});

// Load and process data
async function loadData() {
  try {
    const res = await fetch('./data_sanitized.json');
    const data = await res.json();
    
    // Get sorted dates
    allDates = Object.keys(data).sort();
    
    // Flatten the nested structure
    for (const [date, regions] of Object.entries(data)) {
      for (const [region, cities] of Object.entries(regions)) {
        for (const [city, addresses] of Object.entries(cities)) {
          for (const entry of addresses) {
            allEntries.push({ ...entry, city, date, region });
          }
        }
      }
    }

    // Update total count
    totalEl.textContent = allEntries.length.toLocaleString('da-DK');
    
    // Set initial date range (all data)
    if (allDates.length > 0) {
      currentStartDate = allDates[0];
      currentEndDate = allDates[allDates.length - 1];
      
      // Set date picker min/max
      startDateEl.min = allDates[0];
      startDateEl.max = allDates[allDates.length - 1];
      endDateEl.min = allDates[0];
      endDateEl.max = allDates[allDates.length - 1];
      
      updateDatePickers();
    }

    // Initial display with all data
    filterAndDisplayMarkers();
    
    // Hide loading
    loadingEl.style.display = 'none';

    console.log(`Loaded ${allEntries.length} entries across ${allDates.length} dates`);

  } catch (e) {
    console.error('Failed to load data:', e);
    loadingEl.textContent = 'Fejl ved indlæsning af data';
  }
}

// Start loading data
loadData();