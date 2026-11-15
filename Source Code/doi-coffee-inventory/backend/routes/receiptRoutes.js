
const express = require('express');
const router = express.Router();
const sql = require('mssql/msnodesqlv8');
const { poolPromise } = require('../config/database');
const { insertInventoryHistory } = require('../utils/inventoryHistoryInstrumentation');

// Kiểm tra ngày theo định dạng YYYY-MM-DD
function isValidDate(dateString) {
    if (typeof dateString !== 'string') return false;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        return false;
    }

    const date = new Date(dateString + 'T00:00:00Z');

    return !isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === dateString;
}

// API: Tạo phiếu nhập kho
router.post('/', async (req, res) => {
    const {
        maNCC,
        ngayNhap,
        ghiChu,
        chiTiet
    } = req.body || {};

    // 1. Kiểm tra thông tin bắt buộc
    if (
        !maNCC ||
        !ngayNhap ||
        !Array.isArray(chiTiet) ||
        chiTiet.length === 0
    ) {
        return res.status(400).json({
            success: false,
            message: 'Vui lòng nhập đầy đủ thông tin phiếu nhập!'
        });
    }

    // 2. Kiểm tra mã nhà cung cấp
    if (
        typeof maNCC !== 'string' ||
        !/^NCC\d{4}$/.test(maNCC.trim())
    ) {
        return res.status(400).json({
            success: false,
            message: 'Mã nhà cung cấp không hợp lệ!'
        });
    }

    const maNCCChuan = maNCC.trim();

    // 3. Kiểm tra ngày nhập
    if (!isValidDate(ngayNhap)) {
        return res.status(400).json({
            success: false,
            message: 'Ngày nhập không hợp lệ!'
        });
    }

    // 4. Kiểm tra ghi chú
    if (
        ghiChu !== undefined &&
        ghiChu !== null &&
        (
            typeof ghiChu !== 'string' ||
            ghiChu.length > 300
        )
    ) {
        return res.status(400).json({
            success: false,
            message: 'Ghi chú không được vượt quá 300 ký tự!'
        });
    }

    // 5. Kiểm tra chi tiết phiếu nhập
    for (let i = 0; i < chiTiet.length; i++) {
        const item = chiTiet[i];

        if (
            !item ||
            typeof item !== 'object' ||
            Array.isArray(item)
        ) {
            return res.status(400).json({
                success: false,
                message: `Chi tiết thứ ${i + 1} không hợp lệ!`
            });
        }

        const { maNVL, soLuong, donGia, hanSuDung } = item;

        // Kiểm tra mã nguyên vật liệu
        if (
            typeof maNVL !== 'string' ||
            !/^NVL\d{4}$/.test(maNVL.trim())
        ) {
            return res.status(400).json({
                success: false,
                message: `Mã nguyên vật liệu tại dòng ${i + 1} không hợp lệ!`
            });
        }

        // Kiểm tra số lượng
        const soLuongNumber = Number(soLuong);

        if (
            !Number.isFinite(soLuongNumber) ||
            soLuongNumber <= 0 ||
            soLuongNumber > 999999.99
        ) {
            return res.status(400).json({
                success: false,
                message: `Số lượng tại dòng ${i + 1} phải lớn hơn 0 và không vượt quá 999999.99!`
            });
        }

        // Kiểm tra đơn giá
        const donGiaNumber = Number(donGia);

        if (
            !Number.isFinite(donGiaNumber) ||
            donGiaNumber < 0 ||
            donGiaNumber > 9999999.99
        ) {
            return res.status(400).json({
                success: false,
                message: `Đơn giá tại dòng ${i + 1} không hợp lệ!`
            });
        }

        // Kiểm tra hạn sử dụng
        if (
            hanSuDung !== undefined &&
            hanSuDung !== null &&
            hanSuDung !== '' &&
            !isValidDate(hanSuDung)
        ) {
            return res.status(400).json({
                success: false,
                message: `Hạn sử dụng tại dòng ${i + 1} không hợp lệ!`
            });
        }

        // Kiểm tra giá trị tiền từng dòng
        const thanhTien = Math.round(
            soLuongNumber * donGiaNumber * 100
        ) / 100;

        if (
            !Number.isFinite(thanhTien) ||
            thanhTien < 0 ||
            thanhTien > 999999999.99
        ) {
            return res.status(400).json({
                success: false,
                message: `Thành tiền tại dòng ${i + 1} vượt quá giới hạn!`
            });
        }
    }

    // 6. Tính tổng tiền phiếu nhập
    const danhSachThanhTien = chiTiet.map(item => {
        const thanhTien = Number(item.soLuong) * Number(item.donGia);

        return Math.round(thanhTien * 100) / 100;
    });

    const tongTienLamTron = Math.round(
        danhSachThanhTien.reduce((tong, tien) => tong + tien, 0) * 100
    ) / 100;

    if (
        !Number.isFinite(tongTienLamTron) ||
        tongTienLamTron > 999999999.99
    ) {
        return res.status(400).json({
            success: false,
            message: 'Tổng tiền phiếu nhập vượt quá giới hạn!'
        });
    }

    // 7. Bắt đầu giao dịch SQL
    let transaction;

    try {
        const pool = await poolPromise;

        transaction = new sql.Transaction(pool);

        await transaction.begin();

        // 8. Kiểm tra nhà cung cấp có tồn tại không
        const requestNCC = new sql.Request(transaction);

        requestNCC.input('maNCC', sql.Char(7), maNCCChuan);

        const resultNCC = await requestNCC.query(`
            SELECT maNCC
            FROM NHACUNGCAP
            WHERE maNCC = @maNCC
        `);

        if (resultNCC.recordset.length === 0) {
            const error = new Error('Ma nha cung cap khong ton tai!');
            error.statusCode = 400;
            throw error;
        }

        // 9. Tự động tạo mã phiếu nhập
        // Khóa dữ liệu để hạn chế trùng mã khi nhiều yêu cầu đồng thời
        const requestMa = new sql.Request(transaction);

        const resultMa = await requestMa.query(`
            SELECT
                ISNULL(
                    MAX(TRY_CONVERT(INT, SUBSTRING(maPhieuNhap, 3, 5))),
                    0
                ) + 1 AS soMa
            FROM PHIEUNHAPKHO WITH (UPDLOCK, HOLDLOCK)
        `);

        const soMa = resultMa.recordset[0].soMa;

        if (soMa > 99999) {
            const error = new Error(
                'Da vuot qua so luong ma phieu nhap cho phep!'
            );

            error.statusCode = 400;
            throw error;
        }

        const maPhieuNhap = 'PN' + String(soMa).padStart(5, '0');

        // 10. Tạo phiếu nhập kho
        const requestPhieu = new sql.Request(transaction);

        requestPhieu.input(
            'maPhieuNhap',
            sql.Char(7),
            maPhieuNhap
        );

        requestPhieu.input(
            'maNCC',
            sql.Char(7),
            maNCCChuan
        );

        requestPhieu.input(
            'ngayNhap',
            sql.Date,
            ngayNhap
        );

        requestPhieu.input(
            'tongTien',
            sql.Decimal(11, 2),
            tongTienLamTron
        );

        requestPhieu.input(
            'ghiChu',
            sql.NVarChar(300),
            ghiChu || null
        );

        await requestPhieu.query(`
            INSERT INTO PHIEUNHAPKHO
                (maPhieuNhap, maNCC, ngayNhap, tongTien, ghiChu)
            VALUES
                (@maPhieuNhap, @maNCC, @ngayNhap, @tongTien, @ghiChu)
        `);

        // 11. Thêm chi tiết phiếu nhập và cập nhật tồn kho
        for (const item of chiTiet) {
            const maNVL = item.maNVL.trim();
            const soLuong = Number(item.soLuong);
            const donGia = Number(item.donGia);

            const hanSuDung =
                item.hanSuDung === undefined ||
                item.hanSuDung === null ||
                item.hanSuDung === ''
                    ? null
                    : item.hanSuDung;

            // Kiểm tra nguyên vật liệu có tồn tại không
            const requestCheckNVL = new sql.Request(transaction);

            requestCheckNVL.input(
                'maNVL',
                sql.Char(7),
                maNVL
            );

            const resultNVL = await requestCheckNVL.query(`
                SELECT maNVL
                FROM NGUYENVATLIEU
                WHERE maNVL = @maNVL
                  AND trangThaiXoa = 0
            `);

            if (resultNVL.recordset.length === 0) {
                const error = new Error(
                    `Ma nguyen vat lieu ${maNVL} khong ton tai!`
                );

                error.statusCode = 400;
                throw error;
            }

            // Thêm chi tiết phiếu nhập
            // LƯU Ý: Không INSERT thanhTien vì đây là computed column.
            const requestChiTiet = new sql.Request(transaction);

            requestChiTiet.input(
                'maPhieuNhap',
                sql.Char(7),
                maPhieuNhap
            );

            requestChiTiet.input(
                'maNVL',
                sql.Char(7),
                maNVL
            );

            requestChiTiet.input(
                'soLuong',
                sql.Decimal(14, 4),
                soLuong
            );

            requestChiTiet.input(
                'donGia',
                sql.Decimal(9, 2),
                donGia
            );

            requestChiTiet.input(
                'hanSuDung',
                sql.Date,
                hanSuDung
            );

            await requestChiTiet.query(`
                INSERT INTO CHITIETPHIEUNHAP
                    (
                        maPhieuNhap,
                        maNVL,
                        soLuong,
                        soLuongConLai,
                        donGia,
                        hanSuDung
                    )
                VALUES
                    (
                        @maPhieuNhap,
                        @maNVL,
                        @soLuong,
                        @soLuong,
                        @donGia,
                        @hanSuDung
                    )
            `);

        }

        // Cộng tồn và ghi lịch sử một lần cho mỗi NVL; các dòng chi tiết vẫn giữ nguyên.
        const tongNhapTheoNVL = tongHopSoLuongTheoNVLDonVi(chiTiet);

        for (const [maNVL, soLuongDonVi] of tongNhapTheoNVL) {
            const soLuong = Number(soLuongDonVi) / 10000;
            const requestTonKho = new sql.Request(transaction);

            requestTonKho.input('maNVL', sql.Char(7), maNVL);
            requestTonKho.input('soLuong', sql.Decimal(14, 4), soLuong);

            const resultTonKho = await requestTonKho.query(`
                UPDATE NGUYENVATLIEU
                SET tonHienTai = tonHienTai + @soLuong
                OUTPUT
                    deleted.tonHienTai AS tonTruoc,
                    inserted.tonHienTai AS tonSau
                WHERE maNVL = @maNVL
            `);

            if (!resultTonKho.recordset?.length) {
                throw new Error(`Khong the cap nhat ton kho cho ${maNVL}!`);
            }

            await ghiLichSuTonKho(transaction, {
                maNVL,
                loaiBienDong: 'Nhập kho',
                nguonTacDong: 'Phiếu nhập kho',
                soLuongThayDoi: soLuong,
                tonTruoc: Number(resultTonKho.recordset[0].tonTruoc),
                tonSau: Number(resultTonKho.recordset[0].tonSau),
                maThamChieu: maPhieuNhap,
                ghiChu,
                api: `${req.method} ${req.originalUrl}`,
                operation: 'receipt.create'
            });
        }

        // 12. Lấy thông tin chi tiết sau khi SQL Server tự tính thanhTien
        const requestKetQua = new sql.Request(transaction);

        requestKetQua.input(
            'maPhieuNhap',
            sql.Char(7),
            maPhieuNhap
        );

        const resultChiTiet = await requestKetQua.query(`
            SELECT
                maPhieuNhap,
                maNVL,
                soLuong,
                soLuongConLai,
                donGia,
                hanSuDung,
                thanhTien
            FROM CHITIETPHIEUNHAP
            WHERE maPhieuNhap = @maPhieuNhap
        `);

        // 13. Hoàn tất giao dịch
        await transaction.commit();

        // 14. Trả kết quả về Postman
        return res.status(201).json({
            success: true,
            message: 'Tạo phiếu nhập kho thành công!',
            data: {
                maPhieuNhap,
                maNCC: maNCCChuan,
                ngayNhap,
                tongTien: tongTienLamTron,
                ghiChu: ghiChu || null,
                chiTiet: resultChiTiet.recordset
            }
        });

    } catch (error) {
        // Nếu có lỗi, hoàn tác toàn bộ giao dịch
        if (transaction) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {
                console.log(
                    'Loi rollback:',
                    rollbackError.message
                );
            }
        }

        console.log('Loi tao phieu nhap:', error.message);

        return res.status(error.statusCode || 500).json({
            success: false,
            message: 'Không thể tạo phiếu nhập kho!',
            error: error.message
        });
    }
});


