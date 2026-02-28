import { tool } from 'ai';
import { z } from 'zod';

const iataToIcaoAirline: Record<string, string> = {
  AA: 'AAL',
  UA: 'UAL',
  DL: 'DAL',
  WN: 'SWA',
  B6: 'JBU',
  AS: 'ASA',
  NK: 'NKS',
  F9: 'FFT',
  BA: 'BAW',
  LH: 'DLH',
  AF: 'AFR',
  KL: 'KLM',
  QR: 'QTR',
  EK: 'UAE',
  SQ: 'SIA',
  AI: 'AIC',
  TK: 'THY',
  IB: 'IBE',
  AC: 'ACA',
  LX: 'SWR',
};

function toUnix(dateString: string, end = false): number {
  const base = new Date(`${dateString}T00:00:00Z`).getTime() / 1000;
  return end ? Math.floor(base + 86399) : Math.floor(base);
}

function formatIso(unix?: number | null): string {
  if (!unix || Number.isNaN(unix)) return new Date().toISOString();
  return new Date(unix * 1000).toISOString();
}

function pickFlightStatus(onGround: boolean | null | undefined, positionTs?: number | null, lastContactTs?: number | null) {
  if (onGround === false) return 'in_air';
  if (onGround === true) return 'on_ground';

  const now = Math.floor(Date.now() / 1000);
  const freshest = Math.max(positionTs || 0, lastContactTs || 0);
  if (freshest > 0 && now - freshest < 3600) return 'active';
  return 'scheduled';
}

async function fetchOpenSkyState(callsign: string) {
  const response = await fetch('https://opensky-network.org/api/states/all');
  if (!response.ok) {
    throw new Error(`OpenSky states API failed: ${response.status}`);
  }
  const data = await response.json();
  const states: any[] = Array.isArray(data?.states) ? data.states : [];

  const normalizedCallsign = callsign.trim().toUpperCase();
  const matched = states.find((s) => {
    const stateCallsign = String(s?.[1] || '')
      .trim()
      .toUpperCase();
    return stateCallsign === normalizedCallsign || stateCallsign.startsWith(normalizedCallsign);
  });

  return matched || null;
}

async function fetchOpenSkyHistory(callsign: string, scheduledDepartureDate: string) {
  const begin = toUnix(scheduledDepartureDate);
  const end = toUnix(scheduledDepartureDate, true);
  const url = `https://opensky-network.org/api/flights/callsign?callsign=${encodeURIComponent(callsign)}&begin=${begin}&end=${end}`;
  const response = await fetch(url);
  if (!response.ok) {
    return null;
  }
  const data = await response.json();
  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }
  return data[0];
}

export const flightTrackerTool = tool({
  description: 'Track flight information and status using open-source OpenSky Network data.',
  inputSchema: z.object({
    carrierCode: z.string().describe('The 2-letter airline carrier code (e.g., AI, BA, AA)'),
    flightNumber: z.string().describe('The flight number without carrier code (e.g., 2480)'),
    scheduledDepartureDate: z.string().describe('The scheduled departure date in YYYY-MM-DD format'),
  }),
  execute: async ({
    carrierCode,
    flightNumber,
    scheduledDepartureDate,
  }: {
    carrierCode: string;
    flightNumber: string;
    scheduledDepartureDate: string;
  }) => {
    const normalizedCarrier = carrierCode.trim().toUpperCase();
    const normalizedFlight = flightNumber.trim();
    const icaoPrefix = iataToIcaoAirline[normalizedCarrier] || normalizedCarrier;
    const callsign = `${icaoPrefix}${normalizedFlight}`;

    try {
      const [state, history] = await Promise.all([
        fetchOpenSkyState(callsign).catch(() => null),
        fetchOpenSkyHistory(callsign, scheduledDepartureDate).catch(() => null),
      ]);

      if (!state && !history) {
        return {
          data: [],
          error: `No flight data found for ${carrierCode}${flightNumber} on ${scheduledDepartureDate}`,
        };
      }

      const stateCallsign = state ? String(state[1] || '').trim() : callsign;
      const originCountry = state ? String(state[2] || 'Unknown') : 'Unknown';
      const positionTime = state?.[3] as number | null | undefined;
      const lastContact = state?.[4] as number | null | undefined;
      const longitude = (state?.[5] as number | null | undefined) ?? null;
      const latitude = (state?.[6] as number | null | undefined) ?? null;
      const onGround = state?.[8] as boolean | null | undefined;
      const velocity = (state?.[9] as number | null | undefined) ?? null;
      const trueTrack = (state?.[10] as number | null | undefined) ?? null;
      const verticalRate = (state?.[11] as number | null | undefined) ?? null;
      const geoAltitude = (state?.[13] as number | null | undefined) ?? null;

      const departureAirport = history?.estDepartureAirport || 'Unknown';
      const arrivalAirport = history?.estArrivalAirport || 'Unknown';
      const departureIso = formatIso(history?.firstSeen ?? positionTime ?? lastContact);
      const arrivalIso = formatIso(history?.lastSeen ?? undefined);

      const flightStatus = pickFlightStatus(onGround, positionTime, lastContact);

      return {
        data: [
          {
            flight_date: scheduledDepartureDate,
            flight_status: flightStatus,
            departure: {
              airport: departureAirport,
              airport_code: departureAirport,
              timezone: 'UTC',
              iata: departureAirport,
              terminal: null,
              gate: null,
              delay: null,
              scheduled: departureIso,
            },
            arrival: {
              airport: arrivalAirport,
              airport_code: arrivalAirport,
              timezone: 'UTC',
              iata: arrivalAirport,
              terminal: null,
              gate: null,
              delay: null,
              scheduled: arrivalIso,
            },
            airline: {
              name: `${normalizedCarrier} (${originCountry})`,
              iata: normalizedCarrier,
            },
            flight: {
              number: normalizedFlight,
              iata: `${normalizedCarrier}${normalizedFlight}`,
              duration:
                history?.firstSeen && history?.lastSeen
                  ? Math.max(0, Math.round((history.lastSeen - history.firstSeen) / 60))
                  : null,
            },
            amadeus_data: {
              aircraft_type: stateCallsign,
              operating_flight: {
                carrierCode: normalizedCarrier,
                flightNumber: Number(normalizedFlight) || 0,
              },
              segment_duration: history?.firstSeen && history?.lastSeen ? `${history.lastSeen - history.firstSeen}s` : undefined,
            },
            telemetry: {
              callsign: stateCallsign,
              latitude,
              longitude,
              on_ground: onGround,
              velocity_mps: velocity,
              true_track_deg: trueTrack,
              vertical_rate_mps: verticalRate,
              geo_altitude_m: geoAltitude,
              source: 'opensky',
            },
          },
        ],
      };
    } catch (error) {
      return {
        data: [],
        error: error instanceof Error ? error.message : 'Failed to fetch flight data',
      };
    }
  },
});
