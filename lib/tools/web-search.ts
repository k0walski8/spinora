import { tool } from 'ai';
import type { UIMessageStreamWriter } from 'ai';
import { z } from 'zod';
import Exa from 'exa-js';
import { serverEnv } from '@/env/server';
import { ChatMessage } from '../types';

type SearchTopic = 'general' | 'news';

const extractDomain = (url: string | null | undefined): string => {
  if (!url || typeof url !== 'string') return '';
  const urlPattern = /^https?:\/\/([^/?#]+)(?:[/?#]|$)/i;
  return url.match(urlPattern)?.[1] || url;
};

const cleanTitle = (title: string): string => {
  return title
    .replace(/\[.*?\]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const deduplicateByDomainAndUrl = <T extends { url: string }>(items: T[]): T[] => {
  const seenDomains = new Set<string>();
  const seenUrls = new Set<string>();

  return items.filter((item) => {
    const domain = extractDomain(item.url);
    const isNewUrl = !seenUrls.has(item.url);
    const isNewDomain = !seenDomains.has(domain);

    if (isNewUrl && isNewDomain) {
      seenUrls.add(item.url);
      seenDomains.add(domain);
      return true;
    }

    return false;
  });
};

const sanitizeSearxHost = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/\/$/, '');
  return `http://${trimmed.replace(/\/$/, '')}`;
};

const defaultSearx = 'http://192.168.50.158:30053';

async function searchSearxng(query: string, maxResults: number, topic: SearchTopic) {
  const host = sanitizeSearxHost(serverEnv.SEARXNG_URL || defaultSearx);
  const url = new URL('/search', host);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('language', 'en-US');
  url.searchParams.set('safesearch', '1');
  url.searchParams.set('categories', topic === 'news' ? 'news' : 'general');

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent': 'scira-search/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`SearXNG failed with status ${response.status}`);
  }

  const data = await response.json();
  const results = Array.isArray(data?.results)
    ? data.results.slice(0, maxResults).map((result: any) => ({
        url: result.url,
        title: cleanTitle(result.title || ''),
        content: (result.content || result.snippet || '').toString().slice(0, 1000),
        published_date: result.publishedDate || result.published_date || undefined,
        author: result.author || result.engine || undefined,
      }))
    : [];

  const images = Array.isArray(data?.infoboxes)
    ? data.infoboxes
        .flatMap((box: any) => (Array.isArray(box?.images) ? box.images : []))
        .slice(0, 3)
        .map((img: any) => ({
          url: typeof img?.url === 'string' ? img.url : '',
          description: cleanTitle(typeof img?.title === 'string' ? img.title : 'Related image'),
        }))
        .filter((item: any) => item.url)
    : [];

  return {
    results: deduplicateByDomainAndUrl(results),
    images: deduplicateByDomainAndUrl(images),
  };
}

async function searchExa(query: string, maxResults: number, topic: SearchTopic) {
  const exa = new Exa(serverEnv.EXA_API_KEY);
  const response = await exa.searchAndContents(query, {
    type: 'auto',
    numResults: Math.max(1, Math.min(maxResults, 15)),
    text: {
      maxCharacters: 1000,
    },
    category: topic === 'news' ? 'news' : undefined,
    livecrawl: 'auto',
  });

  const results = (response?.results || []).map((result: any) => ({
    url: result.url,
    title: cleanTitle(result.title || ''),
    content: (result.text || '').slice(0, 1000),
    published_date: result.publishedDate || undefined,
    author: result.author || undefined,
  }));

  return {
    results: deduplicateByDomainAndUrl(results),
    images: [] as Array<{ url: string; description: string }>,
  };
}

async function runSingleQuery(
  query: string,
  index: number,
  total: number,
  maxResults: number,
  topic: SearchTopic,
  dataStream?: UIMessageStreamWriter<ChatMessage>,
) {
  dataStream?.write({
    type: 'data-query_completion',
    data: {
      query,
      index,
      total,
      status: 'started',
      resultsCount: 0,
      imagesCount: 0,
    },
  });

  try {
    let provider = 'exa';
    let payload = await searchExa(query, maxResults, topic);

    if (!payload.results.length) {
      provider = 'searxng';
      payload = await searchSearxng(query, maxResults, topic);
    }

    dataStream?.write({
      type: 'data-query_completion',
      data: {
        query,
        index,
        total,
        status: 'completed',
        provider,
        resultsCount: payload.results.length,
        imagesCount: payload.images.length,
      },
    });

    return {
      query,
      results: payload.results,
      images: payload.images,
      provider,
    };
  } catch (error) {
    console.error(`Web search failed for query "${query}":`, error);

    dataStream?.write({
      type: 'data-query_completion',
      data: {
        query,
        index,
        total,
        status: 'error',
        resultsCount: 0,
        imagesCount: 0,
      },
    });

    return {
      query,
      results: [],
      images: [],
      provider: 'error',
    };
  }
}

export function webSearchTool(
  dataStream?: UIMessageStreamWriter<ChatMessage> | undefined,
  _searchProvider: 'exa' | 'parallel' | 'tavily' | 'firecrawl' = 'exa',
) {
  return tool({
    description: `Default web search tool. Uses EXA first and automatically falls back to self-hosted SearXNG (${defaultSearx}) when needed.`,
    inputSchema: z.object({
      queries: z.array(z.string().describe('Array of 3-5 search queries to look up on the web.')).min(1),
      maxResults: z
        .array(z.number().describe('Array of max results to return per query. Defaults to 10.'))
        .optional(),
      topics: z.array(z.enum(['general', 'news']).describe('Topic type per query.')).optional(),
      quality: z.array(z.enum(['default', 'best']).optional()).optional(),
    }),
    execute: async ({
      queries,
      maxResults,
      topics,
    }: {
      queries: string[];
      maxResults?: (number | undefined)[];
      topics?: ('general' | 'news' | undefined)[];
      quality?: ('default' | 'best' | undefined)[];
    }) => {
      const cappedQueries = queries.slice(0, 10);
      const total = cappedQueries.length;

      const tasks = cappedQueries.map((query, index) => {
        const perQueryMax = Math.max(1, Math.min(maxResults?.[index] || maxResults?.[0] || 10, 20));
        const topic = (topics?.[index] || topics?.[0] || 'general') as SearchTopic;
        return runSingleQuery(query, index, total, perQueryMax, topic, dataStream);
      });

      const searches = await Promise.all(tasks);
      return { searches };
    },
  });
}
