// Dữ liệu mẫu lấy theo các màn hình thiết kế (Figma)
export const GROUPS = ['Cà phê', 'Sữa', 'Siro', 'Nguyên liệu thô', 'Vật tư', 'Bao bì']

export const SUPPLIERS = [
  { id: 'NCC0001', name: 'Bacama Coffee & More', phone: '0236355701', address: '12 Nguyễn Văn Linh, Hải Châu', email: 'bacama@gmail.com' },
  { id: 'NCC0002', name: 'Dalat Milk', phone: '0236355702', address: '45 Trần Phú, Hải Châu', email: 'sales@gmail.com' },
  { id: 'NCC0003', name: 'Công ty Monin', phone: '0236355703', address: '88 Lê Duẩn, Thanh Khê', email: 'monincom@gmail.com' },
  { id: 'NCC0004', name: 'Đường Biên Hòa', phone: '0236355704', address: '5 Ông Ích Khiêm, Hải Châu', email: '' },
  { id: 'NCC0005', name: 'Bao bì Lý Xanh', phone: '0236355705', address: '77 Điện Biên Phủ, Thanh Khê', email: 'lyxanh@gmail.com' },
  { id: 'NCC0006', name: 'Sữa đặc Ông Thọ', phone: '0236355706', address: '9 Hùng Vương, Hải Châu', email: '' },
  { id: 'NCC0007', name: 'Vật tư Quán Cà phê', phone: '0236355707', address: '31 Hàm Nghi, Thanh Khê', email: 'vattu@gmail.com' },
  { id: 'NCC0008', name: 'Trà Cao Nguyên Xanh', phone: '0236355708', address: '120 Nguyễn Tri Phương, Hải Châu', email: 'tracaonguyenxanh@gmail.com' },
  { id: 'NCC0009', name: 'Nông sản Hòa Vang', phone: '0236355709', address: 'Hòa Vang, Đà Nẵng', email: 'nongsan@gmail.com' },
  { id: 'NCC0010', name: 'Bánh kem Hải Châu', phone: '0236355710', address: '15 Bạch Đằng, Hải Châu', email: '' },
  { id: 'NCC0011', name: 'Cacao Sơn Trà', phone: '0236355777', address: '14 Ngô Quyền, Sơn Trà', email: 'cacao@gmail.com' },
]

// stock = tồn kho, min = mức tồn tối thiểu, expiry dạng yyyy-mm-dd ('' = không áp dụng)
export const MATERIALS = [
  { id: 'NVL0001', name: 'Cà phê hạt Bacama Blend 5:5', group: 'Cà phê', unit: 'kg', stock: 10, min: 1, expiry: '2027-01-20', ratio: 1000, subUnit: 'g', supplier: 'Bacama Coffee & More' },
  { id: 'NVL0002', name: 'Cà phê Bacama 100% Arabica', group: 'Cà phê', unit: 'kg', stock: 5, min: 6, expiry: '2027-01-05', ratio: 1000, subUnit: 'g', supplier: 'Bacama Coffee & More' },
  { id: 'NVL0003', name: 'Cà phê Bacama Blend 9:1', group: 'Cà phê', unit: 'kg', stock: 5, min: 2, expiry: '2026-11-08', ratio: 1000, subUnit: 'g', supplier: 'Bacama Coffee & More' },
  { id: 'NVL0004', name: 'Sữa đặc', group: 'Sữa', unit: 'kg', stock: 3.9, min: 2, expiry: '2027-04-15', ratio: 1000, subUnit: 'g', supplier: 'Sữa đặc Ông Thọ' },
  { id: 'NVL0005', name: 'Sữa tươi Dalat Milk', group: 'Sữa', unit: 'ml', stock: 180, min: 500, expiry: '2027-06-30', ratio: 1, subUnit: 'ml', supplier: 'Dalat Milk' },
  { id: 'NVL0006', name: 'Syrup Chocolate', group: 'Siro', unit: 'kg', stock: 6.8, min: 1, expiry: '2027-03-10', ratio: 1000, subUnit: 'g', supplier: 'Công ty Monin' },
  { id: 'NVL0007', name: 'Syrup Caramel', group: 'Siro', unit: 'ml', stock: 200, min: 300, expiry: '2026-11-07', ratio: 1, subUnit: 'ml', supplier: 'Công ty Monin' },
  { id: 'NVL0008', name: 'Syrup chanh', group: 'Siro', unit: 'ml', stock: 700, min: 300, expiry: '2026-12-01', ratio: 1, subUnit: 'ml', supplier: 'Công ty Monin' },
  { id: 'NVL0009', name: 'Đường cát', group: 'Nguyên liệu thô', unit: 'kg', stock: 3, min: 1, expiry: '2026-12-01', ratio: 1000, subUnit: 'g', supplier: 'Đường Biên Hòa' },
  { id: 'NVL0010', name: 'Ly giấy 360ml', group: 'Vật tư', unit: 'cái', stock: 120, min: 300, expiry: '', ratio: 1, subUnit: 'cái', supplier: 'Bao bì Lý Xanh' },
]

