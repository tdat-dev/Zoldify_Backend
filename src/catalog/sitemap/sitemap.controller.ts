import { Controller, Get, Header, VERSION_NEUTRAL } from '@nestjs/common';
import { Public } from '@common/decorators/public.decorator';
import { SitemapService } from './sitemap.service';

// Google đòi sitemap nằm ở gốc domain, nên route này không đi qua
// prefix /api lẫn version. Đổi đường dẫn là mất index tìm kiếm.
@Controller({ version: VERSION_NEUTRAL })
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
