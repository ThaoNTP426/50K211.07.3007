
const express = require('express');
const router = express.Router();

const sql = require('mssql/msnodesqlv8');
const { poolPromise } = require('../config/database');
const { insertInventoryHistory } = require('../utils/inventoryHistoryInstrumentation');

// ==========================================
// 1. HÀM HỖ TRỢ
// ==========================================

// Chuẩn hóa ngÃ y về YYYY-MM-DD
function normalizeDate(value) {
    if (!value) return null;

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().slice(0, 10);
    }

    const dateValue = String(value).trim();

    let year;
    let month;
    let day;

    const isoMatch = dateValue.match(
        /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/
    );

    if (isoMatch) {
        year = Number(isoMatch[1]);
        month = Number(isoMatch[2]);
        day = Number(isoMatch[3]);
    } else {
        const vnMatch = dateValue.match(
            /^(\d{2})\/(\d{2})\/(\d{4})$/
        );

        if (!vnMatch) return null;

        day = Number(vnMatch[1]);
        month = Number(vnMatch[2]);
        year = Number(vnMatch[3]);
    }

    const checkDate = new Date(Date.UTC(year, month - 1, day));

    if (
        checkDate.getUTCFullYear() !== year ||
        checkDate.getUTCMonth() !== month - 1 ||
        checkDate.getUTCDate() !== day
    ) {
        return null;
    }

    return [
        String(year).padStart(4, '0'),
        String(month).padStart(2, '0'),
        String(day).padStart(2, '0')
    ].join('-');
}

// Chuyển ngÃ y từ SQL Server về YYYY-MM-DD
function formatSqlDate(value) {
    if (!value) return '';

    if (value instanceof Date) {
        return value.toISOString().slice(0, 10);
    }

    return String(value).slice(0, 10);
}

// Chuẩn hóa dữ liệu nhận từ frontend hoặc Postman
function prepareSlip(body) {
    const source = body || {};

    const ngayHaoHut = normalizeDate(
        source.ngayHaoHut ?? source.date
    );

    const lyDo = source.lyDo ?? source.reason;
    const ghiChu = source.ghiChu ?? source.note ?? '';

    let chiTiet = source.chiTiet ?? source.items;

    if (Array.isArray(chiTiet)) {
        chiTiet = chiTiet.map(item => ({
            maNVL: String(
                item.maNVL ?? item.materialId ?? ''
            ).trim(),

            soLuong: Number(
                item.soLuong ?? item.qty
            )
        }));
    }

    if (!ngayHaoHut) {
        return {
            error: 'Ngày hao hụt không hợp lệ! Hãy nhập YYYY-MM-DD hoặc DD/MM/YYYY.'
        };
    }

    const reasons = [
        'Đổ vỡ/rơi vãi',
        'Hư hỏng',
        'Hết hạn',
        'Chế biến dư',
        'Khác'
    ];

    if (!reasons.includes(lyDo)) {
        return {
            error: 'Lý do hao hụt không hợp lệ!'
        };
    }

    if (String(ghiChu).length > 600) {
        return {
            error: 'Ghi chú không được vượt quá 600 ký tự!'
        };
    }

    if (
        lyDo === 'Khác' &&
        !String(ghiChu).trim()
    ) {
        return {
            error: 'Vui lòng nhập ghi chú khi chọn lý do Khác!'
        };
    }

    if (!Array.isArray(chiTiet) || chiTiet.length === 0) {
        return {
            error: 'Phiếu hao hụt phải có ít nhất một nguyên vật liệu!'
        };
    }

    const seen = new Set();

    for (const item of chiTiet) {
        if (!item.maNVL || item.maNVL.length !== 7) {
            return {
                error: 'Mã nguyên vật liệu không hợp lệ!'
            };
        }

        if (seen.has(item.maNVL)) {
            return {
                error: 'Không được chọn trùng nguyên vật liệu trong một phiếu!'
            };
        }

        seen.add(item.maNVL);

        if (
            !Number.isFinite(item.soLuong) ||
            item.soLuong <= 0 ||
            item.soLuong > 999999.99 ||
            Math.abs(
                item.soLuong * 100 -
                Math.round(item.soLuong * 100)
            ) > 0.000001
        ) {
            return {
                error: 'Số lượng hao hụt phải lớn hơn 0 và có tối đa 2 chữ số thập phân!'
            };
        }
    }

    return {
        data: {
            ngayHaoHut,
            lyDo,
            ghiChu: String(ghiChu).trim(),
            chiTiet
        }
    };
}

