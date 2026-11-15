
const express = require('express');
const router = express.Router();

const sql = require('mssql/msnodesqlv8');
const { poolPromise } = require('../config/database');

// ============================================
// API GET - Lấy danh sách nhà cung cấp
// ============================================
router.get('/', async (req, res) => {
    try {
        const pool = await poolPromise;

        const result = await pool.request().query(`
            SELECT
                maNCC,
                tenNCC,
                soDienThoai,
                diaChi,
                email,
                trangThaiXoa
            FROM NHACUNGCAP
            WHERE trangThaiXoa = 0
            ORDER BY maNCC
        `);

        res.status(200).json({
            success: true,
            message: 'Lấy danh sách nhà cung cấp thành công!',
            total: result.recordset.length,
            data: result.recordset
        });

    } catch (error) {
        console.log('Loi lay danh sach nha cung cap:', error.message);

        res.status(500).json({
            success: false,
            message: 'Không thể lấy danh sách nhà cung cấp!',
            error: error.message
        });
    }
});


// ============================================
// API POST - Thêm nhà cung cấp
// ============================================
router.post('/', async (req, res) => {
    const {
        tenNCC,
        soDienThoai,
        diaChi,
        email
    } = req.body || {};

    // Kiểm tra dữ liệu bắt buộc
    if (
        !tenNCC?.trim() ||
        !soDienThoai?.trim() ||
        !diaChi?.trim()
    ) {
        return res.status(400).json({
            success: false,
            message: 'Vui lòng nhập đầy đủ thông tin bắt buộc!'
        });
    }

    const ten = tenNCC.trim();
    const sdt = soDienThoai.trim();
    const diaChiNCC = diaChi.trim();
    const emailNCC = email?.trim() || null;

    // Kiểm tra độ dài
    if (ten.length > 100 || diaChiNCC.length > 200) {
        return res.status(400).json({
            success: false,
            message: 'Tên nhà cung cấp hoặc địa chỉ vượt quá độ dài cho phép!'
        });
    }

    if (emailNCC && emailNCC.length > 50) {
        return res.status(400).json({
            success: false,
            message: 'Email không được vượt quá 50 ký tự!'
        });
    }

    // Kiểm tra số điện thoại
    if (!/^0\d{9}$/.test(sdt)) {
        return res.status(400).json({
            success: false,
            message: 'Số điện thoại phải gồm 10 chữ số và bắt đầu bằng 0!'
        });
    }

    // Kiểm tra email
    if (
        emailNCC &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNCC)
    ) {
        return res.status(400).json({
            success: false,
            message: 'Email không đúng định dạng!'
        });
    }

    const pool = await poolPromise;
    const transaction = new sql.Transaction(pool);

    try {
        await transaction.begin();

        const request = transaction.request();

        request.input('tenNCC', sql.NVarChar(100), ten);
        request.input('soDienThoai', sql.Char(10), sdt);
        request.input('diaChi', sql.NVarChar(200), diaChiNCC);
        request.input('email', sql.VarChar(50), emailNCC);

        const result = await request.query(`
            -- Kiểm tra tên NCC đã tồn tại
            IF EXISTS (
                SELECT 1
                FROM NHACUNGCAP
                WHERE tenNCC = @tenNCC
            )
            BEGIN
                THROW 50001, 'Ten nha cung cap da ton tai!', 1;
            END;

            -- Kiểm tra số điện thoại đã tồn tại
            IF EXISTS (
                SELECT 1
                FROM NHACUNGCAP
                WHERE soDienThoai = @soDienThoai
            )
            BEGIN
                THROW 50002, 'So dien thoai da duoc su dung!', 1;
            END;

            -- Kiểm tra email đã tồn tại
            IF @email IS NOT NULL
               AND EXISTS (
                    SELECT 1
                    FROM NHACUNGCAP
                    WHERE email = @email
               )
            BEGIN
                THROW 50003, 'Email da duoc su dung!', 1;
            END;

            -- Sinh mã NCC tiếp theo
            DECLARE @soMa INT;

            SELECT @soMa = ISNULL(
                MAX(TRY_CONVERT(INT, SUBSTRING(maNCC, 4, 4))),
                0
            ) + 1
            FROM NHACUNGCAP WITH (UPDLOCK, HOLDLOCK);

            IF @soMa > 9999
            BEGIN
                THROW 50004, 'Da vuot qua so luong ma NCC cho phep!', 1;
            END;

            DECLARE @maNCC CHAR(7);

            SET @maNCC =
                'NCC' + RIGHT('0000' + CAST(@soMa AS VARCHAR(4)), 4);

            INSERT INTO NHACUNGCAP (
                maNCC,
                tenNCC,
                soDienThoai,
                diaChi,
                email,
                trangThaiXoa
            )
            VALUES (
                @maNCC,
                @tenNCC,
                @soDienThoai,
                @diaChi,
                @email,
                0
            );

            SELECT
                maNCC,
                tenNCC,
                soDienThoai,
                diaChi,
                email,
                trangThaiXoa
            FROM NHACUNGCAP
            WHERE maNCC = @maNCC;
        `);

        await transaction.commit();

        res.status(201).json({
            success: true,
            message: 'Thêm nhà cung cấp thành công!',
            data: result.recordset[0]
        });

    } catch (error) {
        if (transaction._aborted !== true) {
            await transaction.rollback();
        }

        console.log('Loi them nha cung cap:', error.message);

        res.status(400).json({
            success: false,
            message: 'Không thể thêm nhà cung cấp!',
            error: error.message
        });
    }
});


