import { tool } from 'ai';
import { z } from 'zod';

type MediaKind = 'movie' | 'tv';

type UnifiedResult = {
  kind: MediaKind;
  id: number;
  title: string;
  overview: string;
  poster: string | null;
  backdrop: string | null;
  voteAverage: number;
  releaseDate?: string;
  firstAirDate?: string;
  runtimeMinutes?: number;
  genres: string[];
  cast: Array<{ id: number; name: string; character: string; profile_path: string | null }>;
  language?: string;
};

const mapGenreId = (name: string): number => {
  const key = name.toLowerCase();
  const genreMap: Record<string, number> = {
    action: 28,
    adventure: 12,
    animation: 16,
    comedy: 35,
    crime: 80,
    documentary: 99,
    drama: 18,
    family: 10751,
    fantasy: 14,
    history: 36,
    horror: 27,
    music: 10402,
    mystery: 9648,
    romance: 10749,
    'science fiction': 878,
    thriller: 53,
    war: 10752,
    western: 37,
  };
  return genreMap[key] || 0;
};

async function searchItunes(query: string, media: 'movie' | 'tvShow') {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=${media}&limit=10&entity=${media}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`iTunes search failed: ${response.status}`);
  }
  const data = await response.json();
  return Array.isArray(data?.results) ? data.results : [];
}

async function searchTvMaze(query: string) {
  const response = await fetch(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`);
  if (!response.ok) {
    return [];
  }
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

function cleanHtml(text: string | null | undefined): string {
  if (!text) return '';
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeMovie(item: any): UnifiedResult {
  const title = item.trackName || item.collectionName || 'Unknown movie';
  const poster = item.artworkUrl100 ? String(item.artworkUrl100).replace('100x100', '600x600') : null;
  return {
    kind: 'movie',
    id: Number(item.trackId || item.collectionId || Date.now()),
    title,
    overview: item.longDescription || item.shortDescription || item.description || 'No description available',
    poster,
    backdrop: poster,
    voteAverage: item.contentAdvisoryRating ? 7.0 : 0,
    releaseDate: item.releaseDate,
    runtimeMinutes: item.trackTimeMillis ? Math.round(item.trackTimeMillis / 60000) : undefined,
    genres: item.primaryGenreName ? [item.primaryGenreName] : [],
    cast: [],
    language: item.country || 'en',
  };
}

async function normalizeTv(tvHit: any): Promise<UnifiedResult> {
  const show = tvHit.show || tvHit;
  let cast: Array<{ id: number; name: string; character: string; profile_path: string | null }> = [];

  try {
    const castResponse = await fetch(`https://api.tvmaze.com/shows/${show.id}/cast`);
    if (castResponse.ok) {
      const castData = await castResponse.json();
      cast = (Array.isArray(castData) ? castData : []).slice(0, 8).map((entry: any) => ({
        id: Number(entry.person?.id || 0),
        name: entry.person?.name || 'Unknown',
        character: entry.character?.name || 'Unknown',
        profile_path: entry.person?.image?.medium || null,
      }));
    }
  } catch {
    cast = [];
  }

  return {
    kind: 'tv',
    id: Number(show.id || Date.now()),
    title: show.name || 'Unknown show',
    overview: cleanHtml(show.summary) || 'No description available',
    poster: show.image?.original || show.image?.medium || null,
    backdrop: show.image?.original || show.image?.medium || null,
    voteAverage: Number(show.rating?.average || 0),
    firstAirDate: show.premiered,
    runtimeMinutes: Number(show.runtime || show.averageRuntime || 0) || undefined,
    genres: Array.isArray(show.genres) ? show.genres : [],
    cast,
    language: show.language || 'en',
  };
}

export const movieTvSearchTool = tool({
  description: 'Search for movie or TV content using open APIs (TVMaze + iTunes).',
  inputSchema: z.object({
    query: z.string().describe('The search query for movies/TV shows'),
  }),
  execute: async ({ query }: { query: string }) => {
    try {
      const [movieResults, tvItunesResults, tvMazeResults] = await Promise.all([
        searchItunes(query, 'movie'),
        searchItunes(query, 'tvShow'),
        searchTvMaze(query),
      ]);

      const normalizedMovies = movieResults.map(normalizeMovie);
      const normalizedTvFromItunes = tvItunesResults.slice(0, 5).map((item: any) => ({
        kind: 'tv' as const,
        id: Number(item.trackId || item.collectionId || Date.now()),
        title: item.collectionName || item.trackName || 'Unknown show',
        overview: item.longDescription || item.shortDescription || 'No description available',
        poster: item.artworkUrl100 ? String(item.artworkUrl100).replace('100x100', '600x600') : null,
        backdrop: item.artworkUrl100 ? String(item.artworkUrl100).replace('100x100', '600x600') : null,
        voteAverage: 0,
        firstAirDate: item.releaseDate,
        runtimeMinutes: item.trackTimeMillis ? Math.round(item.trackTimeMillis / 60000) : undefined,
        genres: item.primaryGenreName ? [item.primaryGenreName] : [],
        cast: [],
        language: item.country || 'en',
      }));

      const normalizedTvFromMaze = await Promise.all(tvMazeResults.slice(0, 5).map(normalizeTv));

      const combined = [...normalizedMovies, ...normalizedTvFromMaze, ...normalizedTvFromItunes];
      const firstResult = combined[0];

      if (!firstResult) {
        return { result: null };
      }

      const tmdbLike = {
        id: firstResult.id,
        media_type: firstResult.kind,
        title: firstResult.kind === 'movie' ? firstResult.title : undefined,
        name: firstResult.kind === 'tv' ? firstResult.title : undefined,
        overview: firstResult.overview,
        poster_path: firstResult.poster,
        backdrop_path: firstResult.backdrop,
        vote_average: firstResult.voteAverage,
        vote_count: 0,
        release_date: firstResult.releaseDate,
        first_air_date: firstResult.firstAirDate,
        runtime: firstResult.kind === 'movie' ? firstResult.runtimeMinutes : undefined,
        episode_run_time: firstResult.kind === 'tv' && firstResult.runtimeMinutes ? [firstResult.runtimeMinutes] : [],
        genres: firstResult.genres.map((name, idx) => ({ id: mapGenreId(name) || idx + 1, name })),
        credits: {
          cast: firstResult.cast,
          director: undefined,
          writer: undefined,
        },
        origin_country: [],
        original_language: firstResult.language || 'en',
        production_companies: [],
      };

      return { result: tmdbLike };
    } catch (error) {
      console.error('Movie/TV search error:', error);
      return { result: null };
    }
  },
});
