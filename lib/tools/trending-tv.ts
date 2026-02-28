import { tool } from 'ai';
import { z } from 'zod';

const genreMap: Record<string, number> = {
  Action: 10759,
  Adventure: 10759,
  Animation: 16,
  Comedy: 35,
  Crime: 80,
  Documentary: 99,
  Drama: 18,
  Family: 10751,
  Fantasy: 10765,
  History: 36,
  Horror: 9648,
  Music: 10402,
  Mystery: 9648,
  Romance: 10749,
  Thriller: 53,
  War: 10768,
  Western: 37,
};

export const trendingTvTool = tool({
  description: 'Get trending TV content from the open iTunes RSS feed.',
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const response = await fetch('https://itunes.apple.com/us/rss/toptvepisodes/limit=25/json');
      if (!response.ok) {
        throw new Error(`iTunes RSS failed: ${response.status}`);
      }

      const data = await response.json();
      const entries = data?.feed?.entry || [];

      const results = entries.map((entry: any, index: number) => {
        const image = Array.isArray(entry['im:image']) ? entry['im:image'].at(-1)?.label : null;
        const name = entry['im:name']?.label || entry.title?.label || 'Unknown Show';
        const category = entry.category?.attributes?.term || 'Drama';
        const releaseDate = entry['im:releaseDate']?.attributes?.label || entry['im:releaseDate']?.label;

        return {
          id: index + 1,
          name,
          overview: entry.summary?.label || `${name} is currently trending on iTunes.`,
          poster_path: image,
          backdrop_path: image,
          vote_average: 0,
          first_air_date: releaseDate,
          genre_ids: [genreMap[category] || 18],
          popularity: 100 - index,
        };
      });

      return { results };
    } catch (error) {
      console.error('Trending TV shows error:', error);
      return { results: [] };
    }
  },
});
