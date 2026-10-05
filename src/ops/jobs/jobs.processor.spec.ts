import { JOB_CHOT_VAN_DON, JOB_HUY_DON_QUA_HAN } from './jobs.constants';
import { taoBoXuLy, type CongViecNen } from './jobs.processor';

/**
 * BỘ XỬ LÝ JOB NỀN — module `jobs` trước hôm nay không có `.spec.ts` nào.
 *
 * Phần động của nó (hai worker thật trên Redis thật, đếm số lần một job được
 * thực thi) đã được `scripts/selfcheck-worker.ts` gác từ task #14. Nhưng bài
 * đó CẦN REDIS, nên nó không chạy trong `npm test` — người sửa mã ở đây không
 * có cách nào biết mình làm hỏng gì cho tới khi chạy `npm run check:worker`.
 *
 * File này phủ phần TĨNH, chạy trong một mili-giây và không cần hạ tầng gì:
 * ánh xạ tên job → việc, và nhánh tên lạ.
 *
 * VÌ SAO NHÁNH "TÊN LẠ" LÀ NHÁNH QUAN TRỌNG NHẤT.
 *
 * Nếu bộ xử lý lặng lẽ `return` khi gặp tên không biết, BullMQ đánh dấu job đó
 * là **completed** trong khi không có việc gì được làm. Bảng điều khiển toàn
 * màu xanh, không có job failed nào, mà đơn quá hạn thì không ai huỷ và ký quỹ
 * không ai chốt — tiền nằm im trong két và không ai được báo.
 *
 * Tên job sống ở `jobs.constants.ts` nhưng LỊCH thì nằm trong Redis, tức ở một
 * nơi khác và tồn tại lâu hơn mã. Đổi tên hằng số mà quên lịch cũ là đúng tình
 * huống sinh ra nhánh này.
 */
describe('taoBoXuLy — ánh xạ tên job sang việc', () => {
  /** Bản giả hai dòng, đúng như `CongViecNen` được khai hẹp lại để cho phép. */
  function tasksGia() {
    const daChay: string[] = [];
    const tasks: CongViecNen = {
      autoCancelOrders: () => {
        daChay.push('huy');
        return Promise.resolve();
      },
      settleDeliveredShipments: () => {
        daChay.push('chot');
        return Promise.resolve();
      },
    };
    return { tasks, daChay };
  }

  it(`"${JOB_HUY_DON_QUA_HAN}" gọi autoCancelOrders`, async () => {
    const { tasks, daChay } = tasksGia();
    await taoBoXuLy(tasks)({ name: JOB_HUY_DON_QUA_HAN });
    expect(daChay).toEqual(['huy']);
  });

  it(`"${JOB_CHOT_VAN_DON}" gọi settleDeliveredShipments`, async () => {
    const { tasks, daChay } = tasksGia();
    await taoBoXuLy(tasks)({ name: JOB_CHOT_VAN_DON });
    expect(daChay).toEqual(['chot']);
  });

  it('mỗi tên chỉ gọi ĐÚNG một việc, không gọi nhầm việc kia', async () => {
    // Hai job này đều đụng tiền: một cái hoàn ký quỹ cho người mua, một cái
    // giải ngân cho người bán. Gọi nhầm nhau là chuyển tiền sai hướng.
    const { tasks, daChay } = tasksGia();
    const xuLy = taoBoXuLy(tasks);

    await xuLy({ name: JOB_HUY_DON_QUA_HAN });
    await xuLy({ name: JOB_CHOT_VAN_DON });

    expect(daChay).toEqual(['huy', 'chot']);
  });

  it('TÊN LẠ THÌ NÉM, không được lặng lẽ bỏ qua', async () => {
    // Bài kiểm quan trọng nhất của file. Lặng lẽ `return` thì BullMQ đánh dấu
    // job là completed trong khi không làm gì — bảng điều khiển xanh, đơn quá
    // hạn không ai huỷ, và không có một dòng nào để lần ra.
    const { tasks, daChay } = tasksGia();

    await expect(
      taoBoXuLy(tasks)({ name: 'job-khong-co-that' }),
    ).rejects.toThrow(/không có bộ xử lý/);
    expect(daChay).toEqual([]);
  });

  it('lời báo lỗi chỉ ra ĐÚNG hai chỗ cần xem', async () => {
    // Người đọc lỗi này đang nhìn một job failed lúc 3 giờ sáng. Câu báo phải
    // nói thẳng hai chỗ có thể lệch nhau, chứ không bắt họ đi dò.
    const { tasks } = tasksGia();

    await expect(taoBoXuLy(tasks)({ name: 'ten-cu' })).rejects.toThrow(
      /jobs\.constants\.ts|lịch trong Redis/i,
    );
  });
});