export const LOSS_REASONS = ['Đổ vỡ/rơi vãi', 'Hư hỏng', 'Hết hạn', 'Chế biến dư', 'Khác']

export const LOSS_SLIPS = [
  { id: 'HH00001', created: '2026-11-01', date: '2026-11-01', reason: 'Đổ vỡ/rơi vãi', note: '', status: 'Hoàn thành', items: [{ materialId: 'NVL0005', qty: 1.5, unit: 'Lít' }] },
  { id: 'HH00002', created: '2026-11-02', date: '2026-11-02', reason: 'Hư hỏng', note: '', status: 'Hoàn thành', items: [{ materialId: 'NVL0004', qty: 2, unit: 'Lon' }] },
  { id: 'HH00003', created: '2026-11-03', date: '2026-11-03', reason: 'Hết hạn', note: '', status: 'Hoàn thành', items: [{ materialId: 'NVL0007', qty: 3, unit: 'Chai' }] },
  { id: 'HH00004', created: '2026-11-05', date: '2026-11-05', reason: 'Chế biến dư', note: '', status: 'Hoàn thành', items: [{ materialId: 'NVL0005', qty: 2, unit: 'Lít' }] },
]

export const TRANSACTIONS = [
  { id: 'GD00001', time: '2026-11-06T08:15', materialId: 'NVL0001', type: 'Nhập kho', delta: 20 },
  { id: 'GD00002', time: '2026-11-06T09:40', materialId: 'NVL0005', type: 'Xuất kho', delta: -6 },
  { id: 'GD00003', time: '2026-11-05T16:20', materialId: 'NVL0009', type: 'Xuất kho', delta: -4.5 },
  { id: 'GD00004', time: '2026-11-05T10:05', materialId: 'NVL0008', type: 'Hao hụt', delta: -0.5 },
  { id: 'GD00005', time: '2026-11-04T14:30', materialId: 'NVL0002', type: 'Nhập kho', delta: 8 },
  { id: 'GD00006', time: '2026-11-04T08:50', materialId: 'NVL0004', type: 'Điều chỉnh', delta: -2 },
  { id: 'GD00007', time: '2026-11-03T17:10', materialId: 'NVL0003', type: 'Xuất kho', delta: -2.2 },
  { id: 'GD00008', time: '2026-11-03T09:25', materialId: 'NVL0010', type: 'Nhập kho', delta: 500 },
  { id: 'GD00009', time: '2026-11-02T15:45', materialId: 'NVL0005', type: 'Nhập kho', delta: 24 },
  { id: 'GD00010', time: '2026-11-02T08:30', materialId: 'NVL0009', type: 'Nhập kho', delta: 25 },
]

// Mẫu các giao dịch đã xóa theo thiết kế màn hình thùng rác.
export const TRASH_SAMPLE = [
  { materialId: 'NVL0009', type: 'Xuất kho', delta: -4.5, time: '2026-11-05T16:20', deletedAt: '2026-11-06T10:32' },
  { materialId: 'NVL0004', type: 'Nhập kho', delta: 12, time: '2026-11-04T18:05', deletedAt: '2026-11-05T08:40' },
  { materialId: 'NVL0008', type: 'Hao hụt', delta: -1, time: '2026-11-02T11:15', deletedAt: '2026-11-03T09:05' },
  { materialId: 'NVL0010', type: 'Xuất kho', delta: -100, time: '2026-10-31T14:50', deletedAt: '2026-11-01T16:22' },
  { materialId: 'NVL0002', type: 'Nhập kho', delta: 5, time: '2026-10-29T09:30', deletedAt: '2026-10-30T08:10' },
]

