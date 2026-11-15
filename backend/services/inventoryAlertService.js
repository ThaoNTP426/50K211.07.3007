
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const { poolPromise } = require('../config/database');
const { buildAlertList } = require('../utils/inventoryAlerts');

// ==========================================
// 1. ĐƯỜNG DẪN LƯU TRẠNG THÁI CẢNH BÁO
// ==========================================

const STATE_FILE = path.join(
    __dirname,
    '..',
    'data',
    'inventoryAlertState.json'
);

// Đọc trạng thái cảnh báo đã gửi trước đó.
function readAlertState() {
    if (!fs.existsSync(STATE_FILE)) {
        return { activeAlerts: [] };
    }

    const data = fs.readFileSync(STATE_FILE, 'utf8');
    const state = JSON.parse(data);

    return {
        activeAlerts: Array.isArray(state.activeAlerts)
            ? state.activeAlerts
            : []
    };
}

// Lưu trạng thái cảnh báo.
function saveAlertState(activeAlerts) {
    const folder = path.dirname(STATE_FILE);

    if (!fs.existsSync(folder)) {
        fs.mkdirSync(folder, { recursive: true });
    }

    const data = JSON.stringify(
        { activeAlerts },
        null,
        4
    );

    const tempFile = STATE_FILE + '.tmp';

    fs.writeFileSync(tempFile, data, 'utf8');
    fs.renameSync(tempFile, STATE_FILE);
}

// ==========================================
// 2. LẤY CẢNH BÁO SẮP HẾT HÀNG
// ==========================================

async function getLowStockAlerts(pool) {
    const result = await pool.request().query(`
        SELECT
            maNVL,
            tenNVL,
            donViTinh,
            tonHienTai,
            mucTonToiThieu
        FROM NGUYENVATLIEU
        WHERE trangThaiXoa = 0
          AND tonHienTai <= mucTonToiThieu
          AND tonHienTai > 0
        ORDER BY tenNVL;
    `);

    return result.recordset;
}

async function getOutOfStockAlerts(pool) {
    const result = await pool.request().query(`
        SELECT maNVL, tenNVL, donViTinh, tonHienTai, mucTonToiThieu
        FROM NGUYENVATLIEU
        WHERE trangThaiXoa = 0 AND tonHienTai <= 0
        ORDER BY tenNVL;
    `);
    return result.recordset;
}

// ==========================================
// 3. LẤY CẢNH BÁO SẮP HẾT HẠN
// ==========================================

async function getExpiryAlerts(pool) {
    const result = await pool.request().query(`
        SELECT
            nvl.maNVL,
            nvl.tenNVL,
            nvl.donViTinh,
            ct.soLuongConLai,
            ct.hanSuDung,
            pn.maPhieuNhap,
            DATEDIFF(
                DAY,
                CONVERT(date, GETDATE()),
                ct.hanSuDung
            ) AS soNgayConLai
        FROM CHITIETPHIEUNHAP ct
        INNER JOIN PHIEUNHAPKHO pn
            ON ct.maPhieuNhap = pn.maPhieuNhap
        INNER JOIN NGUYENVATLIEU nvl
            ON ct.maNVL = nvl.maNVL
        WHERE nvl.trangThaiXoa = 0
          AND pn.trangThaiXoa = 0
          AND ct.soLuongConLai > 0
          AND ct.hanSuDung IS NOT NULL
          AND DATEDIFF(
                DAY,
                CONVERT(date, GETDATE()),
                ct.hanSuDung
              ) <= 7
        ORDER BY ct.hanSuDung ASC, nvl.tenNVL;
    `);

    return result.recordset;
}

// ==========================================
// 4. LẤY CẢNH BÁO TỒN KHO LÂU NGÀY
// ==========================================

async function getLongStockAlerts(pool) {
    const result = await pool.request().query(`
        SELECT
            nvl.maNVL,
            nvl.tenNVL,
            nvl.donViTinh,
            nvl.tonHienTai,
            ls.lanBienDongGanNhat
        FROM NGUYENVATLIEU nvl

        OUTER APPLY (
            SELECT
                MAX(l.thoiGian) AS lanBienDongGanNhat
            FROM LICHSUTONKHO l
            WHERE l.maNVL = nvl.maNVL
              AND l.trangThai = N'Hợp lệ'
              AND l.soLuongThayDoi <> 0
              AND l.thoiGianXoa IS NULL

        ) ls

        OUTER APPLY (
            SELECT
                MAX(pn.ngayNhap) AS lanNhapGanNhat
            FROM CHITIETPHIEUNHAP ct
            INNER JOIN PHIEUNHAPKHO pn
                ON ct.maPhieuNhap = pn.maPhieuNhap
            WHERE ct.maNVL = nvl.maNVL
              AND pn.trangThaiXoa = 0
        ) nhap

        WHERE nvl.trangThaiXoa = 0
          AND nvl.tonHienTai > 0
          AND COALESCE(
                ls.lanBienDongGanNhat,
                nhap.lanNhapGanNhat
              ) IS NOT NULL
          AND COALESCE(
                ls.lanBienDongGanNhat,
                nhap.lanNhapGanNhat
              ) < DATEADD(DAY, -30, GETDATE())

        ORDER BY nvl.tenNVL;
    `);

    return result.recordset;
}

