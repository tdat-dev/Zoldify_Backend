import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsIn,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Public } from '@common/decorators/public.decorator';
import { ResponseMessage } from '@common/decorators/response.decorator';
import { AssistantService } from './assistant.service';

class ChatMessageDto {
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  /** Một câu hỏi mua hàng không cần dài hơn thế; dài hơn là tốn token vô ích. */
  @IsString()
  @MaxLength(300)
  content: string;
}

export class AskAssistantDto {
  /** Sáu tin gần nhất là đủ ngữ cảnh cho câu nối tiếp ("rẻ hơn nữa"). */
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(6)
  messages: ChatMessageDto[];
}

@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  /** Web gọi một lần khi tải trang để biết có hiện nút trợ lý không. */
  @Public()
  @Get('status')
  @ResponseMessage('Trạng thái trợ lý')
  status() {
    return this.assistant.status();
  }

  /**
   * Công khai như trang tìm kiếm: khách chưa đăng nhập cũng hỏi được. Mỗi lượt
   * tốn một lần gọi mô hình nên giới hạn chặt hơn route thường: 1 lượt mỗi
   * giây, 15 lượt mỗi phút cho một IP.
   */
  @Public()
  @Throttle({
    short: { limit: 1, ttl: 1000 },
    medium: { limit: 15, ttl: 60000 },
  })
  @Post('chat')
  @HttpCode(200)
  @ResponseMessage('Trợ lý đã trả lời')
  chat(@Body() dto: AskAssistantDto) {
    return this.assistant.ask(dto.messages);
  }
}
