import { PartialType } from '@nestjs/swagger';
import { CreateSitemapDto } from './create-sitemap.dto';

export class UpdateSitemapDto extends PartialType(CreateSitemapDto) {}