// ==========================================
// 5. HÀM HỖ TRỢ HIỂN THỊ EMAIL
// ==========================================

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatNumber(value) {
    return Number(value || 0).toLocaleString('vi-VN');
}

function formatDate(value) {
    if (!value) return 'Chưa ghi nhận';

    const date = value instanceof Date
        ? value
        : new Date(value);

    if (Number.isNaN(date.getTime())) {
        return String(value);
    }

    return new Intl.DateTimeFormat('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    }).format(date);
}

function getVietnamDate() {
    return new Intl.DateTimeFormat('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    }).format(new Date());
}

// ==========================================
// 6. TẠO NỘI DUNG EMAIL
// ==========================================

function createEmailHtml(lowStock, outOfStock, expiry, longStock) {
    let html = `
        <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
            <h2 style="color: #8b5e3c;">
                ĐỢI COFFEE - CẢNH BÁO TỒN KHO
            </h2>

            <p>Thời điểm kiểm tra: <strong>${getVietnamDate()}</strong></p>

            <p>
                Hệ thống vừa phát hiện các cảnh báo tồn kho mới cần chủ quán
                kiểm tra và xử lý:
            </p>
    `;

    if (lowStock.length > 0) {
        html += `
            <h3 style="color: #d97706;">
                1. Nguyên vật liệu sắp hết hàng (${lowStock.length})
            </h3>

            <table border="1" cellpadding="8" cellspacing="0"
                style="border-collapse: collapse; width: 100%;">
                <tr style="background-color: #f3f4f6;">
                    <th>Mã NVL</th>
                    <th>Tên nguyên vật liệu</th>
                    <th>Tồn hiện tại</th>
                    <th>Mức tồn tối thiểu</th>
                </tr>
        `;

        for (const item of lowStock) {
            html += `
                <tr>
                    <td>${escapeHtml(item.maNVL)}</td>
                    <td>${escapeHtml(item.tenNVL)}</td>
                    <td>${formatNumber(item.tonHienTai)} ${escapeHtml(item.donViTinh)}</td>
                    <td>${formatNumber(item.mucTonToiThieu)} ${escapeHtml(item.donViTinh)}</td>
                </tr>
            `;
        }

        html += '</table>';
    }

    if (outOfStock.length > 0) {
        html += `<h3 style="color:#b91c1c">Out of stock (${outOfStock.length})</h3><ul>`;
        for (const item of outOfStock) {
            html += `<li>${escapeHtml(item.maNVL)} — ${escapeHtml(item.tenNVL)}: ${formatNumber(item.tonHienTai)} ${escapeHtml(item.donViTinh)}</li>`;
        }
        html += '</ul>';
    }

    if (expiry.length > 0) {
        html += `
            <h3 style="color: #dc2626;">
                2. Nguyên vật liệu sắp hết hạn (${expiry.length})
            </h3>

            <table border="1" cellpadding="8" cellspacing="0"
                style="border-collapse: collapse; width: 100%;">
                <tr style="background-color: #f3f4f6;">
                    <th>Mã NVL</th>
                    <th>Tên nguyên vật liệu</th>
                    <th>Mã phiếu nhập</th>
                    <th>Số lượng còn lại</th>
                    <th>Hạn sử dụng</th>
                    <th>Số ngày còn lại</th>
                </tr>
        `;

        for (const item of expiry) {
            html += `
                <tr>
                    <td>${escapeHtml(item.maNVL)}</td>
                    <td>${escapeHtml(item.tenNVL)}</td>
                    <td>${escapeHtml(item.maPhieuNhap)}</td>
                    <td>${formatNumber(item.soLuongConLai)} ${escapeHtml(item.donViTinh)}</td>
                    <td>${formatDate(item.hanSuDung)}</td>
                    <td>${formatNumber(item.soNgayConLai)} ngày</td>
                </tr>
            `;
        }

        html += '</table>';
    }

    if (longStock.length > 0) {
        html += `
            <h3 style="color: #2563eb;">
                3. Nguyên vật liệu tồn kho lâu ngày (${longStock.length})
            </h3>

            <table border="1" cellpadding="8" cellspacing="0"
                style="border-collapse: collapse; width: 100%;">
                <tr style="background-color: #f3f4f6;">
                    <th>Mã NVL</th>
                    <th>Tên nguyên vật liệu</th>
                    <th>Tồn hiện tại</th>
                    <th>Lần biến động gần nhất</th>
                </tr>
        `;

        for (const item of longStock) {
            html += `
                <tr>
                    <td>${escapeHtml(item.maNVL)}</td>
                    <td>${escapeHtml(item.tenNVL)}</td>
                    <td>${formatNumber(item.tonHienTai)} ${escapeHtml(item.donViTinh)}</td>
                    <td>${formatDate(item.lanBienDongGanNhat)}</td>
                </tr>
            `;
        }

        html += '</table>';
    }

    html += `
            <p style="margin-top: 24px;">
                Vui lòng kiểm tra và xử lý các nguyên vật liệu được liệt kê
                để đảm bảo hoạt động của quán.
            </p>

            <hr />

            <p style="font-size: 12px; color: #777;">
                Đây là email tự động từ Hệ thống Quản lý Kho Nguyên vật liệu
                Đợi Coffee. Vui lòng không trả lời email này.
            </p>
        </div>
    `;

    return `<!doctype html>
<html lang="vi">
<head><meta charset="UTF-8"></head>
<body>${html}</body>
</html>`;
}

function htmlToText(html) {
    return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/t[dh]>/gi, ' | ')
        .replace(/<\/(?:h[1-6]|p|tr|li|div|table)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

// ==========================================
// 7. TẠO DANH SÁCH CẢNH BÁO CÓ MÃ ĐỊNH DANH
// ==========================================

// ==========================================
// 8. GỬI EMAIL CẢNH BÁO MỚI
// ==========================================

async function sendInventoryAlert() {
    const pool = await poolPromise;

    const lowStock = await getLowStockAlerts(pool);
    const outOfStock = await getOutOfStockAlerts(pool);
    const expiry = await getExpiryAlerts(pool);
    const longStock = await getLongStockAlerts(pool);

    const currentAlerts = buildAlertList(
        lowStock,
        outOfStock,
        expiry,
        longStock
    );

    const previousState = readAlertState();

    const previousKeys = new Set(
        previousState.activeAlerts
    );

    // Chỉ lấy những cảnh báo chưa từng được gửi
    // trong đợt cảnh báo hiện tại.
    const newAlerts = currentAlerts.filter(
        alert => !previousKeys.has(alert.key)
    );

    const newLowStock = newAlerts
        .filter(alert => alert.type === 'lowStock')
        .map(alert => alert.item);

    const newOutOfStock = newAlerts
        .filter(alert => alert.type === 'outOfStock')
        .map(alert => alert.item);

    const newExpiry = newAlerts
        .filter(alert => alert.type === 'expiry')
        .map(alert => alert.item);

    const newLongStock = newAlerts
        .filter(alert => alert.type === 'longStock')
        .map(alert => alert.item);

    console.log('================================');
    console.log('KIỂM TRA CẢNH BÁO TỒN KHO');
    console.log('Tổng cảnh báo đang tồn tại:', currentAlerts.length);
    console.log('Cảnh báo mới:', newAlerts.length);
    console.log('Sắp hết hàng mới:', newLowStock.length);
    console.log('Sắp hết hạn mới:', newExpiry.length);
    console.log('Tồn kho lâu ngày mới:', newLongStock.length);
    console.log('================================');

    // Không có cảnh báo mới: cập nhật trạng thái để
    // ghi nhận các cảnh báo đã được giải quyết.
    if (newAlerts.length === 0) {
        saveAlertState(
            currentAlerts.map(alert => alert.key)
        );

        console.log('Không có cảnh báo mới. Không gửi email.');

        return {
            success: true,
            sent: false,
            totalAlerts: currentAlerts.length,
            newAlerts: 0,
            message: 'Không có cảnh báo mới.'
        };
    }

    const emailUser = process.env.EMAIL_USER;
    const emailPass = process.env.EMAIL_PASS;
    const emailTo = process.env.EMAIL_TO;

    if (!emailUser || !emailPass || !emailTo) {
        throw new Error(
            'Thiếu EMAIL_USER, EMAIL_PASS hoặc EMAIL_TO trong file .env!'
        );
    }

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: emailUser,
            pass: emailPass
        }
    });

    const html = createEmailHtml(
        newLowStock,
        newOutOfStock,
        newExpiry,
        newLongStock
    );
    const text = htmlToText(html);

    const info = await transporter.sendMail({
        from: `"Đợi Coffee - Cảnh báo kho" <${emailUser}>`,
        to: emailTo,
        subject: `[Đợi Coffee] Phát hiện ${newAlerts.length} cảnh báo tồn kho mới`,
        text,
        html,
        textEncoding: 'quoted-printable'
    });

    // Chỉ lưu trạng thái sau khi gửi email thành công.
    // Nếu gửi thất bại, lần kiểm tra sau sẽ thử gửi lại.
    saveAlertState(
        currentAlerts.map(alert => alert.key)
    );

    console.log('Đã gửi email cảnh báo mới thành công!');
    console.log('Message ID:', info.messageId);

    return {
        success: true,
        sent: true,
        totalAlerts: currentAlerts.length,
        newAlerts: newAlerts.length,
        messageId: info.messageId
    };
}

module.exports = {
    sendInventoryAlert,
    getLowStockAlerts,
    getOutOfStockAlerts,
    getExpiryAlerts,
    getLongStockAlerts,
    createEmailHtml,
    htmlToText
};
