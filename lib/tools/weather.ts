import { tool } from 'ai';
import { z } from 'zod';

type WeatherCodeInfo = {
  description: string;
  icon: string;
};

const weatherCodeMap: Record<number, WeatherCodeInfo> = {
  0: { description: 'clear sky', icon: '01d' },
  1: { description: 'mainly clear', icon: '01d' },
  2: { description: 'partly cloudy', icon: '02d' },
  3: { description: 'overcast', icon: '04d' },
  45: { description: 'fog', icon: '50d' },
  48: { description: 'depositing rime fog', icon: '50d' },
  51: { description: 'light drizzle', icon: '09d' },
  53: { description: 'moderate drizzle', icon: '09d' },
  55: { description: 'dense drizzle', icon: '09d' },
  56: { description: 'light freezing drizzle', icon: '13d' },
  57: { description: 'dense freezing drizzle', icon: '13d' },
  61: { description: 'slight rain', icon: '10d' },
  63: { description: 'moderate rain', icon: '10d' },
  65: { description: 'heavy rain', icon: '10d' },
  66: { description: 'light freezing rain', icon: '13d' },
  67: { description: 'heavy freezing rain', icon: '13d' },
  71: { description: 'slight snow fall', icon: '13d' },
  73: { description: 'moderate snow fall', icon: '13d' },
  75: { description: 'heavy snow fall', icon: '13d' },
  77: { description: 'snow grains', icon: '13d' },
  80: { description: 'slight rain showers', icon: '09d' },
  81: { description: 'moderate rain showers', icon: '09d' },
  82: { description: 'violent rain showers', icon: '09d' },
  85: { description: 'slight snow showers', icon: '13d' },
  86: { description: 'heavy snow showers', icon: '13d' },
  95: { description: 'thunderstorm', icon: '11d' },
  96: { description: 'thunderstorm with slight hail', icon: '11d' },
  99: { description: 'thunderstorm with heavy hail', icon: '11d' },
};

const toKelvin = (celsius: number | null | undefined): number => Number(((celsius ?? 0) + 273.15).toFixed(2));

const unix = (iso: string): number => Math.floor(new Date(iso).getTime() / 1000);

const toOpenWeatherAqi = (usAqi: number | null | undefined): number => {
  if (usAqi == null || Number.isNaN(usAqi)) return 0;
  if (usAqi <= 50) return 1;
  if (usAqi <= 100) return 2;
  if (usAqi <= 150) return 3;
  if (usAqi <= 200) return 4;
  return 5;
};

const getWeatherInfo = (code: number | null | undefined): WeatherCodeInfo => {
  return weatherCodeMap[code ?? -1] || { description: 'unknown', icon: '03d' };
};

async function geocodeLocation(location: string) {
  const response = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`,
  );
  if (!response.ok) {
    throw new Error(`Geocoding failed: ${response.status}`);
  }

  const data = await response.json();
  if (!data.results || data.results.length === 0) {
    throw new Error(`Location '${location}' not found`);
  }

  const result = data.results[0];
  return {
    latitude: result.latitude as number,
    longitude: result.longitude as number,
    name: result.name as string,
    country: result.country as string,
    timezone: result.timezone as string,
  };
}

async function reverseGeocode(latitude: number, longitude: number) {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`,
      {
        headers: {
          'User-Agent': 'scira-weather/1.0',
        },
      },
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return {
      name:
        data.address?.city ||
        data.address?.town ||
        data.address?.village ||
        data.address?.municipality ||
        data.name ||
        data.display_name ||
        `${latitude}, ${longitude}`,
      country: data.address?.country || undefined,
    };
  } catch {
    return null;
  }
}

