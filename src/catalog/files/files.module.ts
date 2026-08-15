import { Module } from '@nestjs/common';
import { FilesService } from './files.service';
import { StorageService } from './storage.service';
import { FilesController } from './files.controller';
import { MulterModule } from '@nestjs/platform-express';
import { MulterConfigService } from './multer.config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FileEntity } from './entities/file.entity';

@Module({
  imports: [
    MulterModule.registerAsync({ useClass: MulterConfigService }),
    TypeOrmModule.forFeature([FileEntity]),
  ],
  controllers: [FilesController],
  providers: [FilesService, StorageService],
})
export class FilesModule {}
