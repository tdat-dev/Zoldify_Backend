import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { CreateSettingDto } from './dto/create-setting.dto';
import { UpdateSettingDto } from './dto/update-setting.dto';
import { ResponseMessage } from 'src/common/decorators/response.decorator';
import { Public } from 'src/common/decorators/public.decorator';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Public()
  @Get('public')
  @ResponseMessage('Lấy thông tin cài đặt công khai thành công')
  getPublic(){
    return this.settingsService.getPublic();
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  @ResponseMessage('Lấy tất cả thông tin cài đặt thành công')
  findAll(){
    return this.settingsService.findAll();
  }

  @UseGuards(JwtAuthGuard)
  @Patch()
  @ResponseMessage('Cập nhập cài đặt thành công')
  update(@Body() updates: Record<string, string>){
    return this.settingsService.update(updates);
  }
}