export const RECIPES = [
  { id: 'MON0001', name: 'Espresso đen', group: 'Cà phê', type: 'Món chính', items: [{ materialId: 'NVL0001', qty: 18, unit: 'g' }] },
  { id: 'MON0002', name: 'Bạc xỉu', group: 'Cà phê', type: 'Món chính', items: [{ materialId: 'NVL0001', qty: 18, unit: 'g' }, { materialId: 'NVL0004', qty: 30, unit: 'g' }, { materialId: 'NVL0005', qty: 100, unit: 'ml' }] },
  { id: 'MON0003', name: 'Flat white', group: 'Cà phê', type: 'Món chính', items: [{ materialId: 'NVL0001', qty: 18, unit: 'g' }, { materialId: 'NVL0005', qty: 150, unit: 'ml' }] },
  { id: 'MON0004', name: 'Cappuccino', group: 'Cà phê', type: 'Món chính', items: [{ materialId: 'NVL0001', qty: 18, unit: 'g' }, { materialId: 'NVL0005', qty: 120, unit: 'ml' }] },
  { id: 'MON0005', name: 'Classic Coldbrew', group: 'Cà phê', type: 'Món chính', items: [{ materialId: 'NVL0002', qty: 25, unit: 'g' }] },
  { id: 'MON0006', name: 'Matcha latte', group: 'Latte', type: 'Món chính', items: [{ materialId: 'NVL0005', qty: 200, unit: 'ml' }] },
  { id: 'MON0007', name: 'Đen đá', group: 'Sinh tố', type: 'Món chính', items: [{ materialId: 'NVL0003', qty: 20, unit: 'g' }, { materialId: 'NVL0009', qty: 10, unit: 'g' }] },
  { id: 'MON0008', name: 'Nâu đá', group: 'Nước ép', type: 'Món chính', items: [{ materialId: 'NVL0003', qty: 20, unit: 'g' }, { materialId: 'NVL0004', qty: 30, unit: 'g' }] },
  { id: 'MON0009', name: 'Thêm shot espresso', group: 'Cà phê', type: 'Extra', items: [{ materialId: 'NVL0001', qty: 18, unit: 'g' }] },
  { id: 'MON0010', name: 'Cà phê sữa Sài Gòn', group: 'Cà phê', type: 'Món chính', items: [{ materialId: 'NVL0002', qty: 20, unit: 'g' }, { materialId: 'NVL0004', qty: 30, unit: 'g' }, { materialId: 'NVL0006', qty: 10, unit: 'g' }] },
]

export const RECEIPTS = [
  { id: 'PN00001', date: '2026-11-06', supplier: 'Bacama Coffee & More', total: 7400000, status: 'Hoàn thành', items: [{ materialId: 'NVL0001', qty: 20, unitPrice: 370000, expiry: '2027-01-20' }] },
  { id: 'PN00002', date: '2026-11-04', supplier: 'Bacama Coffee & More', total: 3200000, status: 'Hoàn thành', items: [{ materialId: 'NVL0002', qty: 8, unitPrice: 400000, expiry: '2027-01-05' }] },
  { id: 'PN00003', date: '2026-11-03', supplier: 'Bao bì Lý Xanh', total: 1950000, status: 'Hoàn thành', items: [{ materialId: 'NVL0010', qty: 500, unitPrice: 3900, expiry: '' }] },
  { id: 'PN00004', date: '2026-11-02', supplier: 'Dalat Milk', total: 3840000, status: 'Hoàn thành', items: [{ materialId: 'NVL0005', qty: 24, unitPrice: 160000, expiry: '2027-06-30' }] },
]

export const REPORT_ROWS = [
  ['NVL0000001', 'Cà phê hạt Robusta', 'kg', 18.5, 40, 36.2, 22.3, 7400000],
  ['NVL0000002', 'Cà phê hạt Arabica', 'kg', 12, 25, 21.8, 15.2, 8000000],
  ['NVL0000003', 'Sữa tươi không đường', 'lít', 45, 120, 112, 53, 3840000],
  ['NVL0000004', 'Sữa đặc Ông Thọ', 'hộp', 30, 60, 54, 36, 1440000],
  ['NVL0000005', 'Đường cát trắng', 'kg', 20, 50, 44.5, 25.5, 1100000],
  ['NVL0000006', 'Siro Monin Caramel', 'chai', 6, 12, 10, 8, 2820000],
  ['NVL0000007', 'Bột cacao nguyên chất', 'kg', 4.5, 10, 8.6, 5.9, 2100000],
  ['NVL0000008', 'Trà đen Cao Nguyên Xanh', 'kg', 8, 15, 13.5, 9.5, 2475000],
  ['NVL0000009', 'Ly nhựa 16oz', 'cái', 1200, 3000, 2850, 1350, 1950000],
  ['NVL0000010', 'Bột kem béo thực vật', 'kg', 5, 10, 9.2, 5.8, 980000],
  ['NVL0000011', 'Trà ô long', 'kg', 3, 6, 5.1, 3.9, 1000000],
  ['NVL0000012', 'Đào ngâm', 'hộp', 10, 20, 18, 12, 600000],
  ['NVL0000013', 'Bột matcha', 'kg', 2, 5, 4.2, 2.8, 1050000],
  ['NVL0000014', 'Kem tươi', 'hộp', 8, 16, 15, 9, 600000],
]