// ============================================
// API PUT - Cập nhật nhà cung cấp
// ============================================
router.put('/:maNCC', async (req, res) => {
    const { maNCC } = req.params;

    const {
        tenNCC,
        soDienThoai,
        diaChi,
        email
    } = req.body || {};

    if (
        !tenNCC?.trim() ||
        !soDienThoai?.trim() ||
        !diaChi?.trim()
    ) {
        return res.status(400).json({
            success: false,
            message: 'Vui lòng nhập đầy đủ thông tin bắt buộc!'
        });
    }

    if (!/^NCC\d{4}$/.test(maNCC)) {
        return res.status(400).json({
            success: false,
            message: 'Mã nhà cung cấp không hợp lệ!'
        });
    }

    const ten = tenNCC.trim();
    const sdt = soDienThoai.trim();
    const diaChiNCC = diaChi.trim();
    const emailNCC = email?.trim() || null;

    if (ten.length > 100 || diaChiNCC.length > 200) {
        return res.status(400).json({
            success: false,
            message: 'Tên nhà cung cấp hoặc địa chỉ vượt quá độ dài cho phép!'
        });
    }

    if (emailNCC && emailNCC.length > 50) {
        return res.status(400).json({
            success: false,
            message: 'Email không được vượt quá 50 ký tự!'
        });
    }

    if (!/^0\d{9}$/.test(sdt)) {
        return res.status(400).json({
            success: false,
            message: 'Số điện thoại phải gồm 10 chữ số và bắt đầu bằng 0!'
        });
    }

    if (
        emailNCC &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNCC)
    ) {
        return res.status(400).json({
            success: false,
            message: 'Email không đúng định dạng!'
        });
    }

    const pool = await poolPromise;
    const transaction = new sql.Transaction(pool);

    try {
        await transaction.begin();

        const request = transaction.request();

        request.input('maNCC', sql.Char(7), maNCC);
        request.input('tenNCC', sql.NVarChar(100), ten);
        request.input('soDienThoai', sql.Char(10), sdt);
        request.input('diaChi', sql.NVarChar(200), diaChiNCC);
        request.input('email', sql.VarChar(50), emailNCC);

        const result = await request.query(`
            -- Kiểm tra NCC cần sửa
            IF NOT EXISTS (
                SELECT 1
                FROM NHACUNGCAP
                WHERE maNCC = @maNCC
                  AND trangThaiXoa = 0
            )
            BEGIN
                THROW 50005, 'Khong tim thay nha cung cap!', 1;
            END;

            -- Kiểm tra trùng tên
            IF EXISTS (
                SELECT 1
                FROM NHACUNGCAP
                WHERE tenNCC = @tenNCC
                  AND maNCC <> @maNCC
            )
            BEGIN
                THROW 50006, 'Ten nha cung cap da ton tai!', 1;
            END;

            -- Kiểm tra trùng số điện thoại
            IF EXISTS (
                SELECT 1
                FROM NHACUNGCAP
                WHERE soDienThoai = @soDienThoai
                  AND maNCC <> @maNCC
            )
            BEGIN
                THROW 50007, 'So dien thoai da duoc su dung!', 1;
            END;

            -- Kiểm tra trùng email
            IF @email IS NOT NULL
               AND EXISTS (
                    SELECT 1
                    FROM NHACUNGCAP
                    WHERE email = @email
                      AND maNCC <> @maNCC
               )
            BEGIN
                THROW 50008, 'Email da duoc su dung!', 1;
            END;

            UPDATE NHACUNGCAP
            SET
                tenNCC = @tenNCC,
                soDienThoai = @soDienThoai,
                diaChi = @diaChi,
                email = @email
            WHERE maNCC = @maNCC
              AND trangThaiXoa = 0;

            SELECT
                maNCC,
                tenNCC,
                soDienThoai,
                diaChi,
                email,
                trangThaiXoa
            FROM NHACUNGCAP
            WHERE maNCC = @maNCC;
        `);

        await transaction.commit();

        res.status(200).json({
            success: true,
            message: 'Cập nhật nhà cung cấp thành công!',
            data: result.recordset[0]
        });

    } catch (error) {
        if (transaction._aborted !== true) {
            await transaction.rollback();
        }

        console.log('Loi cap nhat nha cung cap:', error.message);

        res.status(400).json({
            success: false,
            message: 'Không thể cập nhật nhà cung cấp!',
            error: error.message
        });
    }
});