// API: Lấy danh sách phiếu nhập kho
router.get('/', async (req, res) => {
    try {
        const pool = await poolPromise;


const result = await pool.request().query(`
    SELECT
        p.maPhieuNhap,
        p.maNCC,
        n.tenNCC,
        p.ngayNhap,
        p.tongTien,
        p.ghiChu
    FROM PHIEUNHAPKHO p
    INNER JOIN NHACUNGCAP n
        ON p.maNCC = n.maNCC
    WHERE p.trangThaiXoa = 0
    ORDER BY p.ngayNhap DESC, p.maPhieuNhap DESC
    `);

        return res.status(200).json({
            success: true,
            message: 'Lấy danh sách phiếu nhập thành công!',
            total: result.recordset.length,
            data: result.recordset
        });

    } catch (error) {
        console.log('Loi lay danh sach phieu nhap:', error.message);

        return res.status(500).json({
            success: false,
            message: 'Không thể lấy danh sách phiếu nhập!',
            error: error.message
        });
    }
});


 // API: Lấy chi tiết phiếu nhập theo mã phiếu
router.get('/:maPhieuNhap', async (req, res) => {
    try {
        const { maPhieuNhap } = req.params;

        // Kiểm tra mã phiếu
        if (!/^PN\d{5}$/.test(maPhieuNhap)) {
            return res.status(400).json({
                success: false,
                message: 'Mã phiếu nhập không hợp lệ!'
            });
        }

        const pool = await poolPromise;

        // Lấy thông tin phiếu nhập và nhà cung cấp
        const requestPhieu = pool.request();

        requestPhieu.input(
            'maPhieuNhap',
            sql.Char(7),
            maPhieuNhap
        );

        const resultPhieu = await requestPhieu.query(`
            SELECT
                p.maPhieuNhap,
                p.maNCC,
                n.tenNCC,
                p.ngayNhap,
                p.tongTien,
                p.ghiChu
            FROM PHIEUNHAPKHO p
            INNER JOIN NHACUNGCAP n
                ON p.maNCC = n.maNCC
            WHERE p.maPhieuNhap = @maPhieuNhap
              AND p.trangThaiXoa = 0
        `);

        // Không tìm thấy phiếu nhập
        if (resultPhieu.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy phiếu nhập kho!'
            });
        }

        // Lấy danh sách nguyên vật liệu trong phiếu
        const requestChiTiet = pool.request();

        requestChiTiet.input(
            'maPhieuNhap',
            sql.Char(7),
            maPhieuNhap
        );

        const resultChiTiet = await requestChiTiet.query(`
            SELECT
                ct.maPhieuNhap,
                ct.maNVL,
                nvl.tenNVL,
                ct.soLuong,
                ct.soLuongConLai,
                ct.donGia,
                ct.hanSuDung,
                ct.thanhTien
            FROM CHITIETPHIEUNHAP ct
            INNER JOIN NGUYENVATLIEU nvl
                ON ct.maNVL = nvl.maNVL
            WHERE ct.maPhieuNhap = @maPhieuNhap
        `);

        return res.status(200).json({
            success: true,
            message: 'Lấy chi tiết phiếu nhập thành công!',
            data: {
                ...resultPhieu.recordset[0],
                chiTiet: resultChiTiet.recordset
            }
        });

    } catch (error) {
        console.log('Loi lay chi tiet phieu nhap:', error.message);

        return res.status(500).json({
            success: false,
            message: 'Không thể lấy chi tiết phiếu nhập!',
            error: error.message
        });
    }
});


