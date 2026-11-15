
const sql = require('mssql/msnodesqlv8');

const config = {
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,

    // Chỉ định ODBC Driver đã cài trên máy
    driver: 'ODBC Driver 17 for SQL Server',

    options: {
        trustedConnection: true,
        trustServerCertificate: true
    }
};

const poolPromise = new sql.ConnectionPool(config)
    .connect()
    .then(pool => {
        console.log('Da ket noi SQL Server thanh cong!');
        return pool;
    })
    .catch(error => {
        console.log('Loi ket noi SQL Server:', error.message);
        throw error;
    });

module.exports = {
    sql,
    poolPromise
};
