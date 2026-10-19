/**
 * RefillIQ — Core Application Logic
 * Automated LPG demand prediction, spatial clustering, and delivery route optimization.
 */

// ==========================================
// 1. CONSTANTS & SYSTEM CONFIGURATION
// ==========================================

// Reference date: Current local time (October 2026)
const CURRENT_DATE = new Date(2026, 9, 19); // 19 Oct 2026

// Standard Default Localities (Fixed coordinates in km relative to distributor region)
const DEFAULT_AREAS = {
  "Central Market": { x: 0.0, y: 0.5 },
  "Downtown":       { x: -0.2, y: -0.2 },
  "North Heights":  { x: 0.8, y: 4.8 },
  "Greenwood Park": { x: -3.5, y: 2.4 },
  "Lakeside":       { x: -4.2, y: -3.2 },
  "East Industrial":{ x: 4.6, y: 1.2 },
  "South Suburbs":  { x: 1.6, y: -4.5 },
  "West End":       { x: -4.8, y: 0.2 },
  "Old Town":       { x: 2.2, y: 3.1 }
};

// Month name lookup table
const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", 
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

const MONTH_MAP = {
  "jan": 0, "january": 0,
  "feb": 1, "february": 1,
  "mar": 2, "march": 2,
  "apr": 3, "april": 3,
  "may": 4,
  "jun": 5, "june": 5,
  "jul": 6, "july": 6,
  "aug": 7, "august": 7,
  "sep": 8, "september": 8, "sept": 8,
  "oct": 9, "october": 9,
  "nov": 10, "november": 10,
  "dec": 11, "december": 11
};

// Storage Keys
const STORAGE_KEY_HOUSEHOLDS = "refilliq_households_v2";
const STORAGE_KEY_DEPOT = "refilliq_depot_v2";
const STORAGE_KEY_CUSTOM_AREAS = "refilliq_custom_areas_v2";

// ==========================================
// 2. STATE MANAGEMENT
// ==========================================

const state = {
  households: [],
  customAreas: {},
  depot: { x: 0.0, y: -0.5, name: "Distributor Depot Hub" },
  activeFilter: "all",
  activeTab: "householdsTab",
  isSettingDepot: false,
  showOptimizedRoute: true,
  showBeforeRoute: false,
  mapTransform: {
    offsetX: 0,
    offsetY: 0,
    scale: 34 // pixels per km
  },
  pendingImportRows: []
};

// ==========================================
// 3. DATE ENGINE & CONSUMPTION PREDICTION
// ==========================================

/**
 * Parses user input date strings supporting multiple formats:
 * - "dd/mm/yyyy" or "dd-mm-yyyy"
 * - "yyyy-mm-dd"
 * - "12 Aug" (infers appropriate year based on CURRENT_DATE)
 * - "12 Aug 2026" or "12 August 2026"
 * - Excel serial date numbers (e.g. 46247)
 */
function parseRefillDate(str) {
  if (!str) return null;
  const raw = String(str).trim();
  if (!raw) return null;

  // 1. Check if numeric Excel serial date (e.g. 45000)
  if (/^\d{5}$/.test(raw)) {
    const serial = parseInt(raw, 10);
    // Excel base date is Dec 30 1899
    const utcDays = serial - 25569;
    const utcVal = utcDays * 86400;
    const d = new Date(utcVal * 1000);
    return isNaN(d.getTime()) ? null : d;
  }

  // 2. Check ISO format: yyyy-mm-dd or yyyy/mm/dd
  const isoMatch = raw.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10) - 1;
    const d = parseInt(isoMatch[3], 10);
    const date = new Date(y, m, d);
    return isNaN(date.getTime()) ? null : date;
  }

  // 3. Check dd/mm/yyyy or dd-mm-yyyy
  const dmyMatch = raw.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (dmyMatch) {
    const d = parseInt(dmyMatch[1], 10);
    const m = parseInt(dmyMatch[2], 10) - 1;
    const y = parseInt(dmyMatch[3], 10);
    const date = new Date(y, m, d);
    return isNaN(date.getTime()) ? null : date;
  }

  // 4. Check "12 Aug" or "12 Aug 2026" or "12 August 2026"
  const textMatch = raw.match(/^(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?$/);
  if (textMatch) {
    const d = parseInt(textMatch[1], 10);
    const monthStr = textMatch[2].toLowerCase();
    const m = MONTH_MAP[monthStr];
    if (m === undefined) return null;

    let y = textMatch[3] ? parseInt(textMatch[3], 10) : CURRENT_DATE.getFullYear();

    // If no year specified and month is ahead of current month, it likely belongs to previous year
    if (!textMatch[3]) {
      const tentative = new Date(y, m, d);
      if (tentative > CURRENT_DATE) {
        y = y - 1;
      }
    }

    const date = new Date(y, m, d);
    return isNaN(date.getTime()) ? null : date;
  }

  // 5. Check "Aug 12" or "Aug 12, 2026"
  const revTextMatch = raw.match(/^([A-Za-z]+)\s+(\d{1,2})(?:[,\s]+(\d{4}))?$/);
  if (revTextMatch) {
    const monthStr = revTextMatch[1].toLowerCase();
    const m = MONTH_MAP[monthStr];
    if (m === undefined) return null;
    const d = parseInt(revTextMatch[2], 10);

    let y = revTextMatch[3] ? parseInt(revTextMatch[3], 10) : CURRENT_DATE.getFullYear();
    if (!revTextMatch[3]) {
      const tentative = new Date(y, m, d);
      if (tentative > CURRENT_DATE) {
        y = y - 1;
      }
    }

    const date = new Date(y, m, d);
    return isNaN(date.getTime()) ? null : date;
  }

  // 6. Native Date parse fallback
  const fallback = new Date(raw);
  return isNaN(fallback.getTime()) ? null : fallback;
}

/**
 * Format a Date object nicely, e.g. "12 Aug 2026"
 */
function formatDate(d) {
  if (!d || isNaN(d.getTime())) return "N/A";
  const day = d.getDate();
  const mon = MONTH_NAMES[d.getMonth()];
  const yr = d.getFullYear();
  return `${day < 10 ? '0' + day : day} ${mon} ${yr}`;
}

/**
 * Splits string with multiple dates separated by comma or semicolon
 */