// =============================================
// HÀM KIỂM TRA ĐIỀU KIỆN SỬA / XÓA PHIẾU
// =============================================

async function kiemTraPhieuChuaSuDung(transaction, maPhieuNhap) {
    const request = new sql.Request(transaction);

    request.input('maPhieuNhap', sql.Char(7), maPhieuNhap);

    const result = await request.query(`
        SELECT maNVL, soLuong, soLuongConLai
        FROM CHITIETPHIEUNHAP WITH (UPDLOCK, HOLDLOCK)
        WHERE maPhieuNhap = @maPhieuNhap
    `);

    if (result.recordset.length === 0) {
        throw new Error('Phieu nhap khong co chi tiet!');
    }

    // Nếu số lượng còn lại nhỏ hơn số lượng nhập
    // nghĩa là nguyên vật liệu đã được sử dụng.
    const daSuDung = result.recordset.some(item =>
        Number(item.soLuongConLai) < Number(item.soLuong)
    );

    if (daSuDung) {
        throw new Error(
            'Không thể xóa phiếu nhập kho!'
        );
    }

    return result.recordset;
}


// =============================================
// HÀM KIỂM TRA TỒN KHO VÀ TRỪ SỐ LƯỢNG
// =============================================

async function ghiLichSuTonKho(transaction, movement) {
    const request = new sql.Request(transaction)
        .input('maNVL', sql.Char(7), movement.maNVL)
        .input('loaiBienDong', sql.NVarChar(30), movement.loaiBienDong)
        .input('nguonTacDong', sql.NVarChar(50), movement.nguonTacDong)
        .input(
            'soLuongThayDoi',
            sql.Decimal(14, 4),
            movement.soLuongThayDoi
        )
        .input('tonTruoc', sql.Decimal(14, 4), movement.tonTruoc)
        .input('tonSau', sql.Decimal(14, 4), movement.tonSau)
        .input('maThamChieu', sql.VarChar(20), movement.maThamChieu)
        .input('ghiChu', sql.NVarChar(500), movement.ghiChu || null)
        .input('maLichSuGoc', sql.BigInt, movement.maLichSuGoc ?? null);
    return insertInventoryHistory(request, `
            INSERT INTO LICHSUTONKHO (
                maNVL,
                loaiBienDong,
                nguonTacDong,
                soLuongThayDoi,
                tonTruoc,
                tonSau,
                maThamChieu,
                ghiChu,
                maLichSuGoc
            )
            VALUES (
                @maNVL,
                @loaiBienDong,
                @nguonTacDong,
                @soLuongThayDoi,
                @tonTruoc,
                @tonSau,
                @maThamChieu,
                @ghiChu,
                @maLichSuGoc
            );
        `, {
        api: movement.api,
        operation: movement.operation,
        maPhieu: movement.maThamChieu,
        maThamChieu: movement.maThamChieu,
        maLichSuGoc: movement.maLichSuGoc ?? null,
        maNVL: movement.maNVL,
        loaiBienDong: movement.loaiBienDong,
        soLuongThayDoi: movement.soLuongThayDoi,
        tonTruoc: movement.tonTruoc,
        tonSau: movement.tonSau
    });
}

