import { SetMetadata } from '@nestjs/common';

export const RESPONSE_MESSAGE = 'RESPONSE_MESSAGE';

// Định nghĩa chức năng để gắn message vào controller
export const ResponseMessage = (message: string) => SetMetadata(RESPONSE_MESSAGE, message);
