
const express = require('express');
const router = express.Router();

const { poolPromise } = require('../config/database');

// API: Lấy danh sách nguyên vật liệu
router.get('/', async (req, res) => {
    try {
        const pool = await poolPromise;

        const result = await pool.request().query(`
            SELECT
                maNVL,
                tenNVL,
                nhomNVL,
                maNCC,
                donViTinh,
                donViQuyDoi,
                tyLeQuyDoi,
                tonHienTai,
                mucTonToiThieu,
                trangThaiXoa
            FROM NGUYENVATLIEU
            WHERE trangThaiXoa = 0
            ORDER BY maNVL
        `);

        res.status(200).json({
            success: true,
            message: 'Lấy danh sách nguyên vật liệu thành công!',
            total: result.recordset.length,
            data: result.recordset
        });

    } catch (error) {
        console.log('Loi lay danh sach nguyen vat lieu:', error.message);

        res.status(500).json({
            success: false,
            message: 'Không thể lấy danh sách nguyên vật liệu!',
            error: error.message
        });
    }
});

// API: Thêm nguyên vật liệu
router.post('/', async (req, res) => {
    const {
        tenNVL,
        nhomNVL,
        maNCC,
        donViTinh,
        donViQuyDoi,
        tyLeQuyDoi,
        mucTonToiThieu
    } = req.body;

    // Kiểm tra dữ liệu bắt buộc
    if (
        !tenNVL || !nhomNVL || !maNCC ||
        !donViTinh || mucTonToiThieu === undefined
    ) {
        return res.status(400).json({
            success: false,
            message: 'Vui lòng nhập đầy đủ thông tin bắt buộc!'
        });
    }

    // Kiểm tra dữ liệu số
    if (
        !Number.isInteger(Number(mucTonToiThieu)) ||
        Number(mucTonToiThieu) < 0
    ) {
        return res.status(400).json({
            success: false,
            message: 'Mức tồn tối thiểu phải là số nguyên không âm!'
        });
    }

    if (
        (donViQuyDoi && !Number.isFinite(Number(tyLeQuyDoi))) ||
        (tyLeQuyDoi !== undefined &&
         tyLeQuyDoi !== null &&
         (!Number.isFinite(Number(tyLeQuyDoi)) ||
          Number(tyLeQuyDoi) <= 0 ||
          Number(tyLeQuyDoi) > 99999999.99))
    ) {
        return res.status(400).json({
            success: false,
            message: 'Tỷ lệ quy đổi không hợp lệ!'
        });
    }

    if (
        donViQuyDoi &&
        (tyLeQuyDoi === undefined || tyLeQuyDoi === null)
    ) {
        return res.status(400).json({
            success: false,
            message: 'Vui lòng nhập tỷ lệ quy đổi!'
        });
    }

    const pool = await poolPromise;
    const transaction = new (require('mssql/msnodesqlv8').Transaction)(pool);

    try {
        await transaction.begin();

        const request = transaction.request();

        request.input('tenNVL', require('mssql/msnodesqlv8').NVarChar(100), tenNVL.trim());
        request.input('nhomNVL', require('mssql/msnodesqlv8').NVarChar(50), nhomNVL.trim());
        request.input('maNCC', require('mssql/msnodesqlv8').Char(7), maNCC.trim());
        request.input('donViTinh', require('mssql/msnodesqlv8').NVarChar(20), donViTinh.trim());
        request.input('donViQuyDoi', require('mssql/msnodesqlv8').NVarChar(20), donViQuyDoi || null);
        request.input('tyLeQuyDoi', require('mssql/msnodesqlv8').Decimal(10, 2), tyLeQuyDoi ?? null);
        request.input('mucTonToiThieu', require('mssql/msnodesqlv8').Int, Number(mucTonToiThieu));

        const result = await request.query(`
            IF NOT EXISTS (
                SELECT 1
                FROM NHACUNGCAP WITH (UPDLOCK, HOLDLOCK)
                WHERE maNCC = @maNCC
            )
            BEGIN
                THROW 50001, 'Nha cung cap khong ton tai!', 1;
            END;

            DECLARE @soMa INT;

            SELECT @soMa = ISNULL(
                MAX(TRY_CONVERT(INT, SUBSTRING(maNVL, 4, 4))), 0
            ) + 1
            FROM NGUYENVATLIEU WITH (UPDLOCK, HOLDLOCK);

            DECLARE @maNVL CHAR(7);
            SET @maNVL = 'NVL' + RIGHT('0000' + CAST(@soMa AS VARCHAR(4)), 4);

            INSERT INTO NGUYENVATLIEU (
                maNVL, tenNVL, nhomNVL, maNCC,
                donViTinh, donViQuyDoi, tyLeQuyDoi,
                tonHienTai, mucTonToiThieu, trangThaiXoa
            )
            VALUES (
                @maNVL, @tenNVL, @nhomNVL, @maNCC,
                @donViTinh, @donViQuyDoi, @tyLeQuyDoi,
                0, @mucTonToiThieu, 0
            );

            SELECT *
            FROM NGUYENVATLIEU
            WHERE maNVL = @maNVL;
        `);

        await transaction.commit();

        res.status(201).json({
            success: true,
            message: 'Thêm nguyên vật liệu thành công!',
            data: result.recordset[0]
        });

    } catch (error) {
        await transaction.rollback();

        res.status(400).json({
            success: false,
            message: 'Không thể thêm nguyên vật liệu!',
            error: error.message
        });
    }
});
// API: Sửa thông tin nguyên vật liệu
router.put('/:maNVL', async (req, res) => {
    const {
        tenNVL,
        nhomNVL,
        maNCC,
        donViTinh,
        donViQuyDoi,
        tyLeQuyDoi,
        mucTonToiThieu
    } = req.body || {};

    const maNVL = req.params.maNVL;

    // Kiểm tra dữ liệu bắt buộc
    if (
        !tenNVL?.trim() ||
        !nhomNVL?.trim() ||
        !maNCC?.trim() ||
        !donViTinh?.trim() ||
        mucTonToiThieu === undefined
    ) {
        return res.status(400).json({
            success: false,
            message: 'Vui lòng nhập đầy đủ thông tin bắt buộc!'
        });
    }

    if (
        !Number.isInteger(Number(mucTonToiThieu)) ||
        Number(mucTonToiThieu) < 0
    ) {
        return res.status(400).json({
            success: false,
            message: 'Mức tồn tối thiểu phải là số nguyên không âm!'
        });
    }

    if (
        donViQuyDoi &&
        (tyLeQuyDoi === undefined ||
         tyLeQuyDoi === null ||
         !Number.isFinite(Number(tyLeQuyDoi)) ||
         Number(tyLeQuyDoi) <= 0 ||
         Number(tyLeQuyDoi) > 99999999.99)
    ) {
        return res.status(400).json({
            success: false,
            message: 'Tỷ lệ quy đổi không hợp lệ!'
        });
    }

    if (
        tyLeQuyDoi !== undefined &&
        tyLeQuyDoi !== null &&
        (!Number.isFinite(Number(tyLeQuyDoi)) ||
         Number(tyLeQuyDoi) <= 0 ||
         Number(tyLeQuyDoi) > 99999999.99)
    ) {
        return res.status(400).json({
            success: false,
            message: 'Tỷ lệ quy đổi không hợp lệ!'
        });
    }

    const sql = require('mssql/msnodesqlv8');
    const pool = await poolPromise;
    const transaction = new sql.Transaction(pool);

    try {
        await transaction.begin();

        const request = transaction.request();

        request.input('maNVL', sql.Char(7), maNVL);
        request.input('tenNVL', sql.NVarChar(100), tenNVL.trim());
        request.input('nhomNVL', sql.NVarChar(50), nhomNVL.trim());
        request.input('maNCC', sql.Char(7), maNCC.trim());
        request.input('donViTinh', sql.NVarChar(20), donViTinh.trim());
        request.input(
            'donViQuyDoi',
            sql.NVarChar(20),
            donViQuyDoi?.trim() || null
        );
        request.input(
            'tyLeQuyDoi',
            sql.Decimal(10, 2),
            tyLeQuyDoi === undefined || tyLeQuyDoi === null
                ? null
                : Number(tyLeQuyDoi)
        );
        request.input(
            'mucTonToiThieu',
            sql.Int,
            Number(mucTonToiThieu)
        );

        // Kiểm tra nhÃ  cung cấp
        const ncc = await request.query(`
            SELECT maNCC
            FROM NHACUNGCAP
            WHERE maNCC = @maNCC
        `);

        if (ncc.recordset.length === 0) {
            await transaction.rollback();

            return res.status(400).json({
                success: false,
                message: 'Nhà cung cấp không tồn tại!'
            });
        }

        // Cập nhật nguyên vật liệu
        const result = await request.query(`
            UPDATE NGUYENVATLIEU
            SET
                tenNVL = @tenNVL,
                nhomNVL = @nhomNVL,
                maNCC = @maNCC,
                donViTinh = @donViTinh,
                donViQuyDoi = @donViQuyDoi,
                tyLeQuyDoi = @tyLeQuyDoi,
                mucTonToiThieu = @mucTonToiThieu
            WHERE maNVL = @maNVL
              AND trangThaiXoa = 0;

            SELECT *
            FROM NGUYENVATLIEU
            WHERE maNVL = @maNVL;
        `);

        if (result.rowsAffected[0] === 0) {
            await transaction.rollback();

            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy nguyên vật liệu!'
            });
        }

        await transaction.commit();

        res.status(200).json({
            success: true,
            message: 'Cập nhật nguyên vật liệu thành công!',
            data: result.recordset[0]
        });

    } catch (error) {
        if (transaction._aborted !== true) {
            await transaction.rollback();
        }

        console.log('Loi cap nhat nguyen vat lieu:', error.message);

        res.status(500).json({
            success: false,
            message: 'Không thể cập nhật nguyên vật liệu!',
            error: error.message
        });
    }
});
// API DELETE - Xoa mem nguyen vat lieu
router.delete('/:maNVL', async (req, res) => {
    try {
        const { maNVL } = req.params;

        // Kiem tra dinh dang ma nguyen vat lieu
        if (!/^NVL\d{4}$/.test(maNVL)) {
            return res.status(400).json({
                success: false,
                message: 'Mã nguyên vật liệu không hợp lệ!'
            });
        }

        const sql = require('mssql/msnodesqlv8');
        const pool = await poolPromise;

        // Cap nhat trang thai xoa
        const result = await pool.request()
            .input('maNVL', sql.Char(7), maNVL)
            .query(`
                UPDATE NGUYENVATLIEU
                SET trangThaiXoa = 1
                WHERE maNVL = @maNVL
                  AND trangThaiXoa = 0
            `);

        // Kiem tra nguyen vat lieu ton tai
        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({
                success: false,
                message: 'Nguyên vật liệu không tồn tại hoặc đã bị xóa!'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Xóa nguyên vật liệu thành công!',
            maNVL: maNVL
        });

    } catch (error) {
        console.log('Loi xoa nguyen vat lieu:', error.message);

        res.status(500).json({
            success: false,
            message: 'Không thể xóa nguyên vật liệu!'
        });
    }
});
module.exports = router;
