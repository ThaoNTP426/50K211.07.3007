
const express = require('express');
const router = express.Router();

const sql = require('mssql/msnodesqlv8');
const { poolPromise } = require('../config/database');

// Chuẩn hóa mã SQL char(7)
const cleanCode = (value) => String(value || '').trim();

// Tạo mã món dạng MON0001, MON0002...
const generateRecipeCode = async (transaction) => {
    const request = new sql.Request(transaction);

    const result = await request.query(`
        SELECT ISNULL(
            MAX(TRY_CONVERT(INT, SUBSTRING(RTRIM(maMon), 4, 4))),
            0
        ) AS maxCode
        FROM MON WITH (UPDLOCK, HOLDLOCK)
        WHERE maMon LIKE 'MON%'
    `);

    const nextNumber = Number(result.recordset[0].maxCode) + 1;

    if (nextNumber > 9999) {
        throw new Error('Đã vượt quá số lượng mã món cho phép!');
    }

    return 'MON' + String(nextNumber).padStart(4, '0');
};

// Chuẩn hóa dữ liệu nguyên liệu
const normalizeItems = (items) => {
    if (!Array.isArray(items) || items.length === 0) {
        throw new Error('Công thức phải có ít nhất một nguyên vật liệu!');
    }

    const usedMaterials = new Set();

    return items.map((item) => {
        const maNVL = cleanCode(item.materialId || item.maNVL);
        const dinhLuong = Number(item.qty ?? item.dinhLuong);

        if (!maNVL) {
            throw new Error('Vui lòng chọn nguyên vật liệu!');
        }

        if (!Number.isFinite(dinhLuong) || dinhLuong <= 0) {
            throw new Error('Định lượng phải lớn hơn 0!');
        }

        if (dinhLuong > 9999999.999) {
            throw new Error('Định lượng vượt quá giới hạn cho phép!');
        }

        if (usedMaterials.has(maNVL)) {
            throw new Error('Không được chọn trùng nguyên vật liệu!');
        }

        usedMaterials.add(maNVL);

        return {
            maNVL,
            dinhLuong,
            ghiChuPhaChe: String(
                item.note || item.ghiChuPhaChe || ''
            ).trim() || null
        };
    });
};

// GET: Lấy danh sách công thức món
router.get('/', async (req, res) => {
    try {
        const pool = await poolPromise;

        const result = await pool.request().query(`
            SELECT
                m.maMon,
                m.tenMon,
                m.nhomMon,
                m.loaiCongThuc,
                m.donViTinh,
                m.trangThai,

                c.maNVL,
                c.dinhLuong,
                c.ghiChuPhaChe,

                n.tenNVL,
                n.donViTinh AS donViTinhNVL,
                n.donViQuyDoi

            FROM MON m

            LEFT JOIN CONGTHUCMON c
                ON m.maMon = c.maMon

            LEFT JOIN NGUYENVATLIEU n
                ON c.maNVL = n.maNVL

            ORDER BY m.maMon, c.maNVL
        `);

        const recipesMap = new Map();

        for (const row of result.recordset) {
            const maMon = cleanCode(row.maMon);

            if (!recipesMap.has(maMon)) {
                recipesMap.set(maMon, {
                    maMon,
                    tenMon: row.tenMon,
                    nhomMon: row.nhomMon,
                    loaiCongThuc: row.loaiCongThuc,
                    donViTinh: row.donViTinh,
                    trangThai: row.trangThai,
                    items: []
                });
            }

            if (row.maNVL) {
                recipesMap.get(maMon).items.push({
                    maNVL: cleanCode(row.maNVL),
                    tenNVL: row.tenNVL,
                    dinhLuong: Number(row.dinhLuong),
                    ghiChuPhaChe: row.ghiChuPhaChe || '',
                    donViTinh: row.donViTinhNVL,
                    donViQuyDoi: row.donViQuyDoi,
                    donViDinhLuong:
                        row.donViQuyDoi || row.donViTinhNVL
                });
            }
        }

        const data = Array.from(recipesMap.values());

        return res.status(200).json({
            success: true,
            message: 'Lấy danh sách công thức món thành công!',
            total: data.length,
            data
        });

    } catch (error) {
        console.error('Lỗi lấy danh sách công thức món:', error);

        return res.status(500).json({
            success: false,
            message: 'Không thể lấy danh sách công thức món!',
            error: error.message
        });
    }
});