// Rollback an toÃ n
async function rollbackSafely(transaction) {
    try {
        await transaction.rollback();
    } catch (error) {
        // Transaction có thể đã tự rollback.
    }
}

// Ánh xạ dữ liệu phiếu
function mapSlip(row, details) {
    return {
        maPhieuHaoHut: String(row.maPhieuHaoHut).trim(),
        ngayLap: formatSqlDate(row.ngayLap),
        ngayHaoHut: formatSqlDate(row.ngayHaoHut),
        lyDo: row.lyDo,
        ghiChu: row.ghiChu || '',
        trangThai: row.trangThai,

        chiTiet: details.map(item => ({
            maNVL: String(item.maNVL).trim(),
            tenNVL: item.tenNVL,
            soLuong: Number(item.soLuong),
            donViTinh: item.donViTinh
        }))
    };
}

// ==========================================
// 2. GET - LẤY DANH SÁCH PHIẾU HAO HỤT
// ==========================================

router.get('/', async (req, res) => {
    try {
        const pool = await poolPromise;

        const result = await pool.request().query(`
            SELECT
                maPhieuHaoHut,
                ngayLap,
                ngayHaoHut,
                lyDo,
                ghiChu,
                trangThai
            FROM PHIEUHAOHUT
            ORDER BY ngayLap DESC, maPhieuHaoHut DESC;

            SELECT
                ct.maPhieuHaoHut,
                ct.maNVL,
                nvl.tenNVL,
                ct.soLuong,
                nvl.donViTinh
            FROM CHITIETPHIEUHAOHUT ct
            INNER JOIN NGUYENVATLIEU nvl
                ON ct.maNVL = nvl.maNVL
            ORDER BY ct.maPhieuHaoHut, ct.maNVL;
        `);

        const headers = result.recordsets[0];
        const details = result.recordsets[1];

        const data = headers.map(header => {
            const slipDetails = details.filter(item =>
                String(item.maPhieuHaoHut).trim() ===
                String(header.maPhieuHaoHut).trim()
            );

            return mapSlip(header, slipDetails);
        });

        return res.status(200).json({
            success: true,
            message: 'Lấy danh sách phiếu hao hụt thành công!',
            total: data.length,
            data
        });

    } catch (error) {
        console.log('Lỗi lấy danh sách phiếu hao hụt:', error.message);

        return res.status(500).json({
            success: false,
            message: 'Không thể lấy danh sách phiếu hao hụt!',
            error: error.message
        });
    }
});

// ==========================================
// 3. GET - XEM CHI TIẾT PHIẾU HAO HỤT
// ==========================================

router.get('/:id', async (req, res) => {
    try {
        const pool = await poolPromise;
        const maPhieu = req.params.id;

        const result = await pool.request()
            .input('maPhieu', sql.Char(7), maPhieu)
            .query(`
                SELECT
                    maPhieuHaoHut,
                    ngayLap,
                    ngayHaoHut,
                    lyDo,
                    ghiChu,
                    trangThai
                FROM PHIEUHAOHUT
                WHERE maPhieuHaoHut = @maPhieu;

                SELECT
                    ct.maNVL,
                    nvl.tenNVL,
                    ct.soLuong,
                    nvl.donViTinh
                FROM CHITIETPHIEUHAOHUT ct
                INNER JOIN NGUYENVATLIEU nvl
                    ON ct.maNVL = nvl.maNVL
                WHERE ct.maPhieuHaoHut = @maPhieu;

                SELECT
                    hs.truongDuocSua,
                    hs.giaTriCu,
                    hs.giaTriMoi,
                    COALESCE(tk.tenDangNhap, hs.nguoiSua) AS nguoiSua,
                    hs.thoiGianSua
                FROM LICHSUCHINHSUAPHIEUHAOHUT AS hs
                LEFT JOIN TAIKHOAN AS tk ON tk.maTK = hs.nguoiSua
                WHERE hs.maPhieuHaoHut = @maPhieu
                ORDER BY hs.thoiGianSua DESC;
            `);

        if (result.recordsets[0].length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy phiếu hao hụt!'
            });
        }

        const data = mapSlip(
            result.recordsets[0][0],
            result.recordsets[1]
        );

        data.lichSuChinhSua = result.recordsets[2];

        return res.status(200).json({
            success: true,
            message: 'Lấy chi tiết phiếu hao hụt thành công!',
            data
        });

    } catch (error) {
        console.log('Lỗi lấy chi tiết phiếu hao hụt:', error.message);

        return res.status(500).json({
            success: false,
            message: 'Không thể lấy chi tiết phiếu hao hụt!',
            error: error.message
        });
    }
});

