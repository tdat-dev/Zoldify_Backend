import { Module } from '@nestjs/common';
import { ProductsModule } from '@catalog/products/products.module';
import { AssistantController } from './assistant.controller';
import { AssistantModel } from './assistant-model';
import { AssistantService } from './assistant.service';

/**
 * Trợ lý mua hàng: gõ một câu, ra món. Chỉ bật khi AI_ASSISTANT_ENABLED=true
 * (staging); prod chưa bật thì POST /assistant/chat trả 404.
 */
@Module({
  imports: [ProductsModule],
  controllers: [AssistantController],
  providers: [AssistantService, AssistantModel],
})
export class AssistantModule {}