const tongHopSoLuongTheoNVL = (chiTiet) => {
    const totals = new Map();

    for (const item of chiTiet) {
        const maNVL = String(item.maNVL).trim();
        totals.set(
            maNVL,
            (totals.get(maNVL) || 0) + Number(item.soLuong)
        );
    }

    return totals;
};

// Chuyển số thập phân thành đơn vị 0.0001 bằng chuỗi/BigInt, tránh cộng Number.
const soLuongSangDonVi4 = (value) => {
    const match = String(value).trim().match(
        /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/
    );

    if (!match) {
        throw new Error('So luong khong hop le de tinh chinh xac!');
    }

    const sign = match[1] === '-' ? -1n : 1n;
    const integer = match[2] || '0';
    const fraction = match[3] || match[4] || '';
    const exponent = Number(match[5] || 0);
    const digits = BigInt(`${integer}${fraction}`);
    const scale = fraction.length - exponent;
    let units;

    if (scale <= 4) {
        units = digits * (10n ** BigInt(4 - scale));
    } else {
        const divisor = 10n ** BigInt(scale - 4);
        const quotient = digits / divisor;
        const remainder = digits % divisor;
        units = quotient + (remainder * 2n >= divisor ? 1n : 0n);
    }

    return sign * units;
};

const tongHopSoLuongTheoNVLDonVi = (chiTiet) => {
    const totals = new Map();

    for (const item of chiTiet) {
        const maNVL = String(item.maNVL).trim();
        totals.set(
            maNVL,
            (totals.get(maNVL) || 0n) + soLuongSangDonVi4(item.soLuong)
        );
    }

    return totals;
};

