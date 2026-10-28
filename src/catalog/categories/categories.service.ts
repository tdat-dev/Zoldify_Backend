import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from '@nestjs/cache-manager';
import { docNho, ghiNho, nhoNgan } from '@common/nho-ngan';
import { normalizePagination } from '@common/dto/pagination.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Category } from './entities/category.entity';
import { Repository } from 'typeorm';
import { TranslationService } from './translation.service';
import { ProductStatus } from '@catalog/products/entities/product.entity';

/**
 * Cache danh sách danh mục (kèm `product_count`) 60 giây.
 *
 * VÌ SAO. Mỗi lần trang chủ và thanh điều hướng nạp danh mục, `findAll` LEFT
 * JOIN `products` rồi COUNT theo từng danh mục: với một triệu sản phẩm đang
 * bán là đọc cả triệu mục index ở MỖI request, trên route gọi nhiều nhất.
 *
 * VÌ SAO KHÔNG GẮN VÀO "ĐỜI" DANH SÁCH SẢN PHẨM (`products:list:gen`). Đời đó
 * đổi ở MỌI lần ghi sản phẩm, kể cả mỗi đơn đặt hàng đổi kho
 * (`lamMoiCacheSanPham`). Sàn có vài đơn mỗi giây là cache danh mục không bao
 * giờ trúng. Số "Điện thoại (120)" lệch vài món trong một phút là chấp nhận
 * được; tên/ảnh danh mục thì không, nên sửa danh mục có đời riêng bên dưới.
 */
const DANH_MUC_TTL = 60_000;
const DANH_MUC_DOI = 'categories:list:gen';
const DANH_MUC_DOI_TTL = 24 * 60 * 60_000; // dài hơn hẳn TTL, xem PRODUCT_LIST_GEN_TTL

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
    private readonly translation: TranslationService,
    // @Optional: các spec dựng service bằng tay với hai tham số; thiếu cache
    // thì `nhoNgan` chạy thẳng truy vấn như trước.
    @Optional() @Inject(CACHE_MANAGER) private readonly cache?: Cache,
  ) {}

  /** Đổi đời: mọi khoá danh sách cũ không ai với tới nữa, tự hết hạn. */
  private async moiDanhSach(): Promise<void> {
    await ghiNho(this.cache, DANH_MUC_DOI, Date.now(), DANH_MUC_DOI_TTL);
  }
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
    await this.moiDanhSach();
    return this.findOne(saved.id);
  }

  async findAll(currentPage: string, limit: string, qs: string) {
    const {
      page: numPage,
      size: numLimit,
      offset,
    } = normalizePagination(currentPage, limit);

    const doi = (await docNho<number>(this.cache, DANH_MUC_DOI)) ?? 0;
    return nhoNgan(
      this.cache,
      `categories:list:g${doi}:${numPage}:${numLimit}`,
      DANH_MUC_TTL,
      () => this.truyVanDanhSach(numPage, numLimit, offset),
    );
  }

  private async truyVanDanhSach(
    numPage: number,
    numLimit: number,
    offset: number,
  ) {
    const raw = await this.categoryRepository
      .createQueryBuilder('category')
      // Chỉ đếm sản phẩm khách thật sự thấy được khi bấm vào danh mục: đang
      // bán và chưa xoá. Tới 27/10 điều kiện JOIN chỉ có category_id, nên
      // nháp, chờ duyệt, bị từ chối đều được đếm: "Điện thoại (120)" mà bấm
      // vào chỉ 40 món (dem-san-pham-danh-muc.spec.ts). `deleted_at` ghi rõ dù
      // TypeORM tự thêm khi nhận ra 'products' là entity: chỗ đó phụ thuộc
      // cách khai entity, điều kiện viết tay thì không.
      .leftJoin(
        'products',
        'product',
        'product.category_id = category.id AND product.status = :dangBan ' +
          'AND product.deleted_at IS NULL',
        { dangBan: ProductStatus.ACTIVE },
      )
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
    await this.moiDanhSach();
    return await this.categoryRepository.findOne({ where: { id } });
  }

  async remove(id: number) {
    const isExists = await this.categoryRepository.findOne({ where: { id } });
    if (!isExists) {
      throw new BadRequestException(`Không tìm thấy danh mục cần xóa`);
    }
    await this.categoryRepository.softDelete(id);
    await this.moiDanhSach();
    return await this.categoryRepository.find();
  }
}