// ============================================
// API DELETE - Xóa mềm nhà cung cấp
// ============================================
router.delete('/:maNCC', async (req, res) => {
    const { maNCC } = req.params;

    if (!/^NCC\d{4}$/.test(maNCC)) {
        return res.status(400).json({
            success: false,
            message: 'Mã nhà cung cấp không hợp lệ!'
        });
    }

    try {
        const pool = await poolPromise;

        // Kiểm tra nhà cung cấp có đang được sử dụng không
        const check = await pool.request()
            .input('maNCC', sql.Char(7), maNCC)
            .query(`
                SELECT
                    CASE
                        WHEN EXISTS (
                            SELECT 1
                            FROM NGUYENVATLIEU
                            WHERE maNCC = @maNCC
                        )
                        OR EXISTS (
                            SELECT 1
                            FROM PHIEUNHAPKHO
                            WHERE maNCC = @maNCC
                        )
                        THEN 1
                        ELSE 0
                    END AS dangSuDung
            `);

        if (check.recordset[0].dangSuDung === 1) {
            return res.status(400).json({
                success: false,
                message: 'Nhà cung cấp đang được sử dụng, không thể xóa!'
            });
        }

        // Xóa mềm nhà cung cấp
        const result = await pool.request()
            .input('maNCC', sql.Char(7), maNCC)
            .query(`
                UPDATE NHACUNGCAP
                SET trangThaiXoa = 1
                WHERE maNCC = @maNCC
                  AND trangThaiXoa = 0
            `);

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({
                success: false,
                message: 'Nhà cung cấp không tồn tại hoặc đã bị xóa!'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Xóa nhà cung cấp thành công!',
            maNCC: maNCC
        });

    } catch (error) {
        console.log('Loi xoa nha cung cap:', error.message);

        res.status(500).json({
            success: false,
            message: 'Không thể xóa nhà cung cấp!',
            error: error.message
        });
    }
});

module.exports = router;
