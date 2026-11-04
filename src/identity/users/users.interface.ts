import { UserRole } from './entities/user.entity';

// tác dụng là định nghĩa ra 1 cái khuôn để chứa dữ liệu sau khi đã đăng nhập thành công
export interface IUser {
  id: number;
  full_name: string;
  email: string;
  role: UserRole;
  avatar: string;
  // Phiên của request này (user_sessions.id). Trống với token phát trước khi
  // có bảng phiên.
  sid?: string;
  permissions?: {
    _id: string;
    name: string;
    apiPath: string;
    module: string;
  }[];
}
