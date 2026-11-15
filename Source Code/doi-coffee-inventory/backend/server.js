
require('dotenv').config();

const express = require('express');
const cors = require('cors');

const { poolPromise } = require('./config/database');

const materialRoutes = require('./routes/materialRoutes');
const receiptRoutes = require('./routes/receiptRoutes');
const recipeRoutes = require('./routes/recipeRoutes');
const supplierRoutes = require('./routes/supplierRoutes');
const lossRoutes = require('./routes/lossRoutes');
const posRoutes = require('./routes/posRoutes');
const inventoryHistoryRoutes = require('./routes/inventoryHistoryRoutes');
const stockAdjustmentRoutes = require('./routes/stockAdjustmentRoutes');
const { router: authRoutes, authenticate } = require('./routes/authRoutes');

// Import chức năng gửi email cảnh báo tồn kho
const {
    startInventoryAlertJob
} = require('./jobs/inventoryAlertJob');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Khai báo các API
app.use('/api/auth', authRoutes);
app.use('/api', authenticate);
app.use('/api/materials', materialRoutes);
app.use('/api/receipts', receiptRoutes);
app.use('/api/recipes', recipeRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/losses', lossRoutes);
app.use('/api/pos', posRoutes);
app.use('/api/inventory-history', inventoryHistoryRoutes);
app.use('/api/inventory-adjustments', stockAdjustmentRoutes);

// Keep API failures in JSON format instead of Express/Vite HTML error pages.
app.use('/api', (req, res) => {
    res.status(404).json({
        success: false,
        message: `Khong tim thay API: ${req.method} ${req.originalUrl}`
    });
});

app.use((error, req, res, next) => {
    if (!req.path.startsWith('/api')) return next(error);
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600
        ? error.status
        : 400;
    return res.status(status).json({
        success: false,
        message: status === 400 ? 'Yeu cau API khong hop le.' : 'Loi xu ly API.'
    });
});

// Trang kiểm tra Backend
app.get('/', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'Backend Doi Coffee dang hoat dong!'
    });
});

// Kiểm tra kết nối SQL Server
app.get('/api/test-db', async (req, res) => {
    try {
        const pool = await poolPromise;

        const result = await pool.request().query(
            'SELECT DB_NAME() AS databaseName'
        );

        res.status(200).json({
            success: true,
            message: 'Ket noi SQL Server thanh cong!',
            database: result.recordset[0].databaseName
        });

    } catch (error) {
        console.log('Loi truy van Database:', error.message);

        res.status(500).json({
            success: false,
            message: 'Khong the ket noi SQL Server!',
            error: error.message
        });
    }
});

// Khởi chạy Backend
app.listen(PORT, () => {
    console.log('================================');
    console.log('BACKEND DOI COFFEE');
    console.log(`Server: http://localhost:${PORT}`);
    console.log('================================');

    // Khởi động lịch gửi email cảnh báo lúc 08:00 mỗi ngày
    startInventoryAlertJob();
});
