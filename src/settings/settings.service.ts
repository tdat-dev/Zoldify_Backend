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
  ){}
  
  async findAll(){
    return this.settingRepository.find();
  }

  async getPublic(){
    const settings = await this.settingRepository.find({
      where: [
        { key: 'site_name' },
        { key: 'site_description' },
        { key: 'contact_email' },
        { key: 'contact_phone' },
        { key: 'contact_address' },
        { key: 'contact_facebook' },
        { key: 'contact_zalo' },
        { key: 'maintenance_mode' },
      ],
    });
    const map: Record<string, string> = {};
    for (const s of settings) {
      map[s.key] = s.value;
    }
    return map;
  }

  async getValue(key: string): Promise<string | null> {
    const setting = await this.settingRepository.findOne({ where: { key } });
    return setting?.value || null;
  }

  async update(updates: Record<string, string>){
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