// POST: Thêm công thức món
router.post('/', async (req, res) => {
    const pool = await poolPromise;
    const transaction = new sql.Transaction(pool);

    try {
        const {
            name,
            group,
            type,
            unit,
            items
        } = req.body || {};

        const tenMon = String(name || '').trim();
        const nhomMon = String(group || '').trim();
        const loaiCongThuc = String(type || 'Món chính').trim();
        const donViTinh = String(unit || 'Ly').trim();

        if (!tenMon || !nhomMon || !loaiCongThuc || !donViTinh) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng nhập đầy đủ tên món, nhóm món, loại công thức và đơn vị tính!'
            });
        }

        const normalizedItems = normalizeItems(items);

        await transaction.begin();

        const maMon = await generateRecipeCode(transaction);

        const insertRecipe = new sql.Request(transaction);

        await insertRecipe
            .input('maMon', sql.Char(7), maMon)
            .input('tenMon', sql.NVarChar(sql.MAX), tenMon)
            .input('nhomMon', sql.NVarChar(sql.MAX), nhomMon)
            .input('loaiCongThuc', sql.NVarChar(sql.MAX), loaiCongThuc)
            .input('donViTinh', sql.NVarChar(sql.MAX), donViTinh)
            .query(`
                INSERT INTO MON (
                    maMon,
                    tenMon,
                    nhomMon,
                    loaiCongThuc,
                    donViTinh
                )
                VALUES (
                    @maMon,
                    @tenMon,
                    @nhomMon,
                    @loaiCongThuc,
                    @donViTinh
                )
            `);

        for (const item of normalizedItems) {
            const insertItem = new sql.Request(transaction);

            await insertItem
                .input('maMon', sql.Char(7), maMon)
                .input('maNVL', sql.Char(7), item.maNVL)
                .input('dinhLuong', sql.Decimal(10, 3), item.dinhLuong)
                .input('ghiChuPhaChe', sql.NVarChar(1000), item.ghiChuPhaChe)
                .query(`
                    INSERT INTO CONGTHUCMON (
                        maMon,
                        maNVL,
                        dinhLuong,
                        ghiChuPhaChe
                    )
                    VALUES (
                        @maMon,
                        @maNVL,
                        @dinhLuong,
                        @ghiChuPhaChe
                    )
                `);
        }

        await transaction.commit();

        return res.status(201).json({
            success: true,
            message: 'Thêm công thức món thành công!',
            data: { maMon }
        });

    } catch (error) {
        try {
            if (transaction._aborted !== true) {
                await transaction.rollback();
            }
        } catch (rollbackError) {
            console.error('Lỗi rollback thêm công thức:', rollbackError);
        }

        console.error('Lỗi thêm công thức món:', error);

        return res.status(400).json({
            success: false,
            message: error.number === 2627 || error.number === 2601
                ? 'Tên món và loại công thức đã tồn tại!'
                : error.number === 547
                    ? 'Nguyên vật liệu không tồn tại hoặc dữ liệu đang được tham chiếu!'
                    : error.message || 'Không thể thêm công thức món!'
        });
    }
});

