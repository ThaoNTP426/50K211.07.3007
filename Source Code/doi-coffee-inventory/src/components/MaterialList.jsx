import { useStore } from '../store.jsx';

function MaterialList() {
    const { materials, materialsLoading, materialsError } = useStore();

    if (materialsLoading) return <p>Đang tải nguyên vật liệu từ SQL Server...</p>;

    if (materialsError) return <p style={{ color: 'red' }}>{materialsError}</p>;

    return (
        <div style={{ padding: '20px' }}>
            <h2>Danh sách nguyên vật liệu</h2>

            <p>Tổng số: {materials.length} nguyên vật liệu</p>

            <table border="1" cellPadding="10">
                <thead>
                    <tr>
                        <th>Mã NVL</th>
                        <th>Tên nguyên vật liệu</th>
                        <th>Nhóm</th>
                        <th>Đơn vị tính</th>
                        <th>Tồn hiện tại</th>
                        <th>Tồn tối thiểu</th>
                    </tr>
                </thead>

                <tbody>
                    {materials.map((item) => (
                        <tr key={item.maNVL}>
                            <td>{item.id}</td>
                            <td>{item.name}</td>
                            <td>{item.group}</td>
                            <td>{item.unit}</td>
                            <td>{item.stock}</td>
                            <td>{item.min}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export default MaterialList;