async function truTonKho(transaction, chiTiet, options = {}) {
    const totals = tongHopSoLuongTheoNVL(chiTiet);

    for (const [maNVL, soLuong] of totals) {
        const request = new sql.Request(transaction);

        request.input('maNVL', sql.Char(7), maNVL);
        request.input('soLuong', sql.Decimal(14, 4), soLuong);

        const result = await request.query(`
            UPDATE NGUYENVATLIEU
            SET tonHienTai = tonHienTai - @soLuong
            OUTPUT
                deleted.tonHienTai AS tonTruoc,
                inserted.tonHienTai AS tonSau
            WHERE maNVL = @maNVL
              AND tonHienTai >= @soLuong
        `);

        if (!result.recordset?.length) {
            throw new Error(
                'Ton kho khong du de hoan tac phieu nhap cua nguyen vat lieu ' +
                maNVL
            );
        }

        if (options.ghiLichSu) {
            await ghiLichSuTonKho(transaction, {
                maNVL,
                loaiBienDong: options.loaiBienDong,
                nguonTacDong: options.nguonTacDong,
                soLuongThayDoi: -soLuong,
                tonTruoc: Number(result.recordset[0].tonTruoc),
                tonSau: Number(result.recordset[0].tonSau),
                maThamChieu: options.maThamChieu,
                ghiChu: options.ghiChu,
                maLichSuGoc: options.maLichSuGocByMaterial?.get(maNVL) ?? null,
                api: options.api,
                operation: options.operation
            });
        }
    }
}


// =============================================
// API: SỬA PHIẾU NHẬP KHO
// PUT /api/receipts/:maPhieuNhap
// =============================================

