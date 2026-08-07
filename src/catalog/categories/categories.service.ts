import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Category } from './entities/category.entity';
import { Repository } from 'typeorm';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
  ){}
  async create(createCategoryDto: CreateCategoryDto) {
    const {name} = createCategoryDto;
    const isName = await this.categoryRepository.findOne({where: {name}})
    if(isName){
      throw new BadRequestException(`Danh mục ${name} đã tồn tại!`)
    }
    const saved = await this.categoryRepository.save(createCategoryDto);
    return this.findOne(saved.id);
  }

  async findAll(currentPage: string, limit: string, qs: string) {
    const numPage = currentPage ? parseInt(currentPage) : 1;
    const numLimit = limit ? parseInt(limit) : 10;

    const offset = (numPage - 1) * numLimit;

    const raw = await this.categoryRepository
      .createQueryBuilder('category')
      .leftJoin('products', 'product', 'product.category_id = category.id')
      .select('category.id', 'id')
      .addSelect('category.name', 'name')
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
    const isExists = await this.categoryRepository.findOne({where: {id}})
    if(!isExists){
      throw new BadRequestException(`Không tìm thấy danh mục cần cập nhật`)
    }
    await this.categoryRepository.update(
      { id },
      updateCategoryDto);
    return await this.categoryRepository.findOne({where: {id}})
  }

  async remove(id: number) {
    const isExists = await this.categoryRepository.findOne({where: {id}})
    if(!isExists){
      throw new BadRequestException(`Không tìm thấy danh mục cần xóa`)
    }
    await this.categoryRepository.softDelete(id);
    return await this.categoryRepository.find();
  }
}
