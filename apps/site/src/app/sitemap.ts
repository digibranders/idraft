import type { MetadataRoute } from 'next';

const ROUTES = ['', '/product', '/rank-tracking', '/ai-visibility', '/sources', '/how-it-works', '/roadmap', '/about', '/request-access'] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return ROUTES.map((route) => ({ url: `https://idraft.ai${route}`, changeFrequency: 'monthly', priority: route === '' ? 1 : 0.7 }));
}