export const weatherTool = tool({
  description:
    'Get weather data for a location or coordinates using open-source Open-Meteo APIs (forecast + air quality).',
  inputSchema: z.object({
    location: z
      .string()
      .optional()
      .describe('Location name, e.g. "London". Required if latitude/longitude are not provided.'),
    latitude: z.number().optional().describe('Latitude coordinate. Required if location is not provided.'),
    longitude: z.number().optional().describe('Longitude coordinate. Required if location is not provided.'),
  }),
  execute: async ({
    location,
    latitude,
    longitude,
  }: {
    location?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  }) => {
    if (!location && (latitude == null || longitude == null)) {
      throw new Error('Either location or both latitude and longitude must be provided');
    }

    let lat = latitude ?? null;
    let lng = longitude ?? null;
    let locationName = location ?? null;
    let country: string | undefined;
    let timezone = 'UTC';

    if (lat == null || lng == null) {
      const geocoded = await geocodeLocation(location!);
      lat = geocoded.latitude;
      lng = geocoded.longitude;
      locationName = geocoded.name;
      country = geocoded.country;
      timezone = geocoded.timezone || 'UTC';
    } else if (!locationName) {
      const reverse = await reverseGeocode(lat, lng);
      locationName = reverse?.name || `${lat}, ${lng}`;
      country = reverse?.country;
    }

    const forecastUrl = new URL('https://api.open-meteo.com/v1/forecast');
    forecastUrl.searchParams.set('latitude', String(lat));
    forecastUrl.searchParams.set('longitude', String(lng));
    forecastUrl.searchParams.set('timezone', 'auto');
    forecastUrl.searchParams.set('forecast_days', '16');
    forecastUrl.searchParams.set(
      'current',
      'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m',
    );
    forecastUrl.searchParams.set(
      'hourly',
      'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation_probability,weather_code,cloud_cover,pressure_msl,wind_speed_10m',
    );
    forecastUrl.searchParams.set(
      'daily',
      'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_sum,wind_speed_10m_max',
    );

    const airUrl = new URL('https://air-quality-api.open-meteo.com/v1/air-quality');
    airUrl.searchParams.set('latitude', String(lat));
    airUrl.searchParams.set('longitude', String(lng));
    airUrl.searchParams.set('timezone', 'auto');
    airUrl.searchParams.set('hourly', 'pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone,us_aqi');

    const [forecastRes, airRes] = await Promise.all([fetch(forecastUrl.toString()), fetch(airUrl.toString())]);
    if (!forecastRes.ok) {
      throw new Error(`Forecast API failed: ${forecastRes.status}`);
    }
    if (!airRes.ok) {
      throw new Error(`Air quality API failed: ${airRes.status}`);
    }

    const forecast = await forecastRes.json();
    const air = await airRes.json();

    const times: string[] = forecast.hourly?.time || [];
    const hourlyList = times
      .map((time, index) => {
        const weatherInfo = getWeatherInfo(forecast.hourly?.weather_code?.[index]);
        return {
          dt: unix(time),
          main: {
            temp: toKelvin(forecast.hourly?.temperature_2m?.[index]),
            feels_like: toKelvin(forecast.hourly?.apparent_temperature?.[index]),
            temp_min: toKelvin(forecast.hourly?.temperature_2m?.[index]),
            temp_max: toKelvin(forecast.hourly?.temperature_2m?.[index]),
            pressure: Math.round(forecast.hourly?.pressure_msl?.[index] ?? 0),
            humidity: Math.round(forecast.hourly?.relative_humidity_2m?.[index] ?? 0),
          },
          weather: [
            {
              id: forecast.hourly?.weather_code?.[index] ?? 0,
              main: weatherInfo.description,
              description: weatherInfo.description,
              icon: weatherInfo.icon,
            },
          ],
          clouds: {
            all: Math.round(forecast.hourly?.cloud_cover?.[index] ?? 0),
          },
          wind: {
            speed: Number((((forecast.hourly?.wind_speed_10m?.[index] ?? 0) as number) / 3.6).toFixed(2)),
          },
          pop: Number((((forecast.hourly?.precipitation_probability?.[index] ?? 0) as number) / 100).toFixed(2)),
        };
      })
      .filter((_, index) => index % 3 === 0)
      .slice(0, 40);

    const dailyTimes: string[] = forecast.daily?.time || [];
    const dailyList = dailyTimes.map((time, index) => {
      const weatherInfo = getWeatherInfo(forecast.daily?.weather_code?.[index]);
      const maxC = forecast.daily?.temperature_2m_max?.[index] ?? 0;
      const minC = forecast.daily?.temperature_2m_min?.[index] ?? 0;
      const dayC = (maxC + minC) / 2;
      return {
        dt: unix(time),
        sunrise: unix(forecast.daily?.sunrise?.[index] || time),
        sunset: unix(forecast.daily?.sunset?.[index] || time),
        temp: {
          day: toKelvin(dayC),
          min: toKelvin(minC),
          max: toKelvin(maxC),
          night: toKelvin(minC),
          eve: toKelvin(dayC),
          morn: toKelvin(minC),
        },
        feels_like: {
          day: toKelvin(dayC),
          night: toKelvin(minC),
          eve: toKelvin(dayC),
          morn: toKelvin(minC),
        },
        pressure: Math.round(forecast.current?.pressure_msl ?? 1013),
        humidity: Math.round(forecast.current?.relative_humidity_2m ?? 0),
        weather: [
          {
            id: forecast.daily?.weather_code?.[index] ?? 0,
            main: weatherInfo.description,
            description: weatherInfo.description,
            icon: weatherInfo.icon,
          },
        ],
        speed: Number((((forecast.daily?.wind_speed_10m_max?.[index] ?? 0) as number) / 3.6).toFixed(2)),
        deg: Math.round(forecast.current?.wind_direction_10m ?? 0),
        clouds: Math.round(forecast.current?.cloud_cover ?? 0),
        pop: Number((((forecast.daily?.precipitation_sum?.[index] ?? 0) as number) / 100).toFixed(2)),
        rain: forecast.daily?.precipitation_sum?.[index] ?? 0,
      };
    });

    const airTimes: string[] = air.hourly?.time || [];
    const airList = airTimes.map((time, index) => {
      const usAqi = air.hourly?.us_aqi?.[index] ?? null;
      return {
        dt: unix(time),
        main: {
          aqi: toOpenWeatherAqi(usAqi),
        },
        components: {
          co: air.hourly?.carbon_monoxide?.[index] ?? 0,
          no: 0,
          no2: air.hourly?.nitrogen_dioxide?.[index] ?? 0,
          o3: air.hourly?.ozone?.[index] ?? 0,
          so2: air.hourly?.sulphur_dioxide?.[index] ?? 0,
          pm2_5: air.hourly?.pm2_5?.[index] ?? 0,
          pm10: air.hourly?.pm10?.[index] ?? 0,
          nh3: 0,
        },
      };
    });

    return {
      list: hourlyList,
      geocoding: {
        latitude: lat,
        longitude: lng,
        name: locationName,
        country,
        timezone,
      },
      air_pollution: {
        list: airList.length > 0 ? [airList[0]] : [],
      },
      air_pollution_forecast: {
        list: airList.slice(0, 72),
      },
      daily_forecast: {
        list: dailyList,
      },
    };
  },
});