function parseDateList(inputStr) {
  if (!inputStr) return [];
  const parts = inputStr.split(/[;,]/).map(s => s.trim()).filter(Boolean);
  const parsedDates = [];

  for (const part of parts) {
    const dt = parseRefillDate(part);
    if (dt) parsedDates.push(dt);
  }

  // Sort ascending chronologically
  parsedDates.sort((a, b) => a.getTime() - b.getTime());

  // Deduplicate dates on same calendar day
  const uniqueDates = [];
  for (const dt of parsedDates) {
    const prev = uniqueDates[uniqueDates.length - 1];
    if (!prev || Math.abs(dt.getTime() - prev.getTime()) > 12 * 3600 * 1000) {
      uniqueDates.push(dt);
    }
  }

  return uniqueDates;
}

/**
 * Estimate consumption gap in days based on family size (standard 14.2kg LPG cylinder).
 * A family of 4 typically consumes a cylinder in ~45-50 days.
 */
function estimateGapFromPeople(peopleCount) {
  const p = Math.max(1, parseInt(peopleCount, 10) || 4);
  switch (p) {
    case 1: return 150;
    case 2: return 90;
    case 3: return 65;
    case 4: return 48;
    case 5: return 40;
    case 6: return 34;
    default: return Math.max(20, Math.round(180 / p));
  }
}

/**
 * Computes all derived metrics for a household from its date history:
 * - gaps array
 * - days since last refill
 * - average gap
 * - days remaining
 * - predicted runout date
 * - urgency status
 */
function calculateHouseholdMetrics(dates, peopleCount = 4) {
  if (!dates || dates.length === 0) {
    return {
      gaps: [],
      isEstimated: false,
      avgGap: 45,
      daysSinceRefill: 0,
      daysRemaining: 45,
      predictedRunout: CURRENT_DATE,
      status: "safe",
      lastDate: CURRENT_DATE
    };
  }

  // Ensure dates are chronologically sorted Date objects
  const sorted = [...dates].map(d => (d instanceof Date ? d : new Date(d))).sort((a, b) => a.getTime() - b.getTime());
  const lastDate = sorted[sorted.length - 1];

  let gaps = [];
  let isEstimated = false;

  if (sorted.length >= 2) {
    for (let i = 1; i < sorted.length; i++) {
      const diffMs = sorted[i].getTime() - sorted[i - 1].getTime();
      const diffDays = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)));
      gaps.push(diffDays);
    }
  } else {
    // Only 1 date available: estimate gap from household size
    isEstimated = true;
    gaps.push(estimateGapFromPeople(peopleCount));
  }

  // Calculate average gap
  const avgGap = Math.round(gaps.reduce((sum, g) => sum + g, 0) / gaps.length);

  // Days elapsed since last refill
  const elapsedMs = CURRENT_DATE.getTime() - lastDate.getTime();
  const daysSinceRefill = Math.max(0, Math.floor(elapsedMs / (1000 * 60 * 60 * 24)));

  // Days remaining before empty
  const daysRemaining = avgGap - daysSinceRefill;

  // Predicted runout date = lastDate + avgGap days
  const predictedRunout = new Date(lastDate.getTime() + avgGap * 24 * 60 * 60 * 1000);

  // Status classification
  let status = "safe";
  if (daysRemaining < 0) {
    status = "overdue";
  } else if (daysRemaining <= 3) {
    status = "urgent";
  } else if (daysRemaining <= 7) {
    status = "due-soon";
  } else {
    status = "safe";
  }

  return {
    sortedDates: sorted,
    lastDate,
    gaps,
    isEstimated,
    avgGap,
    daysSinceRefill,
    daysRemaining,
    predictedRunout,
    status
  };
}

// ==========================================
// 4. SPATIAL & LOCALITY MANAGEMENT
// ==========================================

/**
 * Returns anchor coordinate for an area. If the area is new,
 * automatically registers a deterministic anchor location around the city grid.
 */
function getAreaCoordinates(areaName) {
  const trimmed = (areaName || "Central Market").trim();
  
  if (DEFAULT_AREAS[trimmed]) {
    return DEFAULT_AREAS[trimmed];
  }
  if (state.customAreas[trimmed]) {
    return state.customAreas[trimmed];
  }

  // Deterministically generate a location for new custom area
  let hash = 0;
  for (let i = 0; i < trimmed.length; i++) {
    hash = (hash * 31 + trimmed.charCodeAt(i)) & 0xffffffff;
  }
  const angle = Math.abs(hash % 360) * (Math.PI / 180);
  const distance = 3.0 + (Math.abs(hash) % 30) / 10; // 3.0 to 6.0 km radius
  const newCoord = {
    x: Math.round(Math.cos(angle) * distance * 10) / 10,
    y: Math.round(Math.sin(angle) * distance * 10) / 10
  };

  state.customAreas[trimmed] = newCoord;
  saveCustomAreas();
  populateAreaDatalist();
  return newCoord;
}

/**
 * Scatters a household randomly/pseudorandomly around its area's fixed center
 * within a realistic neighbourhood radius (0.15 km to 0.55 km).
 */
function getHouseholdCoordinates(household) {
  if (household.x !== undefined && household.y !== undefined) {
    return { x: household.x, y: household.y };
  }

  const areaCenter = getAreaCoordinates(household.area);
  
  // Seeded deterministic offset based on household id or name
  let seed = 0;
  const str = household.id || household.name || "hh";
  for (let i = 0; i < str.length; i++) {
    seed = (seed * 37 + str.charCodeAt(i)) & 0xffff;
  }

  const angle = ((seed * 137) % 360) * (Math.PI / 180);
  const radius = 0.15 + ((seed % 40) / 100); // 0.15km to 0.55km scatter

  return {
    x: Math.round((areaCenter.x + radius * Math.cos(angle)) * 100) / 100,
    y: Math.round((areaCenter.y + radius * Math.sin(angle)) * 100) / 100
  };
}

// ==========================================
// 5. ROUTE OPTIMIZATION ENGINE (TSP 2-OPT)
// ==========================================

