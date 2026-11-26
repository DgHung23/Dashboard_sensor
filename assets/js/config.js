/* =========================================================
   AquaSense – cấu hình trạm quan trắc
   Chỉnh sửa file này để đổi tên trạm, ngưỡng, thông số thiết bị.
   ========================================================= */
window.AQ_CONFIG = {
  station: {
    name: 'Ao nuôi tôm thẻ chân trắng · Trạm WQ-01',
    short: 'Trạm WQ-01',
    species: 'tôm thẻ chân trắng'
  },
  sampleMinutes: 5,           // chu kỳ lấy mẫu
  historyDays: 180,           // lưu trữ tối đa 6 tháng
  timezoneOffsetHours: 7,     // GMT+7
  installDate: '2026-05-20',  // ngày lắp đặt hệ thống
  lastCalibration: { ph: '2026-10-28', sal: '2026-10-28' },
  calibrationIntervalDays: 90,

  /* Phím tắt mặc định (không có nút trên giao diện).
     Đổi trực tiếp trên web bằng phím mở hộp thoại, hoặc mở trang với đuôi #phim-tat. */
  shortcuts: {
    'toggle-ph':   'Alt+1',       // bật / tắt cảm biến pH
    'toggle-sal':  'Alt+2',       // bật / tắt cảm biến độ mặn
    'open-binder': 'Ctrl+Alt+K'   // phím ẩn: mở hộp thoại cài đặt phím
  },

  /* Ngưỡng đánh giá – tham chiếu QCVN 02-19:2014/BNNPTNT (ao nuôi tôm nước lợ)
     và khuyến nghị kỹ thuật nuôi tôm thẻ chân trắng. */
  thresholds: {
    ph:   { optimal: [7.5, 8.5], acceptable: [7.0, 9.0], scale: [0, 14], dailySwingMax: 0.5 },
    sal:  { optimal: [10, 25],   acceptable: [5, 35],    scale: [0, 40] },
    temp: { optimal: [27, 32],   acceptable: [25, 34],   scale: [20, 38] }
  },

  sensors: {
    ph: {
      name: 'Cảm biến pH',
      model: 'ES-PH-WT-01',
      specs: [
        ['Dải đo', '0 – 14 pH'],
        ['Độ phân giải', '0.01 pH'],
        ['Độ chính xác', '± 0.02 pH'],
        ['Bù nhiệt', 'Tự động · 0 – 60 °C (±0.3 °C)'],
        ['Điện cực', 'Thủy tinh · màng PTFE'],
        ['Nguồn cấp', '9 – 30 VDC'],
        ['Giao tiếp', 'RS485 · Modbus RTU'],
        ['Khung truyền', '4800 bps · 8N1 · ID 01'],
        ['Cấp bảo vệ', 'IP68']
      ],
      address: 1
    },
    sal: {
      name: 'Cảm biến độ mặn',
      model: 'EC/SAL RS485',
      specs: [
        ['Dải đo', '0 – 70 ‰ · EC 0 – 200 mS/cm'],
        ['Độ phân giải', '0.01 ‰'],
        ['Độ chính xác', '± 1.5 % FS'],
        ['Bù nhiệt', 'Tự động · Pt1000 (±0.5 °C)'],
        ['Điện cực', '4 điện cực graphite'],
        ['Nguồn cấp', '9 – 30 VDC'],
        ['Giao tiếp', 'RS485 · Modbus RTU'],
        ['Khung truyền', '4800 bps · 8N1 · ID 02'],
        ['Cấp bảo vệ', 'IP68']
      ],
      address: 2
    }
  },

  brands: {
    arl: 'Applied Robotics Lab (ARL) – không gian nghiên cứu, ứng dụng và chia sẻ tri thức công nghệ hiện đại tại Đại học Greenwich Việt Nam.',
    remit: 'Viện Tài nguyên Môi trường và Công nghệ Y Tin (REMIT) – Khoa học vì tương lai bền vững.'
  },

  /* Tham số mô hình nguồn nước (ao nước lợ vùng ĐBSCL) */
  sim: {
    // xác suất có mưa theo tháng (T1..T12) – miền Nam: mùa mưa T5–T10
    rainProbabilityByMonth: [.03, .02, .05, .12, .40, .55, .60, .60, .65, .60, .28, .08],
    ph:   { mean: 7.98, diurnalAmp: .17, driftAmp: .1, rainDrop: .3, rainRecoveryH: 12, noise: .012 },
    sal:  { mean: 16.2, seasonalAmp: 5.2, peakDoy: 100, tidalAmp: .12, evapAmp: .08, driftAmp: .9, rainDrop: 1.15, rainRecoveryH: 72, noise: .05 },
    temp: { mean: 29.8, seasonalAmp: 1.2, peakDoy: 120, diurnalAmp: 1.4 }
  }
};
