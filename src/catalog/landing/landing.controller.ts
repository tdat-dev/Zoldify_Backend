import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '@common/decorators/public.decorator';
import { ResponseMessage } from '@common/decorators/response.decorator';
import { LandingService } from './landing.service';

@Controller('landing')
export class LandingController {
  constructor(private readonly landing: LandingService) {}

  @Public()
  @ResponseMessage('Lấy bộ lọc của danh mục thành công')
  @Get(':category')
  boLoc(@Param('category') category: string) {
    return this.landing.boLoc(category);
  }

  @Public()
  @ResponseMessage('Lấy trang đích thành công')
  @Get(':category/:facet')
  trang(@Param('category') category: string, @Param('facet') facet: string) {
    return this.landing.trang(category, facet);
  }
}
