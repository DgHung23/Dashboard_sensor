# AquaSense – Dashboard giám sát chất lượng nước

Dashboard theo dõi ao nuôi tôm nước lợ theo thời gian thực bằng 3 cảm biến:

| # | Cảm biến | Model | Modbus ID | Đo |
|---|---|---|---|---|
| 01 | pH nước | ES-PH-WT-01 | 01 | pH, nhiệt độ nước |
| 02 | Độ mặn | EC/SAL RS485 | 02 | Độ mặn ‰, EC, nhiệt độ nước |
| 03 | Đất 7 trong 1 (bờ ao) | ES-SOIL-7-IN-1 | 03 | Độ ẩm, nhiệt độ, EC, pH đất, N, P, K |

Thực hiện bởi **Applied Robotics Lab (ARL) – Đại học Greenwich Việt Nam** và **Industry Lab – Viện REMIT**.

Có hai phiên bản, dùng chung một giao diện:

| | Bản tĩnh (GitHub Pages) | Bản máy chủ (Docker) |
|---|---|---|
| Dùng để | Dự phòng, xem nhanh | Vận hành chính |
| Bật/tắt cảm biến | Phím tắt trên trình duyệt đang xem; trạng thái lưu trong trình duyệt đó | Trang **/control** trên điện thoại, hoặc phím tắt. Mọi màn hình cập nhật ngay |
| Cần máy chủ | Không | Docker (Node.js, không thư viện ngoài) |

Trang tự nhận biết đang chạy ở bản nào: có máy chủ thì vào chế độ máy chủ, không có thì dùng chế độ tĩnh.

---

## 1. Bản máy chủ (Docker)

### Chạy

```bash
cp .env.example .env        # rồi đổi CONTROL_PIN
docker compose up -d --build
```

| Địa chỉ | Nội dung |
|---|---|
| `http://<ip-máy-chủ>:8080/` | Dashboard |
| `http://<ip-máy-chủ>:8080/control/` | Trang điều khiển (đăng nhập bằng PIN) |
| `http://<ip-máy-chủ>:8080/healthz` | Kiểm tra sống |

Truy cập từ điện thoại:
- **Cùng mạng Wi-Fi**: mở `http://<IP LAN của máy chạy Docker>:8080/control/`. Nếu Windows chặn, mở cổng 8080 trên tường lửa.
- **Từ Internet**: đặt sau reverse proxy có HTTPS (Caddy, Nginx) hoặc Cloudflare Tunnel, và đặt `TRUST_PROXY=true`.
- **Thêm ra màn hình chính** để dùng như app: Safari → Chia sẻ → *Thêm vào MH chính*; Chrome → *Cài đặt ứng dụng*.

### Biến môi trường (`.env`)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `CONTROL_PIN` | *(trống)* | PIN cho trang điều khiển. Để trống thì máy chủ tự tạo PIN và in ra `docker compose logs`. Đổi PIN sẽ đăng xuất mọi thiết bị |
| `AQ_PORT` | `8080` | Cổng mở ra ngoài |
| `TRUST_PROXY` | `false` | `true` khi chạy sau proxy HTTPS (cookie `Secure`, lấy IP thật) |
| `SESSION_DAYS` | `30` | Thời hạn đăng nhập |

Dữ liệu (trạng thái cảm biến, nhật ký điều khiển, PIN tự tạo, khoá phiên) nằm trong volume `aquasense-data`, nên khởi động lại hay cập nhật image đều không mất.

### API

| Method | Đường dẫn | Mô tả |
|---|---|---|
| GET | `/api/state` | Trạng thái cảm biến (công khai; nhật ký chỉ trả khi đã đăng nhập) |
| GET | `/api/events` | Server-Sent Events: đẩy trạng thái mỗi khi có thay đổi |
| POST | `/api/login` | `{ "pin": "…" }` → cookie phiên (HttpOnly, SameSite=Strict) |
| POST | `/api/logout` | Đăng xuất |
| POST | `/api/sensors/ph` · `/api/sensors/sal` · `/api/sensors/soil` | `{ "on": true/false }` (cần đăng nhập) |

Các lệnh POST cần header `X-Requested-With: aquasense` để chống CSRF. Nhập sai PIN quá 8 lần trong 10 phút sẽ bị khoá tạm.

### Chạy không cần Docker

```bash
CONTROL_PIN=1234 node server/server.js     # Node 20+
```

---

## 2. Bản tĩnh (GitHub Pages – dự phòng)

Đẩy repo lên GitHub → **Settings → Pages** → *Deploy from a branch* → nhánh `main`, thư mục `/ (root)`.
Trang `/control/` trên bản này sẽ báo cần máy chủ; cảm biến chỉ bật/tắt bằng phím tắt.

Chạy thử trên máy: `python -m http.server 8000`.

---

## Phím tắt vận hành (không hiển thị trên giao diện)

| Phím mặc định | Chức năng |
|---|---|
| `Alt + 1` | Bật / tắt cảm biến pH |
| `Alt + 2` | Bật / tắt cảm biến độ mặn |
| `Alt + 3` | Bật / tắt cảm biến đất 7 trong 1 |
| `Ctrl + Alt + K` | Mở hộp thoại cài đặt phím (phím ẩn) |

- **Bản máy chủ**: phím gửi lệnh lên máy chủ. Trình duyệt phải đã đăng nhập tại `/control/` (dùng chung phiên), nếu chưa thì phím không có tác dụng.
- Hộp thoại phím: bấm **Đổi phím** rồi nhấn tổ hợp mới. `Esc` để huỷ, `Backspace` để bỏ gán. Hộp thoại tự báo khi phím bị trùng hoặc là phím trình duyệt giữ lại.
- Quên phím mở hộp thoại: thêm `#phim-tat` vào cuối địa chỉ dashboard.
- Phím mặc định đổi trong `assets/js/config.js` → `shortcuts`.

