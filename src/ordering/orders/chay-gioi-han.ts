/**
 * Chạy `viec` trên từng phần tử, tối đa `soLuong` việc cùng lúc, lấy phần tử
 * THEO THỨ TỰ. Trả số phần tử đã bắt đầu chạy: vì lấy theo thứ tự, đó luôn là
 * một đoạn đầu liền mạch của mảng, nên người gọi đặt được con trỏ keyset.
 *
 * `nenDung` được hỏi trước mỗi phần tử: hết giờ thì không nhận việc mới, việc
 * đang chạy vẫn chạy cho xong (cắt ngang một lần ghi trạng thái còn tệ hơn).
 *
 * Tự viết vài dòng thay vì thêm `p-limit`: thêm phụ thuộc cho chừng này việc
 * là thêm một thứ phải theo dõi cập nhật, và p-limit bản mới chỉ có ESM trong
 * khi repo build CommonJS.
 *
 * `viec` được giả định tự bắt lỗi của nó; vẫn bọc thêm một lớp để một lời hứa
 * bị từ chối không làm `Promise.all` bỏ dở các luồng còn lại.
 */
export async function chayGioiHan<T>(
  ds: readonly T[],
  soLuong: number,
  viec: (x: T) => Promise<void>,
  nenDung: () => boolean = () => false,
): Promise<number> {
  let ke = 0;
  const luong = async () => {
    while (ke < ds.length && !nenDung()) {
      const x = ds[ke++];
      try {
        await viec(x);
      } catch {
        // Lỗi đã được `viec` ghi log; ở đây chỉ giữ luồng sống.
      }
    }
  };
  const n = Math.max(1, Math.min(soLuong, ds.length));
  await Promise.all(Array.from({ length: n }, luong));
  return ke;
}