function calculateDistance(p1, p2) {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function calculateTourDistance(stops, depot) {
  if (!stops || stops.length === 0) return 0;
  let total = 0;
  let current = depot;
  for (const stop of stops) {
    total += calculateDistance(current, stop);
    current = stop;
  }
  total += calculateDistance(current, depot); // Return to depot
  return total;
}

/**
 * 2-Opt TSP solver: Nearest neighbor seed + iterative 2-opt improvements
 */
function optimizeRouteTSP(stops, depot) {
  if (!stops || stops.length <= 1) {
    return {
      optimizedStops: stops ? [...stops] : [],
      distance: calculateTourDistance(stops, depot)
    };
  }

  // 1. Nearest Neighbor heuristic starting at Depot
  const unvisited = [...stops];
  const tour = [];
  let currentPos = depot;

  while (unvisited.length > 0) {
    let nearestIdx = 0;
    let minDist = Infinity;
    for (let i = 0; i < unvisited.length; i++) {
      const d = calculateDistance(currentPos, unvisited[i]);
      if (d < minDist) {
        minDist = d;
        nearestIdx = i;
      }
    }
    const nextStop = unvisited.splice(nearestIdx, 1)[0];
    tour.push(nextStop);
    currentPos = nextStop;
  }

  // 2. 2-Opt local search refinement
  let improved = true;
  let iterations = 0;
  const maxIterations = 50;

  while (improved && iterations < maxIterations) {
    improved = false;
    iterations++;

    for (let i = 0; i < tour.length - 1; i++) {
      for (let k = i + 1; k < tour.length; k++) {
        const prevNode = i === 0 ? depot : tour[i - 1];
        const nextNode = k === tour.length - 1 ? depot : tour[k + 1];

        const oldDist = calculateDistance(prevNode, tour[i]) + calculateDistance(tour[k], nextNode);
        const newDist = calculateDistance(prevNode, tour[k]) + calculateDistance(tour[i], nextNode);

        if (newDist < oldDist - 0.001) {
          // Reverse slice between i and k
          const reversedSlice = tour.slice(i, k + 1).reverse();
          tour.splice(i, reversedSlice.length, ...reversedSlice);
          improved = true;
        }
      }
    }
  }

  return {
    optimizedStops: tour,
    distance: calculateTourDistance(tour, depot)
  };
}

// ==========================================
// 6. CSV & EXCEL IMPORT ENGINE
// ==========================================

/**
 * Parses raw CSV text handling commas, quotes, semicolons, and newlines.
 */
function parseCSVText(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  // Determine delimiter: comma or tab
  const firstLine = lines[0];
  const delimiter = firstLine.includes('\t') ? '\t' : ',';

  function splitLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === delimiter && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  }

  const rawHeaders = splitLine(lines[0]).map(h => h.toLowerCase().replace(/[\s_]+/g, ''));
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = splitLine(lines[i]);
    const rowObj = {};
    for (let j = 0; j < rawHeaders.length; j++) {
      rowObj[rawHeaders[j]] = values[j] !== undefined ? values[j] : '';
    }
    rows.push(rowObj);
  }

  return rows;
}

/**
 * Validates imported rows against required columns:
 * name, area, refill_dates (semicolon separated), people (optional default 4)
 * Returns object with isValid, errorDescription, and parsed values.
 */
function validateImportRow(row, rowIndex) {
  // Normalize keys
  const name = (row.name || row.customer || row.household || '').trim();
  const area = (row.area || row.locality || row.location || '').trim();
  const datesRaw = (row.refilldates || row.refilldate || row.dates || row.history || '').trim();
  const peopleRaw = row.people || row.members || row.householdsize || '';

  const errors = [];

  if (!name) {
    errors.push("Missing household name");
  }

  if (!area) {
    errors.push("Missing area / locality");
  }

  if (!datesRaw) {
    errors.push("Missing refill dates");
  }

  let people = 4; // default
  if (peopleRaw) {
    const parsedPeople = parseInt(peopleRaw, 10);
    if (isNaN(parsedPeople) || parsedPeople < 1) {
      errors.push(`Invalid people count '${peopleRaw}' (must be a positive number)`);
    } else {
      people = parsedPeople;
    }
  }

  let parsedDates = [];
  if (datesRaw) {
    // Semicolon is primary separator, also accept comma if no semicolon
    const dateParts = datesRaw.includes(';') ? datesRaw.split(';') : datesRaw.split(',');
    for (const part of dateParts) {
      const trimmedPart = part.trim();
      if (!trimmedPart) continue;
      const parsed = parseRefillDate(trimmedPart);
      if (parsed) {
        parsedDates.push(parsed);
      } else {
        errors.push(`Unrecognized date format: '${trimmedPart}'`);
      }
    }

    if (parsedDates.length === 0 && errors.length === 0) {
      errors.push("No valid dates could be parsed from input");
    }
  }

  const isValid = errors.length === 0;

  return {
    rowNumber: rowIndex,
    name,
    area,
    people,
    datesRaw,
    parsedDates,
    isValid,
    error: errors.join("; ")
  };
}

// ==========================================
// 7. INTERACTIVE MAP CANVAS RENDERER
// ==========================================

const canvas = document.getElementById("mapCanvas");
const ctx = canvas.getContext("2d");

let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;

function setupCanvas() {
  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    ctx.scale(dpr, dpr);
    renderMap();
  }

  window.addEventListener("resize", resize);
  resize();

  // Mouse pan controls
  canvas.addEventListener("mousedown", (e) => {
    if (state.isSettingDepot) {
      handleDepotPlacement(e);
      return;
    }
    isDragging = true;
    dragStartX = e.clientX - state.mapTransform.offsetX;
    dragStartY = e.clientY - state.mapTransform.offsetY;
    canvas.style.cursor = "grabbing";
  });

  window.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    state.mapTransform.offsetX = e.clientX - dragStartX;
    state.mapTransform.offsetY = e.clientY - dragStartY;
    renderMap();
  });

  window.addEventListener("mouseup", () => {
    isDragging = false;
    canvas.style.cursor = state.isSettingDepot ? "crosshair" : "grab";
  });

  // Mouse wheel zoom
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    const newScale = Math.min(Math.max(state.mapTransform.scale * zoomFactor, 12), 120);
    state.mapTransform.scale = newScale;
    renderMap();
  });
}

/**
 * Converts world (km) coordinate to canvas screen pixels
 */
