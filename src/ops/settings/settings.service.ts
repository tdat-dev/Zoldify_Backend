import { Injectable } from '@nestjs/common';
import { CreateSettingDto } from './dto/create-setting.dto';
import { UpdateSettingDto } from './dto/update-setting.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Setting } from './entities/setting.entity';
import { Repository } from 'typeorm';

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(Setting)
    private readonly settingRepository: Repository<Setting>,
  ) {}

  async findAll() {
    return this.settingRepository.find();
  }

  /**
   * Cài đặt ai cũng đọc được, KHÔNG cần đăng nhập.
   *
   * `maintenance_mode` bắt buộc phải nằm ở đây: middleware của frontend đọc cờ
   * này để biết có chuyển người dùng sang trang thông báo hay không, mà lúc đó
   * người dùng chưa đăng nhập. Để nó ở nhóm cần token thì middleware không đọc
   * được, và không ai được báo là site đang đóng.
   *
   * Luôn trả về khoá này kể cả khi bảng chưa có dòng nào — thiếu khoá thì phía
   * đọc phải tự đoán, mà đoán sai theo hướng "đang bảo trì" là đóng nhầm cả site.
   */
  async getPublic() {
    const settings = await this.settingRepository.find({
      where: [
        { key: 'site_name' },
        { key: 'site_description' },
        { key: 'contact_email' },
        { key: 'maintenance_mode' },
      ],
    });
    const map: Record<string, string> = { maintenance_mode: 'false' };
    for (const s of settings) {
      map[s.key] = s.value;
    }
    return map;
  }

  async getValue(key: string): Promise<string | null> {
    const setting = await this.settingRepository.findOne({ where: { key } });
    return setting?.value || null;
  }

  async update(updates: Record<string, string>) {
    for (const [key, value] of Object.entries(updates)) {
      let setting = await this.settingRepository.findOne({ where: { key } });
      if (setting) {
        setting.value = value;
        await this.settingRepository.save(setting);
      } else {
        await this.settingRepository.save(
          this.settingRepository.create({ key, value }),
        );
      }
    }
    return this.findAll();
  }
}
