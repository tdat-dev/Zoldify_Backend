import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { normalizePagination } from '@common/dto/pagination.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Category } from './entities/category.entity';
import { Repository } from 'typeorm';
import { TranslationService } from './translation.service';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
    private readonly translation: TranslationService,
  ) {}
  async create(createCategoryDto: CreateCategoryDto) {
    const { name } = createCategoryDto;
    const isName = await this.categoryRepository.findOne({ where: { name } });
    if (isName) {
      throw new BadRequestException(`Danh mục ${name} đã tồn tại!`);
    }
    // Tự dịch tên sang tiếng Anh (Workers AI). Lỗi/chưa cấu hình -> null, bỏ qua.
    const name_en = await this.translation.viToEn(name);
    const saved = await this.categoryRepository.save({
      ...createCategoryDto,
      ...(name_en ? { name_en } : {}),
    });
    return this.findOne(saved.id);
  }

  async findAll(currentPage: string, limit: string, qs: string) {
    const {
      page: numPage,
      size: numLimit,
      offset,
    } = normalizePagination(currentPage, limit);

    const raw = await this.categoryRepository
      .createQueryBuilder('category')
      .leftJoin('products', 'product', 'product.category_id = category.id')
      .select('category.id', 'id')
      .addSelect('category.name', 'name')
      .addSelect('category.name_en', 'name_en')
      .addSelect('category.image', 'image')
      .addSelect('category.description', 'description')
      .addSelect('category.slug', 'slug')
      .addSelect('category.is_active', 'is_active')
      .addSelect('COUNT(product.id)', 'product_count')
      .groupBy('category.id')
      .orderBy('category.id', 'DESC')
      .limit(numLimit)
      .offset(offset)
      .getRawMany();

    const totalItems = await this.categoryRepository.count();

    const result = raw.map((r) => ({
      id: r.id,
      name: r.name,
      name_en: r.name_en,
      image: r.image,
      description: r.description,
      slug: r.slug,
      is_active: r.is_active,
      product_count: Number(r.product_count) || 0,
    }));

    const totalPages = Math.ceil(totalItems / numLimit);

    return {
      meta: {
        current: numPage,
        pageSize: numLimit,
        pages: totalPages,
        total: totalItems,
      },
      result,
    };
  }

  async findOne(id: number) {
    const isCategory = await this.categoryRepository.findOne({ where: { id } });
    if (!isCategory) {
      throw new NotFoundException(`Không tìm thấy danh mục có ID #${id}!`);
    }
    return isCategory;
  }

  async findBySlug(slug: string) {
    const category = await this.categoryRepository.findOne({ where: { slug } });
    if (!category) {
      throw new NotFoundException(`Không tìm thấy danh mục có slug "${slug}"!`);
    }
    return category;
  }

  async update(id: number, updateCategoryDto: UpdateCategoryDto) {
    const isExists = await this.categoryRepository.findOne({ where: { id } });
    if (!isExists) {
      throw new BadRequestException(`Không tìm thấy danh mục cần cập nhật`);
    }
    const patch: Partial<Category> = { ...updateCategoryDto };
    // Đổi tên thì dịch lại tên tiếng Anh. Không đổi tên -> giữ nguyên name_en.
    if (updateCategoryDto.name && updateCategoryDto.name !== isExists.name) {
      const name_en = await this.translation.viToEn(updateCategoryDto.name);
      if (name_en) patch.name_en = name_en;
    }
    await this.categoryRepository.update({ id }, patch);
    return await this.categoryRepository.findOne({ where: { id } });
  }

  async remove(id: number) {
    const isExists = await this.categoryRepository.findOne({ where: { id } });
    if (!isExists) {
      throw new BadRequestException(`Không tìm thấy danh mục cần xóa`);
    }
    await this.categoryRepository.softDelete(id);
    return await this.categoryRepository.find();
  }
}
