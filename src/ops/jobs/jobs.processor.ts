import { JOB_CHOT_VAN_DON, JOB_HUY_DON_QUA_HAN } from './jobs.constants';

/**
 * Phần của `TasksService` mà bộ xử lý thật sự cần.
 *
 * Khai hẹp lại thay vì nhận nguyên `TasksService`: bài tự kiểm dựng được bản
 * giả hai dòng để đếm số lần chạy, không phải kéo theo TypeORM và OrdersService
 * chỉ để trả lời câu "job có chạy đúng một lần không".
 */
export interface CongViecNen {
  autoCancelOrders(): Promise<unknown>;
  settleDeliveredShipments(): Promise<unknown>;
}

/**
 * Ánh xạ tên job → việc phải làm.
 *
 * Là hàm tạo (nhận `tasks`, trả về bộ xử lý) chứ không phải phương thức của
 * một provider, để bài tự kiểm chạy nó với hai worker song song trên một hàng
 * đợi test mà không cần dựng Nest.
 *
 * Tên lạ thì NÉM. Nếu lặng lẽ `return`, job đó được đánh dấu completed trong
 * BullMQ trong khi không có việc gì được làm — bảng điều khiển toàn màu xanh,
 * đơn quá hạn không ai huỷ. Ném lỗi để nó nằm trong danh sách failed, nhìn
 * thấy được, đếm được.
 */
export function taoBoXuLy(tasks: CongViecNen) {
  return async (job: { name: string }): Promise<void> => {
    switch (job.name) {
      case JOB_HUY_DON_QUA_HAN:
        await tasks.autoCancelOrders();
        return;
      case JOB_CHOT_VAN_DON:
        await tasks.settleDeliveredShipments();
        return;
      default:
        throw new Error(
          `Job "${job.name}" không có bộ xử lý. Lịch trong Redis còn tên cũ ` +
            'hoặc jobs.constants.ts và jobs.processor.ts lệch nhau.',
        );
    }
  };
}