// PUT: Cập nhật công thức món
router.put('/:maMon', async (req, res) => {
    const pool = await poolPromise;
    const transaction = new sql.Transaction(pool);

    try {
        const maMon = cleanCode(req.params.maMon);

        const {
            name,
            group,
            type,
            unit,
            items
        } = req.body || {};

        const tenMon = String(name || '').trim();
        const nhomMon = String(group || '').trim();
        const loaiCongThuc = String(type || '').trim();
        const donViTinh = String(unit || '').trim();

        if (!maMon || !tenMon || !nhomMon || !loaiCongThuc || !donViTinh) {
            return res.status(400).json({
                success: false,
                message: 'Thông tin công thức không đầy đủ!'
            });
        }

        const normalizedItems = normalizeItems(items);

        await transaction.begin();

        const checkRequest = new sql.Request(transaction);

        const check = await checkRequest
            .input('maMon', sql.Char(7), maMon)
            .query(`
                SELECT maMon
                FROM MON
                WHERE maMon = @maMon
            `);

        if (!check.recordset.length) {
            await transaction.rollback();

            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy công thức món!'
            });
        }

        const updateRequest = new sql.Request(transaction);

        await updateRequest
            .input('maMon', sql.Char(7), maMon)
            .input('tenMon', sql.NVarChar(sql.MAX), tenMon)
            .input('nhomMon', sql.NVarChar(sql.MAX), nhomMon)
            .input('loaiCongThuc', sql.NVarChar(sql.MAX), loaiCongThuc)
            .input('donViTinh', sql.NVarChar(sql.MAX), donViTinh)
            .query(`
                UPDATE MON
                SET
                    tenMon = @tenMon,
                    nhomMon = @nhomMon,
                    loaiCongThuc = @loaiCongThuc,
                    donViTinh = @donViTinh
                WHERE maMon = @maMon
            `);

        const deleteItems = new sql.Request(transaction);

        await deleteItems
            .input('maMon', sql.Char(7), maMon)
            .query(`
                DELETE FROM CONGTHUCMON
                WHERE maMon = @maMon
            `);

        for (const item of normalizedItems) {
            const insertItem = new sql.Request(transaction);

            await insertItem
                .input('maMon', sql.Char(7), maMon)
                .input('maNVL', sql.Char(7), item.maNVL)
                .input('dinhLuong', sql.Decimal(10, 3), item.dinhLuong)
                .input('ghiChuPhaChe', sql.NVarChar(1000), item.ghiChuPhaChe)
                .query(`
                    INSERT INTO CONGTHUCMON (
                        maMon,
                        maNVL,
                        dinhLuong,
                        ghiChuPhaChe
                    )
                    VALUES (
                        @maMon,
                        @maNVL,
                        @dinhLuong,
                        @ghiChuPhaChe
                    )
                `);
        }

        await transaction.commit();

        return res.status(200).json({
            success: true,
            message: 'Cập nhật công thức món thành công!',
            data: { maMon }
        });

    } catch (error) {
        try {
            if (transaction._aborted !== true) {
                await transaction.rollback();
            }
        } catch (rollbackError) {
            console.error('Lỗi rollback cập nhật công thức:', rollbackError);
        }

        console.error('Lỗi cập nhật công thức món:', error);

        return res.status(400).json({
            success: false,
            message: error.number === 2627 || error.number === 2601
                ? 'Tên món và loại công thức đã tồn tại!'
                : error.number === 547
                    ? 'Nguyên vật liệu không tồn tại hoặc dữ liệu đang được tham chiếu!'
                    : error.message || 'Không thể cập nhật công thức món!'
        });
    }
});

// DELETE: Xóa công thức món
router.delete('/:maMon', async (req, res) => {
    const pool = await poolPromise;
    const transaction = new sql.Transaction(pool);

    try {
        const maMon = cleanCode(req.params.maMon);

        if (!maMon) {
            return res.status(400).json({
                success: false,
                message: 'Mã món không hợp lệ!'
            });
        }

        await transaction.begin();

        const checkRequest = new sql.Request(transaction);

        const check = await checkRequest
            .input('maMon', sql.Char(7), maMon)
            .query(`
                SELECT maMon, tenMon
                FROM MON
                WHERE maMon = @maMon
            `);

        if (!check.recordset.length) {
            await transaction.rollback();

            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy công thức món!'
            });
        }

        const deleteItems = new sql.Request(transaction);

        await deleteItems
            .input('maMon', sql.Char(7), maMon)
            .query(`
                DELETE FROM CONGTHUCMON
                WHERE maMon = @maMon
            `);

        const deleteRecipe = new sql.Request(transaction);

        await deleteRecipe
            .input('maMon', sql.Char(7), maMon)
            .query(`
                DELETE FROM MON
                WHERE maMon = @maMon
            `);

        await transaction.commit();

        return res.status(200).json({
            success: true,
            message: 'Xóa công thức món thành công!',
            data: {
                maMon,
                tenMon: check.recordset[0].tenMon
            }
        });

    } catch (error) {
        try {
            if (transaction._aborted !== true) {
                await transaction.rollback();
            }
        } catch (rollbackError) {
            console.error('Lỗi rollback xóa công thức:', rollbackError);
        }

        console.error('Lỗi xóa công thức món:', error);

        return res.status(400).json({
            success: false,
            message: error.number === 547
                ? 'Không thể xóa món vì đang được dữ liệu khác tham chiếu!'
                : error.message || 'Không thể xóa công thức món!'
        });
    }
});

module.exports = router;
