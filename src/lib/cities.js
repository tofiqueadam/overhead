// A short list of places for quick switching. Coordinates are rounded city
// centres; heights (km) are approximate and only matter at the 0.01 deg level.

export const CITIES = [
  { id: 'addis', name: 'Addis Ababa', lat: 9.03, lon: 38.74, height: 2.355 },
  { id: 'nairobi', name: 'Nairobi', lat: -1.29, lon: 36.82, height: 1.795 },
  { id: 'cairo', name: 'Cairo', lat: 30.04, lon: 31.24, height: 0.02 },
  { id: 'lagos', name: 'Lagos', lat: 6.52, lon: 3.38, height: 0 },
  { id: 'johannesburg', name: 'Johannesburg', lat: -26.2, lon: 28.05, height: 1.75 },
  { id: 'dubai', name: 'Dubai', lat: 25.2, lon: 55.27, height: 0 },
  { id: 'mumbai', name: 'Mumbai', lat: 19.08, lon: 72.88, height: 0 },
  { id: 'tokyo', name: 'Tokyo', lat: 35.68, lon: 139.69, height: 0.04 },
  { id: 'sydney', name: 'Sydney', lat: -33.87, lon: 151.21, height: 0 },
  { id: 'london', name: 'London', lat: 51.51, lon: -0.13, height: 0.01 },
  { id: 'reykjavik', name: 'Reykjavík', lat: 64.15, lon: -21.94, height: 0 },
  { id: 'newyork', name: 'New York', lat: 40.71, lon: -74.01, height: 0.01 },
  { id: 'sanfrancisco', name: 'San Francisco', lat: 37.77, lon: -122.42, height: 0.02 },
  { id: 'saopaulo', name: 'São Paulo', lat: -23.55, lon: -46.63, height: 0.76 },
];

export const DEFAULT_CITY = CITIES[0];
