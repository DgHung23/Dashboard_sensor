# AquaSense – Dashboard giám sát chất lượng nước

Dashboard theo dõi **pH** và **độ mặn** của ao nuôi tôm nước lợ theo thời gian thực.
Thực hiện bởi **Applied Robotics Lab (ARL) – Đại học Greenwich Việt Nam** và **Industry Lab – Viện REMIT**.

Đây là trang web tĩnh (HTML/CSS/JS), không cần build và có thể deploy thẳng lên GitHub Pages.

## Cấu trúc

```
index.html              Trang chính
assets/css/style.css    Giao diện (tối/sáng, responsive)
assets/js/config.js     ⚙️ Cấu hình: tên trạm, ngưỡng, thông số cảm biến, tham số mô hình
assets/js/data.js       Lớp dữ liệu (chu kỳ 5 phút, lưu trữ 180 ngày)
assets/js/twin.js       Mô hình mô phỏng bể quan trắc (SVG động)
assets/js/app.js        Đồng hồ đo, biểu đồ (ECharts), lịch sử, cảnh báo, xuất CSV
assets/img/             Logo ARL, REMIT, favicon
```

## Chạy thử trên máy

```bash
python -m http.server 8000
# mở http://localhost:8000
```

## Deploy lên GitHub Pages

1. Tạo repository mới trên GitHub (ví dụ `aquasense-dashboard`).
2. Đẩy toàn bộ thư mục này lên nhánh `main`:
   ```bash
   git init
   git add .
   git commit -m "AquaSense dashboard"
   git branch -M main
   git remote add origin https://github.com/<tai-khoan>/aquasense-dashboard.git
   git push -u origin main
   ```
3. Vào **Settings → Pages**. Ở mục *Source* chọn **Deploy from a branch**, rồi chọn nhánh `main`, thư mục `/ (root)`.
4. Sau 1–2 phút, trang sẽ có tại `https://<tai-khoan>.github.io/aquasense-dashboard/`.

## Tùy chỉnh nhanh (`assets/js/config.js`)

- `station`: tên trạm và đối tượng nuôi.
- `thresholds`: ngưỡng tối ưu và ngưỡng cho phép. Mặc định tham chiếu QCVN 02-19:2014/BNNPTNT: pH 7–9, dao động pH ≤ 0.5/ngày, độ mặn 5–35 ‰.
- `sensors`: model và thông số kỹ thuật hiển thị ở mục Thiết bị.
- `installDate`, `lastCalibration`, `calibrationIntervalDays`: ngày lắp đặt và lịch hiệu chuẩn.

## Phím tắt vận hành (không hiển thị trên giao diện)

| Phím mặc định | Chức năng |
|---|---|
| `Alt + 1` | Bật / tắt cảm biến pH |
| `Alt + 2` | Bật / tắt cảm biến độ mặn |
| `Ctrl + Alt + K` | Mở hộp thoại cài đặt phím (phím ẩn) |

Khi một cảm biến bị tắt:
- Trang chuyển cảm biến đó sang trạng thái **ngoại tuyến**: thẻ chuyển xám và hiện giá trị cuối, kim đồng hồ về 0.
- Thanh trạng thái hiện "1/2 CẢM BIẾN", WQI chỉ tính trên dữ liệu còn lại.
- Biểu đồ đứt quãng và có vùng "Ngoại tuyến"; nhật ký ghi sự kiện mất kết nối / kết nối lại.

Trong hộp thoại, bấm **Đổi phím** rồi nhấn tổ hợp mới. `Esc` để huỷ, `Backspace` để bỏ gán. Hộp thoại tự báo khi phím bị trùng hoặc là phím trình duyệt giữ lại.

- Phím đã đổi và trạng thái bật/tắt được lưu trong trình duyệt đang dùng (localStorage), không đồng bộ sang máy khác.
- Quên phím mở hộp thoại: mở trang với đuôi `#phim-tat`, ví dụ `https://<tai-khoan>.github.io/Dashboard_sensor/#phim-tat`.
- Phím mặc định đổi trong `assets/js/config.js` → `shortcuts`.

## Kết nối cảm biến thật

Mọi giá trị đều đi qua `assets/js/data.js`:
- `sample(slot)` trả về `{ t, ph, sal, temp, ec }` cho mỗi mốc 5 phút.
- `Store.init` / `Store.poll` nạp lịch sử và lấy bản ghi mới.

Để dùng dữ liệu từ gateway hoặc máy chủ (MQTT → API), chỉ cần thay hai hàm này bằng lệnh `fetch` tới API. Giao diện không phải sửa gì.
