
const cron = require('node-cron');

const {
    sendInventoryAlert
} = require('../services/inventoryAlertService');

let jobStarted = false;

// ==========================================
// TỰ ĐỘNG KIỂM TRA CẢNH BÁO MỖI PHÚT
// ==========================================

function startInventoryAlertJob() {
    // Tránh khởi động lịch kiểm tra nhiều lần.
    if (jobStarted) {
        return;
    }

    jobStarted = true;

    console.log('Đã khởi động hệ thống kiểm tra cảnh báo tồn kho.');
    console.log('Tần suất kiểm tra: Mỗi phút.');

    cron.schedule(
        '* * * * *',
        async () => {
            console.log('\nĐang kiểm tra cảnh báo tồn kho...');

            try {
                await sendInventoryAlert();
            } catch (error) {
                console.error(
                    'Lỗi kiểm tra hoặc gửi email cảnh báo:',
                    error.message
                );
            }
        },
        {
            timezone: 'Asia/Ho_Chi_Minh'
        }
    );
}

module.exports = {
    startInventoryAlertJob
};