// ==========================================
// 4. POST - Táº O PHIẾU HAO HỤT
// ==========================================

router.post('/', async (req, res) => {
    const prepared = prepareSlip(req.body);

    if (prepared.error) {
        return res.status(400).json({
            success: false,
            message: prepared.error
        });
    }

    const {
        ngayHaoHut,
        lyDo,
        ghiChu,
        chiTiet
    } = prepared.data;

    let transaction;

    try {
        const pool = await poolPromise;
        transaction = new sql.Transaction(pool);

        await transaction.begin();

        const createRequestContext = {
            processId: process.pid,
            workingDirectory: process.cwd(),
            routeFile: __filename,
            method: req.method,
            url: req.originalUrl
        };

        let databaseContext = {
            serverName: '<unavailable>',
            databaseName: '<unavailable>'
        };
        try {
            const identityResult = await transaction.request().query(`
                SELECT @@SERVERNAME AS serverName, DB_NAME() AS databaseName;
            `);
            databaseContext = identityResult.recordset[0] || databaseContext;
        } catch (identityError) {
            console.warn('[LOSS_CREATE_DATABASE_IDENTITY_UNAVAILABLE]', JSON.stringify({
                ...createRequestContext,
                error: identityError.message
            }));
        }

        // Kiểm tra ngÃ y hao hụt
        await transaction.request()
            .input(
                'ngayHaoHut',
                sql.Date,
                new Date(`${ngayHaoHut}T00:00:00.000Z`)
            )
            .query(`
                IF @ngayHaoHut > CONVERT(date, GETDATE())
                    THROW 50001, 'Ngày hao hụt không được lớn hơn ngày hiện tại!', 1;
            `);

        // Sinh mã phiếu
        const codeResult = await transaction.request().query(`
            DECLARE @soMa INT;

            SELECT @soMa = ISNULL(
                MAX(TRY_CONVERT(INT, SUBSTRING(maPhieuHaoHut, 3, 5))),
                0
            ) + 1
            FROM PHIEUHAOHUT WITH (UPDLOCK, HOLDLOCK);

            IF @soMa > 99999
                THROW 50002, 'Đã vượt quá số lượng mã phiếu hao hụt!', 1;

            SELECT
                'HH' + RIGHT(
                    '00000' + CAST(@soMa AS VARCHAR(5)),
                    5
                ) AS maPhieuHaoHut;
        `);

        const maPhieu = codeResult.recordset[0].maPhieuHaoHut;

        // Temporary diagnostics for CK_PHH_TT investigation.
        const trangThaiDuKien = 'Hoàn thành';
        const insertHeaderSql = `
                INSERT INTO PHIEUHAOHUT (
                    maPhieuHaoHut,
                    ngayHaoHut,
                    lyDo,
                    trangThai,
                    ghiChu
                )
                VALUES (
                    @maPhieu,
                    @ngayHaoHut,
                    @lyDo,
                    N'Hoàn thành',
                    @ghiChu
                );
            `;
        const headerLogContext = {
            ...createRequestContext,
            ...databaseContext,
            maPhieu,
            trangThaiDuKien
        };
        console.info('[LOSS_CREATE_HEADER_INSERT_ATTEMPT]', JSON.stringify({
            ...headerLogContext,
            sql: insertHeaderSql
        }));
        try {
            await transaction.request()
                .input('maPhieu', sql.Char(7), maPhieu)
                .input(
                    'ngayHaoHut',
                    sql.Date,
                    new Date(`${ngayHaoHut}T00:00:00.000Z`)
                )
                .input('lyDo', sql.NVarChar(200), lyDo)
                .input('ghiChu', sql.NVarChar(600), ghiChu || null)
                .query(insertHeaderSql);
            console.info('[LOSS_CREATE_HEADER_INSERT_OK]', JSON.stringify(headerLogContext));
        } catch (error) {
            console.error('[LOSS_CREATE_HEADER_INSERT_FAILED]', JSON.stringify({
                ...headerLogContext,
                sql: insertHeaderSql,
                sqlErrorNumber: error.number ?? null,
                sqlLineNumber: error.lineNumber ?? null,
                sqlErrorMessage: error.message
            }));
            throw error;
        }

        // Trừ tồn kho vÃ  ghi lịch sử
        for (const item of chiTiet) {
            const maNVL = item.maNVL;
            const soLuong = item.soLuong;

            const stockQuery = `
                    SELECT tonHienTai
                    FROM NGUYENVATLIEU WITH (UPDLOCK, ROWLOCK)
                    WHERE maNVL = @maNVL
                      AND trangThaiXoa = 0;
                `;
            let stockResult;
            try {
                console.info('[LOSS_CREATE_SQL_ATTEMPT]', JSON.stringify({
                    ...headerLogContext,
                    stage: 'SELECT_CURRENT_STOCK',
                    maNVL,
                    sql: stockQuery
                }));
                stockResult = await transaction.request()
                    .input('maNVL', sql.Char(7), maNVL)
                    .query(stockQuery);
            } catch (error) {
                console.error('[LOSS_CREATE_SQL_FAILED]', JSON.stringify({
                    ...headerLogContext,
                    stage: 'SELECT_CURRENT_STOCK',
                    maNVL,
                    sql: stockQuery,
                    sqlErrorNumber: error.number ?? null,
                    sqlLineNumber: error.lineNumber ?? null,
                    sqlErrorMessage: error.message
                }));
                throw error;
            }

            if (stockResult.recordset.length === 0) {
                throw new Error(
                    `Nguyên vật liệu ${maNVL} không tồn tại hoặc đã bị xóa!`
                );
            }

            const tonTruoc = Number(
                stockResult.recordset[0].tonHienTai
            );

            if (tonTruoc < soLuong) {
                throw new Error(
                    `Nguyên vật liệu ${maNVL} không đủ tồn kho! Tồn hiện tại: ${tonTruoc}.`
                );
            }

            const tonSau = tonTruoc - soLuong;

            const movementType = 'Hao hụt';
            const historyRequest = transaction.request()
                .input('maNVL', sql.Char(7), maNVL)
                .input('soLuong', sql.Decimal(8, 2), soLuong)
                .input('tonTruoc', sql.Decimal(8, 2), tonTruoc)
                .input('tonSau', sql.Decimal(8, 2), tonSau)
                .input('maPhieu', sql.Char(7), maPhieu)
                .input('ghiChu', sql.NVarChar(500), ghiChu || null)
                .input('loaiBienDong', sql.NVarChar(30), movementType);
            const inventoryHistorySql = `
                    UPDATE NGUYENVATLIEU
                    SET tonHienTai = @tonSau
                    WHERE maNVL = @maNVL
                      AND trangThaiXoa = 0;

                    INSERT INTO LICHSUTONKHO (
                        maNVL,
                        loaiBienDong,
                        nguonTacDong,
                        soLuongThayDoi,
                        tonTruoc,
                        tonSau,
                        maThamChieu,
                        ghiChu
                    )
                    VALUES (
                        @maNVL,
                        @loaiBienDong,
                        N'Phiếu hao hụt',
                        -@soLuong,
                        @tonTruoc,
                        @tonSau,
                        @maPhieu,
                        @ghiChu
                    );

                    INSERT INTO CHITIETPHIEUHAOHUT (
                        maPhieuHaoHut,
                        maNVL,
                        soLuong
                    )
                    VALUES (
                        @maPhieu,
                        @maNVL,
                        @soLuong
                    );
                `;
            try {
                console.info('[LOSS_CREATE_SQL_ATTEMPT]', JSON.stringify({
                    ...headerLogContext,
                    stage: 'UPDATE_STOCK_AND_INSERT_HISTORY_AND_DETAIL',
                    maNVL,
                    sql: inventoryHistorySql
                }));
                await insertInventoryHistory(historyRequest, inventoryHistorySql, {
                    api: `${req.method} ${req.originalUrl}`,
                    operation: 'loss.create',
                    maPhieu,
                    maThamChieu: maPhieu,
                    maNVL,
                    loaiBienDong: movementType,
                    soLuongThayDoi: -soLuong,
                    tonTruoc,
                    tonSau
                });
            } catch (error) {
                console.error('[LOSS_CREATE_SQL_FAILED]', JSON.stringify({
                    ...headerLogContext,
                    stage: 'UPDATE_STOCK_AND_INSERT_HISTORY_AND_DETAIL',
                    maNVL,
                    sql: inventoryHistorySql,
                    sqlErrorNumber: error.number ?? null,
                    sqlLineNumber: error.lineNumber ?? null,
                    sqlErrorMessage: error.message
                }));
                throw error;
            }
        }

        try {
            await transaction.commit();
        } catch (error) {
            console.error('[LOSS_CREATE_SQL_FAILED]', JSON.stringify({
                ...headerLogContext,
                stage: 'TRANSACTION_COMMIT',
                sqlErrorNumber: error.number ?? null,
                sqlLineNumber: error.lineNumber ?? null,
                sqlErrorMessage: error.message
            }));
            throw error;
        }

        return res.status(201).json({
            success: true,
            message: 'Tạo phiếu hao hụt thành công!',
            data: {
                maPhieuHaoHut: maPhieu
            }
        });

    } catch (error) {
        if (transaction) {
            await rollbackSafely(transaction);
        }

        console.log('Lỗi tạo phiếu hao hụt:', error.message);

        return res.status(400).json({
            success: false,
            message: error.message || 'Không thể tạo phiếu hao hụt!'
        });
    }
});

