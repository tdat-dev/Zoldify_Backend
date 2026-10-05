import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  UseInterceptors,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';
import { Public } from '@common/decorators/public.decorator';
import { RawResponse } from '@common/decorators/raw-response.decorator';
import { SitemapService, SitemapUrl } from './sitemap.service';

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';
const NS = 'http://www.sitemaps.org/schemas/sitemap/0.9';

function bocUrlset(urls: SitemapUrl[]): string {
  const than = urls
    .map(
      (u) => `  <url>
    <loc>${u.loc}</loc>
    ${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}
    <priority>${u.priority}</priority>
  </url>`,
    )
    .join('\n');
  return `${XML_HEADER}\n<urlset xmlns="${NS}">\n${than}\n</urlset>`;
}

/**
 * Google đòi sitemap nằm ở gốc domain, nên các route này không đi qua prefix
 * /api lẫn version. Đổi đường dẫn là mất index tìm kiếm.
 *
 * CACHE Ở ĐÂY CHỨ KHÔNG PHẢI TRONG SERVICE.
 *
 * Thứ đắt không chỉ là truy vấn — phần dựng chuỗi XML cũng là CPU thuần trên
 * luồng JS duy nhất. Cache ở controller giữ luôn cả chuỗi đã dựng, nên lần
 * trúng cache không đụng tới cả database lẫn bộ dựng chuỗi.
 *
 * `CacheInterceptor` đánh khoá theo URL, nên mỗi file con có khoá riêng — đúng
 * điều cần, vì chúng là những tài nguyên khác nhau.
 *
 * Mười phút: Google không crawl sitemap liên tục, nên tươi hơn thế không đem
 * lại gì; mà đây lại là route `@Public()` ai cũng gọi được, nên mỗi phút được
 * cache là một phút không ai bắt luồng JS đi dựng lại vài nghìn chuỗi.
 */
@Controller({ version: VERSION_NEUTRAL })
@UseInterceptors(CacheInterceptor)
@CacheTTL(10 * 60 * 1000)
export class SitemapController {
  constructor(private readonly sitemapService: SitemapService) {}

  /**
   * Bảng chỉ mục — KHÔNG còn chứa URL sản phẩm, chỉ trỏ sang các file con.
   *
   * Đây là lý do cả bài sửa này tồn tại: request vào `/sitemap.xml` giờ chỉ tốn
   * một câu `GROUP BY` và vài chục dòng XML, thay vì nạp cả bảng sản phẩm.
   */
  @Public()
  @RawResponse()
  @Get('sitemap.xml')
  @Header('Content-Type', 'application/xml')
  async getSitemapIndex(): Promise<string> {
    const files = await this.sitemapService.danhSachFileCon();
    const than = files
      .map(
        (f) => `  <sitemap>
    <loc>${f.loc}</loc>
    ${f.lastmod ? `<lastmod>${f.lastmod}</lastmod>` : ''}
  </sitemap>`,
      )
      .join('\n');
    return `${XML_HEADER}\n<sitemapindex xmlns="${NS}">\n${than}\n</sitemapindex>`;
  }

  @Public()
  @RawResponse()
  @Get('sitemap-static.xml')
  @Header('Content-Type', 'application/xml')
  async getSitemapStatic(): Promise<string> {
    return bocUrlset(await this.sitemapService.urlTinh());
  }

  @Public()
  @RawResponse()
  @Get('sitemap-products-:lo.xml')
  @Header('Content-Type', 'application/xml')
  async getSitemapProducts(@Param('lo') lo: string): Promise<string> {
    // Chặn tham số TRƯỚC khi chạm database. Không chặn thì `?lo=999999999` cho
    // ai cũng ép sinh một khoảng id vô nghĩa — rẻ với database nhưng vẫn là một
    // câu truy vấn miễn phí cho người lạ, và route này `@Public()`.
    const n = Number(lo);
    if (!Number.isInteger(n) || n < 0) {
      throw new NotFoundException('Không có file sitemap này');
    }
    const urls = await this.sitemapService.urlSanPham(n);
    // Lô rỗng nghĩa là URL bịa hoặc lô đã hết hàng. Trả 404 chứ không trả một
    // `<urlset>` rỗng: Search Console coi sitemap rỗng là lỗi, và bảng chỉ mục
    // vốn chỉ liệt kê lô có hàng nên Google không bao giờ tự đi vào đây.
    if (urls.length === 0) {
      throw new NotFoundException('Không có file sitemap này');
    }
    return bocUrlset(urls);
  }
}