function worldToScreen(x, y) {
  const rect = canvas.getBoundingClientRect();
  const centerX = rect.width / 2 + state.mapTransform.offsetX;
  const centerY = rect.height / 2 + state.mapTransform.offsetY;
  return {
    px: centerX + x * state.mapTransform.scale,
    py: centerY - y * state.mapTransform.scale // y-axis inverted for standard Cartesian
  };
}

/**
 * Converts canvas screen pixels to world (km) coordinate
 */
function screenToWorld(px, py) {
  const rect = canvas.getBoundingClientRect();
  const centerX = rect.width / 2 + state.mapTransform.offsetX;
  const centerY = rect.height / 2 + state.mapTransform.offsetY;
  return {
    x: Math.round(((px - centerX) / state.mapTransform.scale) * 100) / 100,
    y: Math.round(((centerY - py) / state.mapTransform.scale) * 100) / 100
  };
}

function handleDepotPlacement(e) {
  const rect = canvas.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  const world = screenToWorld(px, py);

  state.depot.x = world.x;
  state.depot.y = world.y;
  saveDepot();

  state.isSettingDepot = false;
  document.getElementById("setDepotBtn").classList.remove("active");
  document.getElementById("depotAlertBanner").style.display = "none";
  canvas.classList.remove("setting-depot");
  canvas.style.cursor = "grab";

  showToast(`Depot relocated to (${world.x.toFixed(1)}, ${world.y.toFixed(1)}) km`, "info");
  updateUI();
}

function renderMap() {
  const rect = canvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;

  ctx.clearRect(0, 0, width, height);

  // 1. Draw subtle coordinate grid & axes
  ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
  ctx.lineWidth = 1;

  const origin = worldToScreen(0, 0);
  const gridSizeKm = 2.0;
  const gridPx = gridSizeKm * state.mapTransform.scale;

  // Vertical grid lines
  const startX = origin.px % gridPx;
  for (let x = startX; x < width; x += gridPx) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  // Horizontal grid lines
  const startY = origin.py % gridPx;
  for (let y = startY; y < height; y += gridPx) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // Major axes
  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  ctx.beginPath();
  ctx.moveTo(0, origin.py);
  ctx.lineTo(width, origin.py);
  ctx.moveTo(origin.px, 0);
  ctx.lineTo(origin.px, height);
  ctx.stroke();

  // 2. Draw Area Locality Clusters (Subtle glows and labels)
  const allAreas = { ...DEFAULT_AREAS, ...state.customAreas };
  for (const [name, coord] of Object.entries(allAreas)) {
    const pos = worldToScreen(coord.x, coord.y);
    const radiusPx = 0.65 * state.mapTransform.scale;

    // Locality background circle
    ctx.fillStyle = "rgba(59, 130, 246, 0.07)";
    ctx.beginPath();
    ctx.arc(pos.px, pos.py, radiusPx, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(59, 130, 246, 0.2)";
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Locality label
    ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
    ctx.font = "10px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(name, pos.px, pos.py + radiusPx + 12);
  }

  // 3. Draw Delivery Routes
  const routeCandidates = getDeliveryCandidates();
  const depotScreen = worldToScreen(state.depot.x, state.depot.y);

  // Unoptimized "Before" route (dashed gray/red)
  if (state.showBeforeRoute && routeCandidates.length > 0) {
    ctx.strokeStyle = "rgba(244, 63, 94, 0.55)";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(depotScreen.px, depotScreen.py);

    for (const h of routeCandidates) {
      const hScreen = worldToScreen(h.x, h.y);
      ctx.lineTo(hScreen.px, hScreen.py);
    }
    ctx.lineTo(depotScreen.px, depotScreen.py);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Optimized "After" route (solid bright cyan/blue with arrows)
  if (state.showOptimizedRoute && routeCandidates.length > 0) {
    const optResult = optimizeRouteTSP(routeCandidates, state.depot);
    const stops = optResult.optimizedStops;

    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(depotScreen.px, depotScreen.py);

    const screenPoints = [depotScreen];
    for (const s of stops) {
      const sScreen = worldToScreen(s.x, s.y);
      ctx.lineTo(sScreen.px, sScreen.py);
      screenPoints.push(sScreen);
    }
    ctx.lineTo(depotScreen.px, depotScreen.py);
    screenPoints.push(depotScreen);
    ctx.stroke();

    // Draw numbered order badges on stops
    stops.forEach((stop, idx) => {
      const p = worldToScreen(stop.x, stop.y);
      ctx.fillStyle = "#0284c7";
      ctx.beginPath();
      ctx.arc(p.px, p.py - 14, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 9px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(idx + 1), p.px, p.py - 14);
    });
  }

  // 4. Draw Households
  state.households.forEach((hh) => {
    const p = worldToScreen(hh.x, hh.y);
    const metrics = calculateHouseholdMetrics(hh.dates, hh.people);

    let color = "#10b981"; // safe
    let pulse = false;

    if (metrics.status === "overdue") {
      color = "#ef4444";
      pulse = true;
    } else if (metrics.status === "urgent") {
      color = "#f97316";
      pulse = true;
    } else if (metrics.status === "due-soon") {
      color = "#eab308";
    }

    if (pulse) {
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.arc(p.px, p.py, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1.0;
    }

    // Marker pin
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.px, p.py, 5.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Name label
    ctx.fillStyle = "#f8fafc";
    ctx.font = "10px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(hh.name, p.px, p.py + 14);
  });

  // 5. Draw Depot Hub Marker
  ctx.fillStyle = "#a855f7";
  ctx.shadowColor = "#a855f7";
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(depotScreen.px, depotScreen.py, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Depot star icon / symbol
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 9px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("⌂", depotScreen.px, depotScreen.py - 1);

  ctx.fillStyle = "#e9d5ff";
  ctx.font = "bold 11px -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("DEPOT HUB", depotScreen.px, depotScreen.py - 16);
}

// ==========================================
// 8. STORAGE & PERSISTENCE
// ==========================================

function saveHouseholds() {
  localStorage.setItem(STORAGE_KEY_HOUSEHOLDS, JSON.stringify(state.households));
}

function loadHouseholds() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_HOUSEHOLDS);
    if (raw) {
      const parsed = JSON.parse(raw);
      state.households = parsed.map(hh => ({
        ...hh,
        dates: (hh.dates || []).map(d => new Date(d))
      }));
    }
  } catch (err) {
    console.error("Failed to load households:", err);
    state.households = [];
  }
}

function saveDepot() {
  localStorage.setItem(STORAGE_KEY_DEPOT, JSON.stringify(state.depot));
}

function loadDepot() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DEPOT);
    if (raw) {
      state.depot = JSON.parse(raw);
    }
  } catch (err) {
    console.error("Failed to load depot:", err);
  }
}

