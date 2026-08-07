import { UserRole } from "./entities/user.entity";

// tác dụng là định nghĩa ra 1 cái khuôn để chứa dữ liệu sau khi đã đăng nhập thành công
export interface IUser {
    id: number;
    full_name: string;
    email: string;
    role: UserRole;
    avatar: string;
    permissions?: {
        _id: string;
        name: string;
        apiPath: string;
        module: string;
    }[];
}