// ==========================================
// 5. PUT - SỬA PHIẾU HAO HỤT
// ==========================================

router.put('/:id', async (req, res) => {
    const prepared = prepareSlip(req.body);

    if (prepared.error) {
        return res.status(400).json({
            success: false,
            message: prepared.error
        });
    }

    const {
        ngayHaoHut,
        lyDo,
        ghiChu,
        chiTiet
    } = prepared.data;

    const maPhieu = req.params.id;

    let transaction;

    try {
        const pool = await poolPromise;
        transaction = new sql.Transaction(pool);

        await transaction.begin();

        // Khóa phiếu
        const slipResult = await transaction.request()
            .input('maPhieu', sql.Char(7), maPhieu)
            .query(`
                SELECT *
                FROM PHIEUHAOHUT WITH (UPDLOCK, HOLDLOCK)
                WHERE maPhieuHaoHut = @maPhieu;
            `);

        if (slipResult.recordset.length === 0) {
            throw new Error('Không tìm thấy phiếu hao hụt!');
        }

        const oldSlip = slipResult.recordset[0];

        if (oldSlip.trangThai !== 'Hoàn thành') {
            throw new Error(
                'Chỉ được sửa phiếu hao hụt đang ở trạng thái Hoàn thành!'
            );
        }

        // Kiểm tra ngÃ y
        await transaction.request()
            .input(
                'ngayHaoHut',
                sql.Date,
                new Date(`${ngayHaoHut}T00:00:00.000Z`)
            )
            .query(`
                IF @ngayHaoHut > CONVERT(date, GETDATE())
                    THROW 50003, 'Ngày hao hụt không được lớn hơn ngày hiện tại!', 1;
            `);

        // Lấy chi tiết cÅ©
        const oldDetailResult = await transaction.request()
            .input('maPhieu', sql.Char(7), maPhieu)
            .query(`
                SELECT maNVL, soLuong
                FROM CHITIETPHIEUHAOHUT
                WHERE maPhieuHaoHut = @maPhieu;
            `);

        const oldMap = new Map();

        for (const item of oldDetailResult.recordset) {
            oldMap.set(
                String(item.maNVL).trim(),
                Number(item.soLuong)
            );
        }

        const newMap = new Map();

        for (const item of chiTiet) {
            newMap.set(item.maNVL, item.soLuong);
        }

        // Ghi lịch sử thay đổi thông tin phiếu
        const auditFields = [
            {
                field: 'NgÃ y hao hụt',
                oldValue: formatSqlDate(oldSlip.ngayHaoHut),
                newValue: ngayHaoHut
            },
            {
                field: 'Lý do',
                oldValue: oldSlip.lyDo,
                newValue: lyDo
            },
            {
                field: 'Ghi chú',
                oldValue: oldSlip.ghiChu || '',
                newValue: ghiChu || ''
            }
        ];

        for (const field of auditFields) {
            if (String(field.oldValue) !== String(field.newValue)) {
                await transaction.request()
                    .input('maPhieu', sql.Char(7), maPhieu)
                    .input('truong', sql.NVarChar(100), field.field)
                    .input('giaTriCu', sql.NVarChar(1000), field.oldValue)
                    .input('giaTriMoi', sql.NVarChar(1000), field.newValue)
                    .input('nguoiSua', sql.Char(7), req.auth.maTK)
                    .query(`
                        INSERT INTO LICHSUCHINHSUAPHIEUHAOHUT (
                            maPhieuHaoHut,
                            truongDuocSua,
                            giaTriCu,
                            giaTriMoi,
                            nguoiSua
                        )
                        VALUES (
                            @maPhieu,
                            @truong,
                            @giaTriCu,
                            @giaTriMoi,
                            @nguoiSua
                        );
                    `);
            }
        }

        // Điều chỉnh tồn kho theo chênh lệch
        const allMaterialIds = new Set([
            ...oldMap.keys(),
            ...newMap.keys()
        ]);

        for (const maNVL of allMaterialIds) {
            const oldQty = oldMap.get(maNVL) || 0;
            const newQty = newMap.get(maNVL) || 0;

            // Số lượng tồn kho cần thay đổi
            const delta = oldQty - newQty;

            if (Math.abs(delta) < 0.000001) {
                continue;
            }

            // Ghi lịch sử chỉnh sửa chi tiết phiếu
            await transaction.request()
                .input('maPhieu', sql.Char(7), maPhieu)
                .input('truong', sql.NVarChar(100), `Số lượng NVL ${maNVL}`)
                .input('giaTriCu', sql.NVarChar(1000), String(oldQty))
                .input('giaTriMoi', sql.NVarChar(1000), String(newQty))
                .input('nguoiSua', sql.Char(7), req.auth.maTK)
                .query(`
                    INSERT INTO LICHSUCHINHSUAPHIEUHAOHUT (
                        maPhieuHaoHut,
                        truongDuocSua,
                        giaTriCu,
                        giaTriMoi,
                        nguoiSua
                    )
                    VALUES (
                        @maPhieu,
                        @truong,
                        @giaTriCu,
                        @giaTriMoi,
                        @nguoiSua
                    );
                `);

            const stockResult = await transaction.request()
                .input('maNVL', sql.Char(7), maNVL)
                .query(`
                    SELECT tonHienTai
                    FROM NGUYENVATLIEU WITH (UPDLOCK, ROWLOCK)
                    WHERE maNVL = @maNVL
                      AND trangThaiXoa = 0;
                `);

            if (stockResult.recordset.length === 0) {
                throw new Error(
                    `Không tìm thấy nguyên vật liệu ${maNVL} hoặc nguyên vật liệu đã bị xóa!`
                );
            }

            const tonTruoc = Number(
                stockResult.recordset[0].tonHienTai
            );

            const tonSau = tonTruoc + delta;

            if (tonSau < 0) {
                throw new Error(
                    `Nguyên vật liệu ${maNVL} không đủ tồn kho để cập nhật phiếu!`
                );
            }

            const loaiBienDong =
                delta > 0 ? 'Điều chỉnh' : 'Hao hụt';

            const historyRequest = transaction.request()
                .input('maNVL', sql.Char(7), maNVL)
                .input('delta', sql.Decimal(8, 2), delta)
                .input('tonTruoc', sql.Decimal(8, 2), tonTruoc)
                .input('tonSau', sql.Decimal(8, 2), tonSau)
                .input('loaiBienDong', sql.NVarChar(30), loaiBienDong)
                .input('maPhieu', sql.Char(7), maPhieu)
                .input('ghiChu', sql.NVarChar(500), 'Cập nhật phiếu hao hụt')
            await insertInventoryHistory(historyRequest, `
                    UPDATE NGUYENVATLIEU
                    SET tonHienTai = @tonSau
                    WHERE maNVL = @maNVL
                      AND trangThaiXoa = 0;

                    INSERT INTO LICHSUTONKHO (
                        maNVL,
                        loaiBienDong,
                        nguonTacDong,
                        soLuongThayDoi,
                        tonTruoc,
                        tonSau,
                        maThamChieu,
                        ghiChu
                    )
                    VALUES (
                        @maNVL,
                        @loaiBienDong,
                        N'Phiếu hao hụt',
                        @delta,
                        @tonTruoc,
                        @tonSau,
                        @maPhieu,
                        @ghiChu
                    );
                `, {
                api: `${req.method} ${req.originalUrl}`,
                operation: 'loss.update',
                maPhieu,
                maThamChieu: maPhieu,
                maNVL,
                loaiBienDong,
                soLuongThayDoi: delta,
                tonTruoc,
                tonSau
            });
        }

        // Cập nhật thông tin phiếu
        await transaction.request()
            .input('maPhieu', sql.Char(7), maPhieu)
            .input(
                'ngayHaoHut',
                sql.Date,
                new Date(`${ngayHaoHut}T00:00:00.000Z`)
            )
            .input('lyDo', sql.NVarChar(200), lyDo)
            .input('ghiChu', sql.NVarChar(600), ghiChu || null)
            .query(`
                UPDATE PHIEUHAOHUT
                SET
                    ngayHaoHut = @ngayHaoHut,
                    lyDo = @lyDo,
                    ghiChu = @ghiChu
                WHERE maPhieuHaoHut = @maPhieu;

                DELETE FROM CHITIETPHIEUHAOHUT
                WHERE maPhieuHaoHut = @maPhieu;
            `);

        // Thêm lại chi tiết mới
        for (const item of chiTiet) {
            await transaction.request()
                .input('maPhieu', sql.Char(7), maPhieu)
                .input('maNVL', sql.Char(7), item.maNVL)
                .input('soLuong', sql.Decimal(8, 2), item.soLuong)
                .query(`
                    INSERT INTO CHITIETPHIEUHAOHUT (
                        maPhieuHaoHut,
                        maNVL,
                        soLuong
                    )
                    VALUES (
                        @maPhieu,
                        @maNVL,
                        @soLuong
                    );
                `);
        }

        await transaction.commit();

        return res.status(200).json({
            success: true,
            message: 'Cập nhật phiếu hao hụt thành công!',
            data: {
                maPhieuHaoHut: maPhieu
            }
        });

    } catch (error) {
        if (transaction) {
            await rollbackSafely(transaction);
        }

        console.log('Lỗi sửa phiếu hao hụt:', error.message);

        return res.status(400).json({
            success: false,
            message: error.message || 'Không thể sửa phiếu hao hụt!'
        });
    }
});