router.put('/:maPhieuNhap', async (req, res) => {
    const { maPhieuNhap } = req.params;

    const {
        maNCC,
        ngayNhap,
        ghiChu,
        chiTiet
    } = req.body || {};

    // 1. Kiểm tra mã phiếu
    if (!/^PN\d{5}$/.test(maPhieuNhap)) {
        return res.status(400).json({
            success: false,
            message: 'Mã phiếu nhập không hợp lệ!'
        });
    }

    // 2. Kiểm tra thông tin bắt buộc
    if (
        !maNCC ||
        !ngayNhap ||
        !Array.isArray(chiTiet) ||
        chiTiet.length === 0
    ) {
        return res.status(400).json({
            success: false,
            message: 'Vui lòng nhập đầy đủ thông tin phiếu nhập!'
        });
    }

    // 3. Kiểm tra nhà cung cấp
    if (
        typeof maNCC !== 'string' ||
        !/^NCC\d{4}$/.test(maNCC.trim())
    ) {
        return res.status(400).json({
            success: false,
            message: 'Mã nhà cung cấp không hợp lệ!'
        });
    }

    // 4. Kiểm tra ngày nhập
    if (!isValidDate(ngayNhap)) {
        return res.status(400).json({
            success: false,
            message: 'Ngày nhập không hợp lệ!'
        });
    }

    // 5. Kiểm tra ghi chú
    if (
        ghiChu !== undefined &&
        ghiChu !== null &&
        (
            typeof ghiChu !== 'string' ||
            ghiChu.length > 300
        )
    ) {
        return res.status(400).json({
            success: false,
            message: 'Ghi chú không được vượt quá 300 ký tự!'
        });
    }

    // 6. Kiểm tra chi tiết phiếu
    for (let i = 0; i < chiTiet.length; i++) {
        const item = chiTiet[i];

        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            return res.status(400).json({
                success: false,
                message: `Chi tiết thứ ${i + 1} không hợp lệ!`
            });
        }

        if (
            typeof item.maNVL !== 'string' ||
            !/^NVL\d{4}$/.test(item.maNVL.trim())
        ) {
            return res.status(400).json({
                success: false,
                message: `Mã nguyên vật liệu tại dòng ${i + 1} không hợp lệ!`
            });
        }

        const soLuong = Number(item.soLuong);
        const donGia = Number(item.donGia);

        if (
            !Number.isFinite(soLuong) ||
            soLuong <= 0 ||
            soLuong > 999999.99
        ) {
            return res.status(400).json({
                success: false,
                message: `Số lượng tại dòng ${i + 1} không hợp lệ!`
            });
        }

        if (
            !Number.isFinite(donGia) ||
            donGia < 0 ||
            donGia > 9999999.99
        ) {
            return res.status(400).json({
                success: false,
                message: `Đơn giá tại dòng ${i + 1} không hợp lệ!`
            });
        }

        if (
            item.hanSuDung !== undefined &&
            item.hanSuDung !== null &&
            item.hanSuDung !== '' &&
            !isValidDate(item.hanSuDung)
        ) {
            return res.status(400).json({
                success: false,
                message: `Hạn sử dụng tại dòng ${i + 1} không hợp lệ!`
            });
        }

        const thanhTien = soLuong * donGia;

        if (
            !Number.isFinite(thanhTien) ||
            thanhTien > 999999999.99
        ) {
            return res.status(400).json({
                success: false,
                message: `Thanh tien tai dong ${i + 1} vuot qua gioi han!`
            });
        }
    }

    // 7. Tính tổng tiền
    const tongTien = Math.round(
        chiTiet.reduce(
            (tong, item) =>
                tong + Number(item.soLuong) * Number(item.donGia),
            0
        ) * 100
    ) / 100;

    if (
        !Number.isFinite(tongTien) ||
        tongTien > 999999999.99
    ) {
        return res.status(400).json({
            success: false,
            message: 'Tổng tiền phiếu nhập vượt quá giới hạn!'
        });
    }

    let transaction;

    try {
        const pool = await poolPromise;

        transaction = new sql.Transaction(pool);
        await transaction.begin();

        // 8. Kiểm tra phiếu còn hoạt động
        const requestPhieu = new sql.Request(transaction);

        requestPhieu.input(
            'maPhieuNhap',
            sql.Char(7),
            maPhieuNhap
        );

        const resultPhieu = await requestPhieu.query(`
            SELECT maPhieuNhap
            FROM PHIEUNHAPKHO WITH (UPDLOCK, HOLDLOCK)
            WHERE maPhieuNhap = @maPhieuNhap
              AND trangThaiXoa = 0
        `);

        if (resultPhieu.recordset.length === 0) {
            throw new Error('Khong tim thay phieu nhap dang hoat dong!');
        }

        // 9. Kiểm tra phiếu chưa sử dụng nguyên vật liệu
        const chiTietCu = await kiemTraPhieuChuaSuDung(
            transaction,
            maPhieuNhap
        );

        // 10. Kiểm tra nhà cung cấp
        const requestNCC = new sql.Request(transaction);

        requestNCC.input(
            'maNCC',
            sql.Char(7),
            maNCC.trim()
        );

        const resultNCC = await requestNCC.query(`
            SELECT maNCC
            FROM NHACUNGCAP
            WHERE maNCC = @maNCC
        `);

        if (resultNCC.recordset.length === 0) {
            throw new Error('Ma nha cung cap khong ton tai!');
        }

        // Ghi nhận lượng tồn ban đầu và tổng chi tiết cũ/mới để chỉ log phần chênh lệch ròng.
        const tongCu = tongHopSoLuongTheoNVLDonVi(chiTietCu);
        const tongMoi = tongHopSoLuongTheoNVLDonVi(chiTiet);
        const maNVLThayDoi = new Set([...tongCu.keys(), ...tongMoi.keys()]);
        const tonBanDau = new Map();

        for (const maNVL of maNVLThayDoi) {
            const requestTonBanDau = new sql.Request(transaction);
            requestTonBanDau.input('maNVL', sql.Char(7), maNVL);
            const resultTonBanDau = await requestTonBanDau.query(`
                SELECT tonHienTai
                FROM NGUYENVATLIEU WITH (UPDLOCK, HOLDLOCK)
                WHERE maNVL = @maNVL
            `);

            if (!resultTonBanDau.recordset?.length) {
                throw new Error(`Ma nguyen vat lieu ${maNVL} khong ton tai!`);
            }

            tonBanDau.set(maNVL, Number(resultTonBanDau.recordset[0].tonHienTai));
        }

        // 11. Hoàn lại số lượng phiếu cũ khỏi tồn kho
        await truTonKho(transaction, chiTietCu);

        // 12. Xóa chi tiết cũ để thay bằng chi tiết mới
        const requestXoaChiTiet = new sql.Request(transaction);

        requestXoaChiTiet.input(
            'maPhieuNhap',
            sql.Char(7),
            maPhieuNhap
        );

        await requestXoaChiTiet.query(`
            DELETE FROM CHITIETPHIEUNHAP
            WHERE maPhieuNhap = @maPhieuNhap
        `);

        // 13. Thêm chi tiết mới và cập nhật tồn kho
        for (const item of chiTiet) {
            const maNVL = item.maNVL.trim();
            const soLuong = Number(item.soLuong);
            const donGia = Number(item.donGia);

            const hanSuDung =
                item.hanSuDung === undefined ||
                item.hanSuDung === null ||
                item.hanSuDung === ''
                    ? null
                    : item.hanSuDung;

            // Kiểm tra nguyên vật liệu
            const requestCheck = new sql.Request(transaction);

            requestCheck.input('maNVL', sql.Char(7), maNVL);

            const resultNVL = await requestCheck.query(`
                SELECT maNVL
                FROM NGUYENVATLIEU
                WHERE maNVL = @maNVL
                  AND trangThaiXoa = 0
            `);

            if (resultNVL.recordset.length === 0) {
                throw new Error(
                    `Ma nguyen vat lieu ${maNVL} khong ton tai!`
                );
            }

            // Thêm chi tiết mới
            const requestCT = new sql.Request(transaction);

            requestCT.input(
                'maPhieuNhap',
                sql.Char(7),
                maPhieuNhap
            );

            requestCT.input('maNVL', sql.Char(7), maNVL);
            requestCT.input('soLuong', sql.Decimal(14, 4), soLuong);
            requestCT.input('donGia', sql.Decimal(9, 2), donGia);
            requestCT.input('hanSuDung', sql.Date, hanSuDung);

            await requestCT.query(`
                INSERT INTO CHITIETPHIEUNHAP
                    (
                        maPhieuNhap,
                        maNVL,
                        soLuong,
                        soLuongConLai,
                        donGia,
                        hanSuDung
                    )
                VALUES
                    (
                        @maPhieuNhap,
                        @maNVL,
                        @soLuong,
                        @soLuong,
                        @donGia,
                        @hanSuDung
                    )
            `);

            // Cộng số lượng mới vào tồn kho
            const requestTon = new sql.Request(transaction);

            requestTon.input('maNVL', sql.Char(7), maNVL);
            requestTon.input('soLuong', sql.Decimal(14, 4), soLuong);

            await requestTon.query(`
                UPDATE NGUYENVATLIEU
                SET tonHienTai = tonHienTai + @soLuong
                WHERE maNVL = @maNVL
            `);
        }

        // Ghi đúng một lịch sử cho mỗi NVL có chênh lệch ròng khác 0.
        for (const maNVL of maNVLThayDoi) {
            const chenhLechDonVi =
                (tongMoi.get(maNVL) || 0n) - (tongCu.get(maNVL) || 0n);

            if (chenhLechDonVi === 0n) continue;

            const soLuongThayDoi = Number(chenhLechDonVi) / 10000;

            const requestTonSau = new sql.Request(transaction);
            requestTonSau.input('maNVL', sql.Char(7), maNVL);
            const resultTonSau = await requestTonSau.query(`
                SELECT tonHienTai
                FROM NGUYENVATLIEU
                WHERE maNVL = @maNVL
            `);

            if (!resultTonSau.recordset?.length) {
                throw new Error(`Ma nguyen vat lieu ${maNVL} khong ton tai!`);
            }

            await ghiLichSuTonKho(transaction, {
                maNVL,
                loaiBienDong: soLuongThayDoi > 0 ? 'Nhập kho' : 'Điều chỉnh',
                nguonTacDong: 'Phiếu nhập kho',
                soLuongThayDoi,
                tonTruoc: tonBanDau.get(maNVL),
                tonSau: Number(resultTonSau.recordset[0].tonHienTai),
                maThamChieu: maPhieuNhap,
                ghiChu: `Chênh lệch khi sửa phiếu nhập${ghiChu ? `: ${ghiChu}` : ''}`,
                api: `${req.method} ${req.originalUrl}`,
                operation: 'receipt.update'
            });
        }

        // 14. Cập nhật thông tin phiếu
        const requestUpdate = new sql.Request(transaction);

        requestUpdate.input(
            'maPhieuNhap',
            sql.Char(7),
            maPhieuNhap
        );

        requestUpdate.input(
            'maNCC',
            sql.Char(7),
            maNCC.trim()
        );

        requestUpdate.input('ngayNhap', sql.Date, ngayNhap);

        requestUpdate.input(
            'tongTien',
            sql.Decimal(11, 2),
            tongTien
        );

        requestUpdate.input(
            'ghiChu',
            sql.NVarChar(300),
            ghiChu || null
        );

        await requestUpdate.query(`
            UPDATE PHIEUNHAPKHO
            SET
                maNCC = @maNCC,
                ngayNhap = @ngayNhap,
                tongTien = @tongTien,
                ghiChu = @ghiChu
            WHERE maPhieuNhap = @maPhieuNhap
              AND trangThaiXoa = 0
        `);

        await transaction.commit();

        return res.status(200).json({
            success: true,
            message: 'Cập nhật phiếu nhập kho thành công!',
            data: {
                maPhieuNhap,
                maNCC: maNCC.trim(),
                ngayNhap,
                tongTien,
                ghiChu: ghiChu || null
            }
        });

    } catch (error) {
        if (transaction) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {
                console.log('Loi rollback:', rollbackError.message);
            }
        }

        console.log('Loi sua phieu nhap:', error.message);

        const statusCode =
            error.message.includes('Khong tim thay') ||
            error.message.includes('khong ton tai')
                ? 404
                : error.message.includes('da duoc su dung') ||
                  error.message.includes('Ton kho khong du')
                    ? 400
                    : 500;

        return res.status(statusCode).json({
            success: false,
            message: error.message
        });
    }
});