function saveCustomAreas() {
  localStorage.setItem(STORAGE_KEY_CUSTOM_AREAS, JSON.stringify(state.customAreas));
}

function loadCustomAreas() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CUSTOM_AREAS);
    if (raw) {
      state.customAreas = JSON.parse(raw);
    }
  } catch (err) {
    console.error("Failed to load custom areas:", err);
  }
}

// ==========================================
// 9. SAMPLE DATA GENERATOR
// ==========================================

function loadSampleData() {
  const sample = [
    {
      id: "hh_1",
      name: "Sharma Residence",
      area: "North Heights",
      people: 4,
      dates: [new Date(2026, 4, 15), new Date(2026, 6, 2), new Date(2026, 7, 18), new Date(2026, 9, 1)] // 01 Oct 2026 -> Due soon (~18 days since refill, gap ~46d)
    },
    {
      id: "hh_2",
      name: "Sunrise Cafe & Bakery",
      area: "Central Market",
      people: 6,
      dates: [new Date(2026, 7, 10), new Date(2026, 8, 12)] // 12 Sep 2026 -> 37 days ago! Gap ~33d -> OVERDUE!
    },
    {
      id: "hh_3",
      name: "Lakeside Villa",
      area: "Lakeside",
      people: 2,
      dates: [new Date(2026, 6, 20), new Date(2026, 8, 25)] // 25 Sep 2026 -> 24 days ago, gap ~67d -> Safe
    },
    {
      id: "hh_4",
      name: "Gupta Family",
      area: "Greenwood Park",
      people: 5,
      dates: [new Date(2026, 7, 28), new Date(2026, 8, 28)] // 28 Sep 2026 -> 21 days ago, gap 31d -> Urgent! (10 days left)
    },
    {
      id: "hh_5",
      name: "Verma Studio Apartment",
      area: "West End",
      people: 1,
      dates: [new Date(2026, 8, 5)] // Only 1 date! Estimated gap ~150d -> Safe
    },
    {
      id: "hh_6",
      name: "Metro Diner",
      area: "East Industrial",
      people: 5,
      dates: [new Date(2026, 7, 1), new Date(2026, 8, 5), new Date(2026, 8, 30)] // 30 Sep 2026 -> gap 25-35d -> Urgent
    }
  ];

  // Assign scattered coordinates
  state.households = sample.map(hh => {
    const coords = getHouseholdCoordinates(hh);
    return { ...hh, x: coords.x, y: coords.y };
  });

  saveHouseholds();
  updateUI();
  showToast("Loaded realistic sample distributor dataset", "info");
}

// ==========================================
// 10. UI UPDATES & DOM INTERACTIONS
// ==========================================

function getDeliveryCandidates() {
  // Return households that are overdue or due within 7 days
  return state.households.filter(hh => {
    const m = calculateHouseholdMetrics(hh.dates, hh.people);
    return m.daysRemaining <= 7;
  });
}

function updateUI() {
  renderStats();
  renderHouseholdsList();
  renderRouteOptimization();
  renderMap();
}

function renderStats() {
  const total = state.households.length;
  let overdueOrUrgent = 0;

  state.households.forEach(hh => {
    const m = calculateHouseholdMetrics(hh.dates, hh.people);
    if (m.status === "overdue" || m.status === "urgent") {
      overdueOrUrgent++;
    }
  });

  document.getElementById("statTotalHouseholds").textContent = total;
  document.getElementById("statUrgentCount").textContent = overdueOrUrgent;
  document.getElementById("statDepotLocation").textContent = `(${state.depot.x.toFixed(1)}, ${state.depot.y.toFixed(1)}) km`;
  document.getElementById("householdsTabBadge").textContent = total;
}

