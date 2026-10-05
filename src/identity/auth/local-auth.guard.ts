
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

 
@Injectable()

// Extends AuthGuard('local') => thư viện passport sẽ tìm đến 'local' strategy
// 'local' => local.strategy.ts (constructor(super()); 
export class LocalAuthGuard extends AuthGuard('local') {}
    