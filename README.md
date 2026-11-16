# Đợi Coffee – Hệ thống quản lý kho nguyên vật liệu

React + Vite. Dựng lại giao diện từ bộ thiết kế Figma (file PTTK).

## Chạy trên VS Code
```bash
npm install
npm run dev
```
Mo http://localhost:5173. Dang nhap duoc xac thuc boi backend va tai khoan trong SQL Server; khong co tai khoan demo.

## Chức năng
- Quản lý nguyên vật liệu: tìm kiếm, lọc, xem / thêm / sửa / xóa (chặn xóa nếu đang được dùng)
- Tồn kho: Kiểm tra tồn kho, Điều chỉnh tồn kho (kiểm tra chênh lệch = 0, số âm), Lịch sử thay đổi + Thùng rác
- Công thức món: xem chi tiết, thêm, xóa
- Nhà cung cấp: validate (bắt buộc, SĐT 10 số bắt đầu 0, email, trùng tên), chặn xóa khi đang dùng
- Hao hụt: tạo / sửa / xem / hủy phiếu, kiểm tra tồn kho đủ, tự trừ/hoàn tồn kho
- Báo cáo Nhập – Xuất – Tồn & Chi phí: chọn kỳ, xuất CSV
- Dữ liệu lưu trong localStorage (xóa localStorage để reset về dữ liệu mẫu)

## Cấu trúc
```
src/
  data.js        dữ liệu mẫu
  store.jsx      state + nghiệp vụ (context)
  components/    Layout, ui (bảng, modal, field...)
  pages/         mỗi màn hình một file
```
Màn hình "Phiếu nhập kho" chưa có trong thiết kế nên chỉ dựng danh sách đơn giản.