function renderHouseholdsList() {
  const container = document.getElementById("householdListContainer");
  container.innerHTML = "";

  let countAll = 0;
  let countOverdue = 0;
  let countUrgent = 0;
  let countDueSoon = 0;
  let countSafe = 0;

  const filtered = state.households.filter(hh => {
    const m = calculateHouseholdMetrics(hh.dates, hh.people);
    countAll++;
    if (m.status === "overdue") countOverdue++;
    if (m.status === "urgent") countUrgent++;
    if (m.status === "due-soon") countDueSoon++;
    if (m.status === "safe") countSafe++;

    if (state.activeFilter === "all") return true;
    return m.status === state.activeFilter;
  });

  document.getElementById("countAll").textContent = countAll;
  document.getElementById("countOverdue").textContent = countOverdue;
  document.getElementById("countUrgent").textContent = countUrgent;
  document.getElementById("countDueSoon").textContent = countDueSoon;
  document.getElementById("countSafe").textContent = countSafe;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding: 40px 20px; color: var(--text-muted);">
        <div style="font-size: 2rem; margin-bottom: 8px;">📋</div>
        <p style="font-size: 0.9rem; font-weight:600;">No households found</p>
        <p style="font-size: 0.78rem; margin-top: 4px;">Add a household or click "Load Sample Data" to get started.</p>
      </div>
    `;
    return;
  }

  filtered.forEach(hh => {
    const m = calculateHouseholdMetrics(hh.dates, hh.people);
    const card = document.createElement("div");
    card.className = `household-card ${m.status}`;

    let statusText = "Safe";
    if (m.status === "overdue") statusText = `Empty (${Math.abs(m.daysRemaining)}d overdue)`;
    else if (m.status === "urgent") statusText = `Urgent (${m.daysRemaining}d left)`;
    else if (m.status === "due-soon") statusText = `Due in ${m.daysRemaining}d`;
    else statusText = `Safe (${m.daysRemaining}d left)`;

    const datesFormatted = (m.sortedDates || []).map(d => formatDate(d)).join(", ");
    const gapsDisplay = m.gaps.length > 0 
      ? m.gaps.map(g => `${g}d`).join(", ") + (m.isEstimated ? " (est. from family size)" : "")
      : "N/A";

    card.innerHTML = `
      <div class="card-header">
        <div class="card-title-group">
          <h3>${escapeHtml(hh.name)}</h3>
          <div style="display:flex; gap:6px; align-items:center; margin-top:3px;">
            <span class="area-tag">📍 ${escapeHtml(hh.area)}</span>
            <span class="people-tag">👥 ${hh.people} people</span>
          </div>
        </div>
        <span class="status-badge ${m.status}">${statusText}</span>
      </div>

      <div class="card-grid">
        <div>
          <div class="card-metric-label">Last Refill Date</div>
          <div class="card-metric-val">${formatDate(m.lastDate)} (${m.daysSinceRefill}d ago)</div>
        </div>
        <div>
          <div class="card-metric-label">Predicted Runout</div>
          <div class="card-metric-val">${formatDate(m.predictedRunout)}</div>
        </div>
        <div>
          <div class="card-metric-label">Consumption Cycle</div>
          <div class="card-metric-val">Avg ${m.avgGap} days / cylinder</div>
        </div>
        <div>
          <div class="card-metric-label">Calculated Gaps</div>
          <div class="card-metric-val">${gapsDisplay}</div>
        </div>
      </div>

      <div class="history-strip">
        <strong>History:</strong> ${datesFormatted}
      </div>

      <div class="card-actions">
        <button class="btn btn-sm btn-refill" onclick="handleLogRefillToday('${hh.id}')" title="Log delivery made today">
          ⚡ Log Refill Today
        </button>
        <button class="btn btn-sm btn-danger" onclick="handleDeleteHousehold('${hh.id}')" title="Remove customer">
          Delete
        </button>
      </div>
    `;

    container.appendChild(card);
  });
}

function renderRouteOptimization() {
  const candidates = getDeliveryCandidates();
  document.getElementById("routesTabBadge").textContent = `${candidates.length} to deliver`;

  const beforeCol = document.getElementById("beforeDistance");
  const beforeDur = document.getElementById("beforeDuration");
  const afterCol = document.getElementById("afterDistance");
  const afterDur = document.getElementById("afterDuration");
  const savingsVal = document.getElementById("savingsVal");
  const savingsFuel = document.getElementById("savingsFuel");
  const statKmSaved = document.getElementById("statKmSaved");
  const itineraryContainer = document.getElementById("itineraryListContainer");

  if (candidates.length === 0) {
    beforeCol.textContent = "0.0 km";
    beforeDur.textContent = "~0 mins";
    afterCol.textContent = "0.0 km";
    afterDur.textContent = "~0 mins";
    savingsVal.textContent = "-0.0 km (0%)";
    savingsFuel.textContent = "Est. fuel saved: 0.0 L";
    statKmSaved.textContent = "0.0 km";
    itineraryContainer.innerHTML = `
      <div style="text-align:center; padding: 24px; color: var(--text-muted); font-size: 0.8rem;">
        No pending deliveries needed right now. All households have sufficient gas.
      </div>
    `;
    return;
  }

  // Before route (Naive sequential dispatch)
  const beforeDistance = calculateTourDistance(candidates, state.depot);
  const beforeMinutes = Math.round((beforeDistance / 30) * 60 + candidates.length * 10);

  // After route (TSP 2-Opt)
  const opt = optimizeRouteTSP(candidates, state.depot);
  const afterDistance = opt.distance;
  const afterMinutes = Math.round((afterDistance / 30) * 60 + candidates.length * 10);

  const kmSaved = Math.max(0, beforeDistance - afterDistance);
  const pctSaved = beforeDistance > 0 ? Math.round((kmSaved / beforeDistance) * 100) : 0;
  const litersSaved = (kmSaved / 8.0).toFixed(1); // Assuming 8 km / Liter

  beforeCol.textContent = `${beforeDistance.toFixed(1)} km`;
  beforeDur.textContent = `~${beforeMinutes} mins trip`;
  afterCol.textContent = `${afterDistance.toFixed(1)} km`;
  afterDur.textContent = `~${afterMinutes} mins trip`;

  savingsVal.textContent = `-${kmSaved.toFixed(1)} km (-${pctSaved}%)`;
  savingsFuel.textContent = `Est. fuel saved: ${litersSaved} L`;
  statKmSaved.textContent = `${kmSaved.toFixed(1)} km`;

  // Render Stop Itinerary
  itineraryContainer.innerHTML = "";

  // Start at Depot
  const startStep = document.createElement("div");
  startStep.className = "itinerary-step";
  startStep.innerHTML = `
    <div class="step-badge depot">⌂</div>
    <div class="step-info">
      <div style="font-weight:700;">Start: Distributor Depot Hub</div>
      <div class="step-dist">Departing coordinates (${state.depot.x.toFixed(1)}, ${state.depot.y.toFixed(1)}) km</div>
    </div>
  `;
  itineraryContainer.appendChild(startStep);

  let prevLocation = state.depot;
  opt.optimizedStops.forEach((stop, i) => {
    const legDist = calculateDistance(prevLocation, stop);
    prevLocation = stop;

    const step = document.createElement("div");
    step.className = "itinerary-step";
    step.innerHTML = `
      <div class="step-badge">${i + 1}</div>
      <div class="step-info">
        <div style="font-weight:700;">${escapeHtml(stop.name)}</div>
        <div style="color:var(--text-secondary); font-size:0.75rem;">📍 ${escapeHtml(stop.area)}</div>
      </div>
      <div class="step-dist">+${legDist.toFixed(1)} km</div>
    `;
    itineraryContainer.appendChild(step);
  });

  // End at Depot
  const endDist = calculateDistance(prevLocation, state.depot);
  const endStep = document.createElement("div");
  endStep.className = "itinerary-step";
  endStep.innerHTML = `
    <div class="step-badge depot">⌂</div>
    <div class="step-info">
      <div style="font-weight:700;">Return to Depot Hub</div>
      <div class="step-dist">Complete route loop</div>
    </div>
    <div class="step-dist">+${endDist.toFixed(1)} km</div>
  `;
  itineraryContainer.appendChild(endStep);
}

// ==========================================
// 11. EVENT HANDLERS & MODAL ACTIONS
// ==========================================

// Global actions for inline button clicks
window.handleLogRefillToday = function(id) {
  const hh = state.households.find(h => h.id === id);
  if (!hh) return;

  // Append CURRENT_DATE
  hh.dates.push(new Date(CURRENT_DATE));
  saveHouseholds();
  updateUI();

  const metrics = calculateHouseholdMetrics(hh.dates, hh.people);
  showToast(`Refill logged today for ${hh.name}! Next estimated refill: ${formatDate(metrics.predictedRunout)}`, "success");
};

window.handleDeleteHousehold = function(id) {
  const hh = state.households.find(h => h.id === id);
  if (!hh) return;
  if (!confirm(`Delete ${hh.name}?`)) return;

  state.households = state.households.filter(h => h.id !== id);
  saveHouseholds();
  updateUI();
  showToast(`Deleted ${hh.name}`, "info");
};

function populateAreaDatalist() {
  if (typeof document === "undefined" || !document.getElementById) return;
  const datalist = document.getElementById("areaDataList");
  if (!datalist || !datalist.appendChild) return;
  datalist.innerHTML = "";
  const allAreas = { ...DEFAULT_AREAS, ...state.customAreas };
  for (const name of Object.keys(allAreas)) {
    if (document.createElement) {
      const opt = document.createElement("option");
      opt.value = name;
      datalist.appendChild(opt);
    }
  }
}

function setupEventListeners() {
  // Navigation Tabs
  document.querySelectorAll(".pane-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".pane-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      const targetId = tab.getAttribute("data-tab");
      document.getElementById("householdsTab").style.display = targetId === "householdsTab" ? "flex" : "none";
      document.getElementById("routesTab").style.display = targetId === "routesTab" ? "flex" : "none";
      state.activeTab = targetId;
    });
  });

  // Filter Pills
  document.querySelectorAll(".filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.activeFilter = btn.getAttribute("data-filter");
      renderHouseholdsList();
    });
  });

  // Add Household Modal
  const addModal = document.getElementById("addHouseholdModal");
  document.getElementById("openAddModalBtn").addEventListener("click", () => {
    document.getElementById("addHouseholdForm").reset();
    document.getElementById("hhPeople").value = "4";
    document.getElementById("addLivePreview").style.display = "none";
    addModal.classList.add("open");
  });

  document.getElementById("closeAddModalBtn").addEventListener("click", () => addModal.classList.remove("open"));
  document.getElementById("cancelAddModalBtn").addEventListener("click", () => addModal.classList.remove("open"));

  // Live calculation preview in Add Modal
  const hhDatesInput = document.getElementById("hhDates");
  const hhPeopleInput = document.getElementById("hhPeople");

  function updateAddModalLivePreview() {
    const datesStr = hhDatesInput.value.trim();
    const peopleVal = parseInt(hhPeopleInput.value, 10) || 4;
    const previewBox = document.getElementById("addLivePreview");

    if (!datesStr) {
      previewBox.style.display = "none";
      return;
    }

    const parsed = parseDateList(datesStr);
    if (parsed.length === 0) {
      previewBox.style.display = "block";
      document.getElementById("previewGapsText").textContent = "Gaps: (waiting for valid dates...)";
      document.getElementById("previewDaysSinceText").textContent = "Days since refill: —";
      document.getElementById("previewPredictedRunoutText").textContent = "Predicted Runout: —";
      return;
    }

    const metrics = calculateHouseholdMetrics(parsed, peopleVal);
    previewBox.style.display = "block";

    const gapsText = metrics.isEstimated 
      ? `Estimated gap: ~${metrics.avgGap} days (from household size of ${peopleVal})`
      : `Calculated gaps: [${metrics.gaps.join(", ")}] days (Avg: ${metrics.avgGap}d)`;

    document.getElementById("previewGapsText").textContent = gapsText;
    document.getElementById("previewDaysSinceText").textContent = `Days since last refill: ${metrics.daysSinceRefill} days (Last: ${formatDate(metrics.lastDate)})`;
    document.getElementById("previewPredictedRunoutText").textContent = `Predicted runout: ${formatDate(metrics.predictedRunout)} (${metrics.daysRemaining}d remaining)`;
  }

  hhDatesInput.addEventListener("input", updateAddModalLivePreview);
  hhPeopleInput.addEventListener("input", updateAddModalLivePreview);

  // Form submit: Add Household
  document.getElementById("addHouseholdForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = document.getElementById("hhName").value.trim();
    const area = document.getElementById("hhArea").value.trim();
    const people = parseInt(document.getElementById("hhPeople").value, 10) || 4;
    const datesRaw = document.getElementById("hhDates").value.trim();

    const parsedDates = parseDateList(datesRaw);
    if (parsedDates.length === 0) {
      alert("Please provide at least 1 valid refill date (e.g. '12 Aug' or '12/08/2026').");
      return;
    }

    const newHh = {
      id: "hh_" + Date.now(),
      name,
      area,
      people,
      dates: parsedDates
    };

    const coords = getHouseholdCoordinates(newHh);
    newHh.x = coords.x;
    newHh.y = coords.y;

    state.households.push(newHh);
    saveHouseholds();
    updateUI();
    addModal.classList.remove("open");
    showToast(`Added ${name} in ${area}`, "success");
  });

  // Set Depot Action
  const setDepotBtn = document.getElementById("setDepotBtn");
  setDepotBtn.addEventListener("click", () => {
    state.isSettingDepot = !state.isSettingDepot;
    if (state.isSettingDepot) {
      setDepotBtn.classList.add("active");
      document.getElementById("depotAlertBanner").style.display = "block";
      canvas.classList.add("setting-depot");
      showToast("Click anywhere on the map to place your depot", "info");
    } else {
      setDepotBtn.classList.remove("active");
      document.getElementById("depotAlertBanner").style.display = "none";
      canvas.classList.remove("setting-depot");
    }
  });

  // Map Controls
  document.getElementById("toggleOptimizedRouteBtn").addEventListener("click", (e) => {
    state.showOptimizedRoute = !state.showOptimizedRoute;
    e.target.classList.toggle("active", state.showOptimizedRoute);
    renderMap();
  });

  document.getElementById("toggleBeforeRouteBtn").addEventListener("click", (e) => {
    state.showBeforeRoute = !state.showBeforeRoute;
    e.target.classList.toggle("active", state.showBeforeRoute);
    renderMap();
  });

  document.getElementById("resetMapViewBtn").addEventListener("click", () => {
    state.mapTransform.offsetX = 0;
    state.mapTransform.offsetY = 0;
    state.mapTransform.scale = 34;
    renderMap();
  });

  // Sample Data & Clear All
  document.getElementById("loadSampleDataBtn").addEventListener("click", loadSampleData);
  document.getElementById("clearAllBtn").addEventListener("click", () => {
    if (state.households.length === 0) return;
    if (!confirm("Are you sure you want to clear all households?")) return;
    state.households = [];
    saveHouseholds();
    updateUI();
    showToast("Cleared all household data", "info");
  });

  // Import Modal
  const importModal = document.getElementById("importModal");
  document.getElementById("openImportModalBtn").addEventListener("click", () => {
    document.getElementById("importFileInput").value = "";
    document.getElementById("importRawText").value = "";
    document.getElementById("importPreviewSection").style.display = "none";
    document.getElementById("commitImportBtn").disabled = true;
    importModal.classList.add("open");
  });

  document.getElementById("closeImportModalBtn").addEventListener("click", () => importModal.classList.remove("open"));
  document.getElementById("cancelImportModalBtn").addEventListener("click", () => importModal.classList.remove("open"));

  // Analyze import data button
  document.getElementById("validateImportBtn").addEventListener("click", analyzeImportData);

  // File input change
  document.getElementById("importFileInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const fileName = file.name.toLowerCase();

    // If Excel file and XLSX library available
    if ((fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) && window.XLSX) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const data = new Uint8Array(evt.target.result);
          const workbook = XLSX.read(data, { type: "array" });
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          const csvText = XLSX.utils.sheet_to_csv(firstSheet);
          document.getElementById("importRawText").value = csvText;
          analyzeImportData();
        } catch (err) {
          alert("Error reading Excel file: " + err.message);
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      // Read as plain text/CSV
      const reader = new FileReader();
      reader.onload = (evt) => {
        document.getElementById("importRawText").value = evt.target.result;
        analyzeImportData();
      };
      reader.readAsText(file);
    }
  });

  // Commit valid imported rows
  document.getElementById("commitImportBtn").addEventListener("click", () => {
    const validRows = state.pendingImportRows.filter(r => r.isValid);
    if (validRows.length === 0) return;

    for (const r of validRows) {
      const newHh = {
        id: "hh_" + Date.now() + "_" + Math.random().toString(36).substr(2, 4),
        name: r.name,
        area: r.area,
        people: r.people,
        dates: r.parsedDates
      };
      const coords = getHouseholdCoordinates(newHh);
      newHh.x = coords.x;
      newHh.y = coords.y;
      state.households.push(newHh);
    }

    saveHouseholds();
    updateUI();
    importModal.classList.remove("open");
    showToast(`Successfully imported ${validRows.length} households!`, "success");
  });
}

function analyzeImportData() {
  const rawText = document.getElementById("importRawText").value.trim();
  if (!rawText) {
    alert("Please upload a file or paste CSV data to preview.");
    return;
  }

  const parsedRawRows = parseCSVText(rawText);
  if (parsedRawRows.length === 0) {
    alert("No rows found. Check your file format or headers.");
    return;
  }

  const validatedRows = parsedRawRows.map((row, idx) => validateImportRow(row, idx + 1));
  state.pendingImportRows = validatedRows;

  const validCount = validatedRows.filter(r => r.isValid).length;
  const errorCount = validatedRows.length - validCount;

  // Update summary banner
  const banner = document.getElementById("previewSummaryBanner");
  const summaryText = document.getElementById("previewSummaryText");
  banner.className = errorCount > 0 ? "preview-summary has-errors" : "preview-summary all-valid";
  summaryText.innerHTML = `
    Found <strong>${validatedRows.length}</strong> row(s): 
    <span style="color:var(--success); font-weight:700;">${validCount} valid</span>, 
    <span style="color:var(--critical); font-weight:700;">${errorCount} with problem(s)</span>
  `;

  // Populate preview table
  const tbody = document.getElementById("previewTableBody");
  tbody.innerHTML = "";

  validatedRows.forEach(r => {
    const tr = document.createElement("tr");
    tr.className = r.isValid ? "row-good" : "row-bad";

    const datesDisplay = r.isValid 
      ? r.parsedDates.map(d => formatDate(d)).join("; ")
      : escapeHtml(r.datesRaw || "—");

    const statusBadge = r.isValid
      ? `<span class="row-ok-tag">✓ Ready to import (${r.parsedDates.length} date${r.parsedDates.length > 1 ? 's' : ''})</span>`
      : `<span class="row-error-tag">✗ ${escapeHtml(r.error)}</span>`;

    tr.innerHTML = `
      <td>${r.rowNumber}</td>
      <td><strong>${escapeHtml(r.name || "—")}</strong></td>
      <td>${escapeHtml(r.area || "—")}</td>
      <td>${r.people}</td>
      <td>${datesDisplay}</td>
      <td>${statusBadge}</td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById("importPreviewSection").style.display = "flex";
  document.getElementById("commitImportBtn").disabled = validCount === 0;
  document.getElementById("commitImportBtn").textContent = `Import ${validCount} Valid Row${validCount !== 1 ? 's' : ''}`;
}

// ==========================================
// 12. UTILITIES & NOTIFICATIONS
// ==========================================

function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px)";
    toast.style.transition = "all 0.2s ease";
    setTimeout(() => toast.remove(), 250);
  }, 3500);
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ==========================================
// 13. INITIALIZATION
// ==========================================

function initApp() {
  loadCustomAreas();
  loadDepot();
  loadHouseholds();
  populateAreaDatalist();
  setupCanvas();
  setupEventListeners();

  // If initial state empty, load sample data automatically
  if (state.households.length === 0) {
    loadSampleData();
  } else {
    updateUI();
  }
}

// Run when DOM is ready
document.addEventListener("DOMContentLoaded", initApp);
