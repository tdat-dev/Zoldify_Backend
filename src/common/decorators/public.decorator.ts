import { SetMetadata } from '@nestjs/common';

// Định nghĩa key dùng để đánh dấu API/Controller là công khai (không cần check JWT)
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

// Định nghĩa key dùng để đánh dấu API/Controller là không cần check phân quyền (permission)
export const IS_PUBLIC_PERMISSIONS = 'isPublicPermission';
export const SkipCheckPermissions = () => SetMetadata(IS_PUBLIC_PERMISSIONS, true);
