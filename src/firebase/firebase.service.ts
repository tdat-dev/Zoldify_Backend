import {
  Injectable,
  OnModuleInit,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class FirebaseService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseService.name);
  private initialized = false;

  onModuleInit() {
    const accountPath = path.join(
      __dirname,
      '..',
      '..',
      'firebase-service-account.json',
    );
    if (!fs.existsSync(accountPath)) {
      this.logger.warn(
        'firebase-service-account.json not found. Firebase login disabled.',
      );
      return;
    }
    const serviceAccount = require(accountPath);
    if (!getApps().length) {
      initializeApp({
        credential: cert(serviceAccount),
      });
    }
    this.initialized = true;
    this.logger.log('Firebase initialized successfully');
  }

  async verifyIdToken(idToken: string) {
    if (!this.initialized) {
      throw new UnauthorizedException('Firebase chưa được cấu hình');
    }
    try {
      const decoded = await getAuth().verifyIdToken(idToken);
      return {
        uid: decoded.uid,
        email: decoded.email || '',
        phone_number: decoded.phone_number || '',
        name: decoded.name || '',
        avatar: decoded.picture || '',
      };
    } catch {
      throw new UnauthorizedException('Token không hợp lệ');
    }
  }
}
