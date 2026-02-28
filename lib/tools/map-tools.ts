import { tool } from 'ai';
import { z } from 'zod';

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const OVERPASS_API = 'https://overpass-api.de/api/interpreter';

const headers = {
  'User-Agent': 'scira-maps/1.0',
  Accept: 'application/json',
};

const parseLat = (value: string | number | undefined): number => Number(typeof value === 'string' ? parseFloat(value) : value);

const geocodeLocation = async (location: string) => {
  const url = `${NOMINATIM_BASE}/search?format=jsonv2&q=${encodeURIComponent(location)}&limit=1&addressdetails=1`;
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Geocoding failed with status ${response.status}`);
  }
  const data = await response.json();
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`Could not geocode location: ${location}`);
  }

  return {
    lat: parseLat(data[0].lat),
    lng: parseLat(data[0].lon),
    address: data[0].display_name as string,
  };
};

const toPlace = (item: any) => {
  const lat = parseLat(item.lat ?? item.center?.lat);
  const lng = parseLat(item.lon ?? item.center?.lon);
  const address = item.display_name || item.tags?.['addr:full'] || item.tags?.name || '';
  const name = item.name || item.tags?.name || address.split(',')[0] || 'Unknown place';

  return {
    place_id: String(item.place_id ?? item.id ?? `${lat},${lng}`),
    name,
    formatted_address: address,
    location: { lat, lng },
    types: [item.type || item.class || 'place'],
    address_components: [],
    viewport: {
      northeast: { lat: lat + 0.01, lng: lng + 0.01 },
      southwest: { lat: lat - 0.01, lng: lng - 0.01 },
    },
    source: 'openstreetmap',
  };
};

export const findPlaceOnMapTool = tool({
  description: 'Find places using OpenStreetMap Nominatim. Supports forward and reverse geocoding.',
  inputSchema: z.object({
    query: z.string().optional().describe('Address or place name for forward geocoding'),
    latitude: z.number().optional().describe('Latitude for reverse geocoding'),
    longitude: z.number().optional().describe('Longitude for reverse geocoding'),
  }),
  execute: async ({ query, latitude, longitude }) => {
    try {
      let searchType: 'forward' | 'reverse';
      let places: any[] = [];

      if (query && query.trim().length > 0) {
        searchType = 'forward';
        const url = `${NOMINATIM_BASE}/search?format=jsonv2&q=${encodeURIComponent(query)}&limit=10&addressdetails=1`;
        const response = await fetch(url, { headers });
        const data = await response.json();
        places = Array.isArray(data) ? data.map(toPlace) : [];
      } else if (latitude !== undefined && longitude !== undefined) {
        searchType = 'reverse';
        const url = `${NOMINATIM_BASE}/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&addressdetails=1`;
        const response = await fetch(url, { headers });
        const data = await response.json();
        places = data ? [toPlace(data)] : [];
      } else {
        throw new Error('Either query or coordinates (latitude/longitude) must be provided');
      }

      return {
        success: true,
        search_type: searchType,
        query: query || `${latitude},${longitude}`,
        places,
        count: places.length,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown geocoding error',
        places: [],
      };
    }
  },
});

export const nearbyPlacesSearchTool = tool({
  description: 'Search for nearby places using OpenStreetMap Overpass API.',
  inputSchema: z.object({
    location: z.string().describe('Location name or coordinates to search around'),
    latitude: z.number().optional().describe('Latitude of the search center'),
    longitude: z.number().optional().describe('Longitude of the search center'),
    type: z.string().describe('Type of place (restaurant, hotel, hospital, museum, etc.)'),
    radius: z.number().describe('Search radius in meters (max 50000)'),
    keyword: z.string().optional().describe('Additional keyword to filter results'),
  }),
  execute: async ({
    location,
    latitude,
    longitude,
    type,
    radius,
    keyword,
  }: {
    location: string;
    latitude?: number | null;
    longitude?: number | null;
    type: string;
    radius: number;
    keyword?: string | null;
  }) => {
    try {
      let searchLat = latitude ?? null;
      let searchLng = longitude ?? null;

      if (searchLat == null || searchLng == null) {
        const geocoded = await geocodeLocation(location);
        searchLat = geocoded.lat;
        searchLng = geocoded.lng;
      }

      const normalizedRadius = Math.max(100, Math.min(radius, 50000));
      const escapedType = type.replace(/"/g, '\\"');
      const escapedKeyword = (keyword || '').replace(/"/g, '\\"');
      const regex = escapedKeyword ? `${escapedType}.*${escapedKeyword}|${escapedKeyword}.*${escapedType}` : escapedType;

      const query = `
[out:json][timeout:25];
(
  node(around:${normalizedRadius},${searchLat},${searchLng})["amenity"~"${regex}",i];
  way(around:${normalizedRadius},${searchLat},${searchLng})["amenity"~"${regex}",i];
  relation(around:${normalizedRadius},${searchLat},${searchLng})["amenity"~"${regex}",i];
  node(around:${normalizedRadius},${searchLat},${searchLng})["tourism"~"${regex}",i];
  way(around:${normalizedRadius},${searchLat},${searchLng})["tourism"~"${regex}",i];
  relation(around:${normalizedRadius},${searchLat},${searchLng})["tourism"~"${regex}",i];
  node(around:${normalizedRadius},${searchLat},${searchLng})["shop"~"${regex}",i];
  way(around:${normalizedRadius},${searchLat},${searchLng})["shop"~"${regex}",i];
  relation(around:${normalizedRadius},${searchLat},${searchLng})["shop"~"${regex}",i];
);
out center tags 20;
      `.trim();

      const response = await fetch(OVERPASS_API, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        },
        body: new URLSearchParams({ data: query }).toString(),
      });

      if (!response.ok) {
        throw new Error(`Overpass API failed: ${response.status}`);
      }

      const data = await response.json();
      const elements: any[] = Array.isArray(data?.elements) ? data.elements : [];

      const places = elements.slice(0, 20).map((element) => {
        const lat = parseLat(element.lat ?? element.center?.lat);
        const lng = parseLat(element.lon ?? element.center?.lon);
        const tags = element.tags || {};
        const name = tags.name || 'Unnamed place';
        const addressParts = [
          tags['addr:housenumber'],
          tags['addr:street'],
          tags['addr:city'],
          tags['addr:postcode'],
          tags['addr:country'],
        ].filter(Boolean);

        return {
          place_id: `${element.type}-${element.id}`,
          name,
          vicinity: addressParts.join(' '),
          formatted_address: addressParts.join(' ') || name,
          geometry: {
            location: { lat, lng },
          },
          rating: null,
          user_ratings_total: null,
          price_level: null,
          opening_hours: {
            open_now: null,
            weekday_text: [],
          },
          photos: [],
          reviews: [],
          types: [tags.amenity || tags.tourism || tags.shop || type].filter(Boolean),
          website: tags.website || null,
          formatted_phone_number: tags.phone || null,
          distance: null,
          source: 'openstreetmap',
        };
      });

      return {
        success: true,
        query: {
          location,
          coordinates: { lat: searchLat, lng: searchLng },
          type,
          radius: normalizedRadius,
          keyword: keyword || null,
        },
        center: { lat: searchLat, lng: searchLng },
        places,
        count: places.length,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown nearby search error',
        places: [],
        center: null,
      };
    }
  },
});