// ==========================================
// 6. PATCH - HỦY PHIẾU HAO HỤT
// HoÃ n tồn vÃ  ghi lịch sử biến động ngược
// ==========================================

router.patch('/:id/cancel', async (req, res) => {
    const maPhieu = req.params.id;

    let transaction;

    try {
        const pool = await poolPromise;
        transaction = new sql.Transaction(pool);

        await transaction.begin();

        // Khóa phiếu để không thể hủy hai lần
        const slipResult = await transaction.request()
            .input('maPhieu', sql.VarChar(20), maPhieu)
            .query(`
                SELECT maPhieuHaoHut, trangThai
                FROM PHIEUHAOHUT WITH (UPDLOCK, HOLDLOCK)
                WHERE maPhieuHaoHut = @maPhieu;
            `);

        if (slipResult.recordset.length === 0) {
            throw new Error('Không tìm thấy phiếu hao hụt!');
        }

        const selectedSlipId = String(slipResult.recordset[0].maPhieuHaoHut).trim();
        if (selectedSlipId !== String(maPhieu).trim()) {
            throw new Error('Mã phiếu hao hụt không khớp với phiếu được yêu cầu hủy!');
        }

        if (slipResult.recordset[0].trangThai !== 'Hoàn thành') {
            throw new Error(
                'Phiếu hao hụt đã được hủy hoặc không thể hủy!'
            );
        }

        // Lấy chi tiết phiếu
        const detailResult = await transaction.request()
            .input('maPhieu', sql.VarChar(20), maPhieu)
            .query(`
                SELECT maNVL, soLuong
                FROM CHITIETPHIEUHAOHUT
                WHERE maPhieuHaoHut = @maPhieu;
            `);

        const sourceHistory = await transaction.request()
            .input('maThamChieu', sql.VarChar(20), maPhieu)
            .query(`
                SELECT maNVL, MAX(maLichSu) AS maLichSuGoc
                FROM dbo.LICHSUTONKHO WITH (UPDLOCK, HOLDLOCK)
                WHERE maThamChieu = @maThamChieu
                  AND nguonTacDong IN (N'Phiếu hao hụt', N'Tạo phiếu hao hụt')
                  AND loaiBienDong IN (N'Hao hụt', N'Điều chỉnh')
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
        for (const item of detailResult.recordset) {
            if (!maLichSuGocByMaterial.has(String(item.maNVL).trim())) {
                throw new Error(`Không tìm thấy lịch sử hao hụt gốc của ${String(item.maNVL).trim()} trong phiếu ${maPhieu}.`);
            }
        }

        // HoÃ n tồn kho vÃ  ghi lịch sử
        for (const item of detailResult.recordset) {
            const maNVL = String(item.maNVL).trim();
            const soLuong = Number(item.soLuong);

            // Khóa vÃ  lấy tồn kho hiện tại
            const stockResult = await transaction.request()
                .input('maNVL', sql.Char(7), maNVL)
                .query(`
                    SELECT tonHienTai
                    FROM NGUYENVATLIEU WITH (UPDLOCK, ROWLOCK)
                    WHERE maNVL = @maNVL
                      AND trangThaiXoa = 0;
                `);

            if (stockResult.recordset.length === 0) {
                throw new Error(
                    `Không tìm thấy nguyên vật liệu ${maNVL} hoặc nguyên vật liệu đã bị xóa để hoÃ n tồn!`
                );
            }

            const tonTruoc = Number(
                stockResult.recordset[0].tonHienTai
            );

            const tonSau = tonTruoc + soLuong;

            const movementType = 'Đảo ngược';
            const historyRequest = transaction.request()
                .input('maNVL', sql.Char(7), maNVL)
                .input('soLuong', sql.Decimal(8, 2), soLuong)
                .input('tonTruoc', sql.Decimal(8, 2), tonTruoc)
                .input('tonSau', sql.Decimal(8, 2), tonSau)
                .input('maPhieu', sql.VarChar(20), maPhieu)
                .input('maLichSuGoc', sql.BigInt, maLichSuGocByMaterial.get(maNVL))
                .input(
                    'ghiChu',
                    sql.NVarChar(500),
                    'HoÃ n trả tồn kho khi hủy phiếu'
                )
                .input('loaiBienDong', sql.NVarChar(30), movementType);
            await insertInventoryHistory(historyRequest, `
                    UPDATE NGUYENVATLIEU
                    SET tonHienTai = @tonSau
                    WHERE maNVL = @maNVL
                      AND trangThaiXoa = 0;

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
                        N'Hủy phiếu hao hụt',
                        @soLuong,
                        @tonTruoc,
                        @tonSau,
                        @maPhieu,
                        @ghiChu,
                        @maLichSuGoc
                    );
                `, {
                api: `${req.method} ${req.originalUrl}`,
                operation: 'loss.cancel',
                maPhieu,
                maThamChieu: maPhieu,
                maLichSuGoc: maLichSuGocByMaterial.get(maNVL),
                maNVL,
                loaiBienDong: movementType,
                soLuongThayDoi: soLuong,
                tonTruoc,
                tonSau
            });
        }

        // Cập nhật trạng thái phiếu
        const statusUpdateResult = await transaction.request()
            .input('maPhieu', sql.VarChar(20), maPhieu)
            .query(`
                UPDATE PHIEUHAOHUT
                SET trangThai = N'Đã hủy'
                OUTPUT INSERTED.maPhieuHaoHut, INSERTED.trangThai
                WHERE maPhieuHaoHut = @maPhieu;
            `);

        const updatedSlip = statusUpdateResult.recordset?.[0];
        if (
            !updatedSlip ||
            String(updatedSlip.maPhieuHaoHut).trim() !== String(maPhieu).trim() ||
            String(updatedSlip.trangThai).trim() !== 'Đã hủy'
        ) {
            throw new Error('Không xác nhận được trạng thái hủy phiếu trong cơ sở dữ liệu!');
        }

        await transaction.commit();

        return res.status(200).json({
            success: true,
            message: 'Phiếu hao hụt đã được hủy thành công!',
            data: {
                maPhieuHaoHut: String(updatedSlip.maPhieuHaoHut).trim(),
                trangThai: String(updatedSlip.trangThai).trim()
            }
        });

    } catch (error) {
        if (transaction) {
            await rollbackSafely(transaction);
        }

        console.log('Lỗi hủy phiếu hao hụt:', error.message);

        return res.status(400).json({
            success: false,
            message: error.message || 'Không thể hủy phiếu hao hụt!'
        });
    }
});

module.exports = router;