// =============================================
// API: XÓA MỀM PHIẾU NHẬP KHO
// DELETE /api/receipts/:maPhieuNhap
// =============================================

router.delete('/:maPhieuNhap', async (req, res) => {
    const { maPhieuNhap } = req.params;

    if (!/^PN\d{5}$/.test(maPhieuNhap)) {
        return res.status(400).json({
            success: false,
            message: 'Mã phiếu nhập không hợp lệ!'
        });
    }

    let transaction;

    try {
        const pool = await poolPromise;

        transaction = new sql.Transaction(pool);
        await transaction.begin();

        // 1. Kiểm tra phiếu còn hoạt động
        const requestPhieu = new sql.Request(transaction);

        requestPhieu.input(
            'maPhieuNhap',
            sql.Char(7),
            maPhieuNhap
        );

        const resultPhieu = await requestPhieu.query(`
            SELECT maPhieuNhap
            FROM PHIEUNHAPKHO WITH (UPDLOCK, HOLDLOCK)
            WHERE maPhieuNhap = @maPhieuNhap
              AND trangThaiXoa = 0
        `);

        if (resultPhieu.recordset.length === 0) {
            throw new Error('Khong tim thay phieu nhap dang hoat dong!');
        }

        // 2. Kiểm tra phiếu chưa sử dụng nguyên vật liệu
        const chiTiet = await kiemTraPhieuChuaSuDung(
            transaction,
            maPhieuNhap
        );

        const sourceHistory = await new sql.Request(transaction)
            .input('maThamChieu', sql.VarChar(20), maPhieuNhap)
            .query(`
                SELECT maNVL, MAX(maLichSu) AS maLichSuGoc
                FROM dbo.LICHSUTONKHO WITH (UPDLOCK, HOLDLOCK)
                WHERE maThamChieu = @maThamChieu
                  AND nguonTacDong = N'Phiếu nhập kho'
                  AND loaiBienDong IN (N'Nhập kho', N'Điều chỉnh')
                  AND trangThai = N'Hợp lệ'
                  AND thoiGianXoa IS NULL
                GROUP BY maNVL;
            `);
        const maLichSuGocByMaterial = new Map(
            sourceHistory.recordset.map((row) => [
                String(row.maNVL).trim(),
                row.maLichSuGoc
            ])
        );
        for (const item of chiTiet) {
            if (!maLichSuGocByMaterial.has(String(item.maNVL).trim())) {
                throw new Error(`Không tìm thấy lịch sử nhập gốc của ${String(item.maNVL).trim()} trong phiếu ${maPhieuNhap}.`);
            }
        }

        // 3. Trừ số lượng phiếu khỏi tồn kho
        await truTonKho(transaction, chiTiet, {
            ghiLichSu: true,
            loaiBienDong: 'Đảo ngược',
            nguonTacDong: 'Hủy phiếu nhập',
            maThamChieu: maPhieuNhap,
            maLichSuGocByMaterial,
            ghiChu: 'Thu hồi tồn kho khi hủy phiếu nhập',
            api: `${req.method} ${req.originalUrl}`,
            operation: 'receipt.delete'
        });

        // 4. Xóa mềm phiếu nhập
        const requestXoa = new sql.Request(transaction);

        requestXoa.input(
            'maPhieuNhap',
            sql.Char(7),
            maPhieuNhap
        );

        await requestXoa.query(`
            UPDATE PHIEUNHAPKHO
            SET trangThaiXoa = 1
            WHERE maPhieuNhap = @maPhieuNhap
              AND trangThaiXoa = 0
        `);

        await transaction.commit();

        return res.status(200).json({
            success: true,
            message: 'Xóa phiếu nhập kho thành công!',
            data: {
                maPhieuNhap,
                trangThaiXoa: 1
            }
        });

    } catch (error) {
        if (transaction) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {
                console.log('Loi rollback:', rollbackError.message);
            }
        }

        console.log('Loi xoa phieu nhap:', error.message);

        const statusCode =
            error.message.includes('Khong tim thay')
                ? 404
                : error.message.includes('da duoc su dung') ||
                  error.message.includes('Ton kho khong du')
                    ? 400
                    : 500;

        return res.status(statusCode).json({
            success: false,
            message: error.message
        });
    }
});


module.exports = router;
