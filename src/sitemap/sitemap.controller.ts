import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { SitemapService } from './sitemap.service';

@Controller()
export class SitemapController {
  constructor(private readonly sitemapService: SitemapService) {}

  @Public()
  @Get('sitemap.xml')
  @Header('Content-Type', 'application/xml')
  async getSitemap() {
    const urls = await this.sitemapService.generateUrls();

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${u.loc}</loc>
    ${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}
    <priority>${u.priority}</priority>
  </url>`,
  )
  .join('\n')}
</urlset>`;

    return xml;
  }
}