Khi một cảm biến bị tắt:
- Dashboard chuyển cảm biến đó sang **ngoại tuyến**: thẻ chuyển xám và hiện giá trị cuối, kim đồng hồ về 0.
- Thanh trạng thái hiện số cảm biến còn hoạt động (ví dụ "2/3 cảm biến"). WQI chỉ tính trên dữ liệu nước còn lại; cảm biến đất không tính vào WQI.
- Biểu đồ đứt quãng và có vùng "Ngoại tuyến"; nhật ký ghi sự kiện mất kết nối / kết nối lại.

---

## Cấu trúc

```
index.html                 Dashboard
control/                   Trang điều khiển cho điện thoại (PWA)
assets/css/style.css       Hệ thống giao diện (sáng/tối)
assets/css/control.css     Giao diện trang điều khiển
assets/js/config.js        ⚙️ Tên trạm, ngưỡng, thông số cảm biến, phím tắt, tham số mô hình
assets/js/data.js          Lớp dữ liệu (chu kỳ 5 phút, lưu trữ 180 ngày, trạng thái cảm biến)
assets/js/backend.js       Kết nối máy chủ (SSE) hoặc chế độ tĩnh
assets/js/twin.js          Mô hình mô phỏng bể quan trắc
assets/js/app.js           Đồng hồ đo, biểu đồ, lịch sử, cảnh báo, xuất CSV
assets/js/controls.js      Phím tắt và hộp thoại gán phím
assets/js/control.js       Logic trang điều khiển
assets/vendor/             ECharts 5.5.1 (Apache-2.0), đóng gói sẵn để chạy được trong mạng nội bộ không có Internet
assets/fonts/              IBM Plex Sans / Mono (OFL)
server/server.js           Máy chủ Node.js (không thư viện ngoài)
Dockerfile, docker-compose.yml
```

## Giao diện

- **Nền**: giấy ấm `#f3f2ee`, chữ mực `#15202b`; màu thương hiệu xanh ARL `#185292`. Nền tối dùng xanh mực, không dùng neon.
- **Font**: IBM Plex Sans / IBM Plex Mono, hỗ trợ đầy đủ dấu tiếng Việt.
- **Màu dữ liệu**: pH `#2b5fb4`, độ mặn `#00917f`, nhiệt độ `#c2621a`, cảm biến đất `#a23b72`. Đã kiểm tra độ phân biệt cho người mù màu, cả nền sáng lẫn nền tối. Màu nâu đất bị loại vì lẫn với màu cam của nhiệt độ.
- **Màu trạng thái**: Tối ưu / Cảnh báo / Nguy hiểm. Luôn đi kèm biểu tượng và chữ, không dựa vào màu đơn thuần.
- **Màu theo số liệu**: màu nước trong mô hình đổi theo pH; màu đất bờ đổi theo độ ẩm; vạch trạng thái và biểu tượng cảm biến đổi theo số đo.

## Cảm biến đất bờ ao

Đầu dò ES-SOIL-7-IN-1 cắm ở bờ ao, sâu khoảng 20 cm (vị trí ghi trong `config.js` → `sensors.soil.location`).
Lý do đặt ở bờ thay vì đáy ao: dải EC của đầu dò chỉ đến 10 000 µS/cm, trong khi bùn đáy ao nước lợ (độ mặn ~15 ‰) có EC trên 20 000 µS/cm, sẽ vượt thang đo.

Ở bờ ao, cảm biến theo dõi:
- **pH đất**: bờ ao vùng ĐBSCL thường là đất phèn. pH đất thấp thì mưa dễ rửa phèn xuống ao, làm pH nước giảm.
- **Độ ẩm**: đất quá ẩm sau mưa dễ sạt lở, rò rỉ; quá khô thì nứt bờ.
- **EC**: theo dõi đất bờ nhiễm mặn.

Ngưỡng nằm trong `config.js` → `thresholds` (`moist`, `soilT`, `soilPh`, `soilEc`, `N`, `P`, `K`). N, P, K chưa có tiêu chuẩn cho bờ ao nuôi tôm, nên dashboard ghi là "mức tham chiếu".

Bảng thanh ghi Modbus (theo trang sản phẩm epcb.vn):

| Thanh ghi | Nội dung | Đơn vị |
|---|---|---|
| `0x0006` | pH | 0.01 pH |
| `0x0012` | Độ ẩm | 0.1 % |
| `0x0013` | Nhiệt độ | 0.1 °C |
| `0x0015` | EC | 1 µS/cm |
| `0x001E` · `0x001F` · `0x0020` | N · P · K | mg/kg |
| `0x0100` | Địa chỉ thiết bị (0–255) | đọc/ghi |
| `0x0101` | Tốc độ baud (2400/4800/9600) | đọc/ghi |

Cả 3 cảm biến dùng chung một bus RS485, nên phải đổi địa chỉ đầu dò đất sang **03** (thanh ghi `0x0100`) trước khi nối chung.

## Kết nối cảm biến thật

Số đo hiện được sinh trong `assets/js/data.js` qua hai hàm:
- `sample(slot)` trả về `{ t, ph, sal, temp, ec }` cho mỗi mốc 5 phút.
- `Store.init` / `Store.poll` nạp lịch sử và lấy bản ghi mới.

Khi có gateway thật (Modbus RTU → MQTT), thêm endpoint đọc dữ liệu vào `server/server.js` và thay hai hàm trên bằng `fetch`. Giao diện không phải sửa.
