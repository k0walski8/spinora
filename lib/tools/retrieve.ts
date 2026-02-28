import { tool } from 'ai';
import { z } from 'zod';
import Exa from 'exa-js';
import { serverEnv } from '@/env/server';

const ContentType = z.enum(['general', 'twitter', 'youtube', 'tiktok', 'instagram']);

type ContentTypeValue = z.infer<typeof ContentType>;
type LiveCrawlValue = 'never' | 'auto' | 'preferred';

const exa = new Exa(serverEnv.EXA_API_KEY);

const stripHtml = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const summarize = (text: string, maxLength = 240): string => {
  if (!text) return 'No summary available';
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
};

const toFavicon = (url: string): string => {
  try {
    return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=128`;
  } catch {
    return '';
  }
};

const getPlaywrightServiceUrl = (): string => {
  const configured = (serverEnv.PLAYWRIGHT_SERVICE_URL || '').trim();
  return configured.length > 0 ? configured : 'http://127.0.0.1:3001/extract';
};

async function fetchViaPlaywright(url: string): Promise<{ title?: string; text?: string; description?: string; image?: string } | null> {
  try {
    const endpoint = getPlaywrightServiceUrl();
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        waitUntil: 'networkidle',
        timeoutMs: 20000,
      }),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return {
      title: data.title || data.metadata?.title,
      text: data.text || data.markdown || data.content || data.html,
      description: data.description || data.metadata?.description,
      image: data.image || data.metadata?.image,
    };
  } catch {
    return null;
  }
}

async function fetchViaHttp(url: string): Promise<{ title?: string; text?: string; description?: string; image?: string } | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'scira-retrieve/1.0',
      },
    });

    if (!response.ok) return null;

    const html = await response.text();
    const text = stripHtml(html).slice(0, 8000);

    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
    const descriptionMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["'](.*?)["'][^>]*>/i);
    const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["'](.*?)["'][^>]*>/i);

    return {
      title: titleMatch?.[1]?.trim(),
      description: descriptionMatch?.[1]?.trim(),
      image: ogImageMatch?.[1]?.trim(),
      text,
    };
  } catch {
    return null;
  }
}

async function retrieveSingleUrl(
  url: string,
  _contentType: ContentTypeValue = 'general',
  _includeSummary = true,
  liveCrawl: LiveCrawlValue = 'preferred',
): Promise<{ url: string; result: any; error?: string; source: string; response_time: number }> {
  const start = Date.now();

  try {
    if (!/^https?:\/\//i.test(url)) {
      return {
        url,
        result: null,
        error: 'Invalid URL. URL must start with http:// or https://',
        source: 'validation',
        response_time: (Date.now() - start) / 1000,
      };
    }

    const exaLivecrawl = liveCrawl === 'never' ? 'never' : liveCrawl === 'preferred' ? 'preferred' : 'auto';

    try {
      const exaResult = await exa.getContents([url], {
        text: {
          maxCharacters: 8000,
          includeHtmlTags: false,
        },
        livecrawl: exaLivecrawl,
      });

      const match = exaResult.results?.find((item) => item.url === url) || exaResult.results?.[0];
      if (match?.text?.trim()) {
        return {
          url,
          source: 'exa',
          response_time: (Date.now() - start) / 1000,
          result: {
            url,
            title: match.title || url,
            description: summarize(match.text),
            content: match.text,
            author: match.author || undefined,
            publishedDate: match.publishedDate || undefined,
            image: match.image || undefined,
            favicon: match.favicon || toFavicon(url),
            language: 'en',
          },
        };
      }
    } catch (error) {
      console.error(`EXA retrieve failed for ${url}:`, error);
    }

    const playwrightPayload = await fetchViaPlaywright(url);
    if (playwrightPayload?.text?.trim()) {
      const textContent = playwrightPayload.text.startsWith('<') ? stripHtml(playwrightPayload.text) : playwrightPayload.text;
      return {
        url,
        source: 'playwright',
        response_time: (Date.now() - start) / 1000,
        result: {
          url,
          title: playwrightPayload.title || url,
          description: playwrightPayload.description || summarize(textContent),
          content: textContent.slice(0, 8000),
          author: undefined,
          publishedDate: undefined,
          image: playwrightPayload.image || undefined,
          favicon: toFavicon(url),
          language: 'en',
        },
      };
    }

    const httpPayload = await fetchViaHttp(url);
    if (httpPayload?.text?.trim()) {
      return {
        url,
        source: 'http',
        response_time: (Date.now() - start) / 1000,
        result: {
          url,
          title: httpPayload.title || url,
          description: httpPayload.description || summarize(httpPayload.text),
          content: httpPayload.text,
          author: undefined,
          publishedDate: undefined,
          image: httpPayload.image || undefined,
          favicon: toFavicon(url),
          language: 'en',
        },
      };
    }

    return {
      url,
      result: null,
      error: 'All extraction methods failed',
      source: 'error',
      response_time: (Date.now() - start) / 1000,
    };
  } catch (error) {
    return {
      url,
      result: null,
      error: error instanceof Error ? error.message : 'Failed to retrieve content',
      source: 'error',
      response_time: (Date.now() - start) / 1000,
    };
  }
}

export const retrieveTool = tool({
  description:
    'Extract detailed content from one or multiple explicit URLs provided by the user. Uses EXA first and falls back to self-hosted Playwright extraction.',
  inputSchema: z.object({
    url: z.array(z.string()).describe('Array of URLs to retrieve information from.'),
    content_type: z
      .array(ContentType)
      .optional()
      .describe('Array of content types, one per URL. Default auto-detection. Retained for compatibility.'),
    include_summary: z
      .array(z.boolean())
      .optional()
      .describe('Array of booleans, one per URL. Retained for compatibility.'),
    live_crawl: z
      .array(z.enum(['never', 'auto', 'preferred']))
      .optional()
      .describe('Array of crawl preferences, one per URL. Default is preferred.'),
  }),
  execute: async ({
    url,
    content_type,
    include_summary,
    live_crawl,
  }: {
    url: string[];
    content_type?: ContentTypeValue[];
    include_summary?: boolean[];
    live_crawl?: LiveCrawlValue[];
  }) => {
    const startTime = Date.now();

    try {
      const urlCount = url.length;
      const contentTypes = content_type
        ? content_type.length === 1
          ? Array(urlCount).fill(content_type[0])
          : content_type
        : Array(urlCount).fill('general');
      const includeSummaries = include_summary
        ? include_summary.length === 1
          ? Array(urlCount).fill(include_summary[0])
          : include_summary
        : Array(urlCount).fill(true);
      const liveCrawls = live_crawl
        ? live_crawl.length === 1
          ? Array(urlCount).fill(live_crawl[0])
          : live_crawl
        : Array(urlCount).fill('preferred');

      const settledResults = await Promise.allSettled(
        url.map((singleUrl, index) =>
          retrieveSingleUrl(singleUrl, contentTypes[index], includeSummaries[index], liveCrawls[index]),
        ),
      );

      const successfulResults: any[] = [];
      const sources: string[] = [];
      const errors: string[] = [];

      settledResults.forEach((settled, index) => {
        if (settled.status === 'fulfilled') {
          const { result, error, source } = settled.value;
          if (result) {
            successfulResults.push(result);
            sources.push(source);
          } else {
            errors.push(`${url[index]}: ${error || 'Failed to extract content'}`);
            sources.push('error');
          }
        } else {
          errors.push(`${url[index]}: ${String(settled.reason)}`);
          sources.push('error');
        }
      });

      const responseTime = (Date.now() - startTime) / 1000;

      if (successfulResults.length === 0) {
        return {
          urls: url,
          results: [],
          sources,
          response_time: responseTime,
          error: errors.length > 0 ? errors.join('; ') : 'Failed to retrieve any content',
        };
      }

      return {
        urls: url,
        results: successfulResults,
        sources,
        response_time: responseTime,
        ...(errors.length > 0 && { partial_errors: errors }),
      };
    } catch (error) {
      return {
        urls: url,
        results: [],
        sources: [],
        response_time: (Date.now() - startTime) / 1000,
        error: error instanceof Error ? error.message : 'Failed to retrieve content',
      };
    }
  },
});
