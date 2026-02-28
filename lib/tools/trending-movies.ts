import { tool } from 'ai';
import { z } from 'zod';

const genreMap: Record<string, number> = {
  Action: 28,
  Adventure: 12,
  Animation: 16,
  Comedy: 35,
  Crime: 80,
  Documentary: 99,
  Drama: 18,
  Family: 10751,
  Fantasy: 14,
  History: 36,
  Horror: 27,
  Music: 10402,
  Mystery: 9648,
  Romance: 10749,
  Thriller: 53,
  War: 10752,
  Western: 37,
};

export const trendingMoviesTool = tool({
  description: 'Get trending movies from the open iTunes RSS feed.',
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const response = await fetch('https://itunes.apple.com/us/rss/topmovies/limit=25/json');
      if (!response.ok) {
        throw new Error(`iTunes RSS failed: ${response.status}`);
      }

      const data = await response.json();
      const entries = data?.feed?.entry || [];

      const results = entries.map((entry: any, index: number) => {
        const image = Array.isArray(entry['im:image']) ? entry['im:image'].at(-1)?.label : null;
        const title = entry['im:name']?.label || entry.title?.label || 'Unknown Movie';
        const category = entry.category?.attributes?.term || 'Drama';
        const releaseDate = entry['im:releaseDate']?.attributes?.label || entry['im:releaseDate']?.label;

        return {
          id: index + 1,
          title,
          overview: entry.summary?.label || `${title} is currently trending on iTunes.`,
          poster_path: image,
          backdrop_path: image,
          vote_average: 0,
          release_date: releaseDate,
          genre_ids: [genreMap[category] || 18],
          popularity: 100 - index,
        };
      });

      return { results };
    } catch (error) {
      console.error('Trending movies error:', error);
      return { results: [] };
    }
  },
});
