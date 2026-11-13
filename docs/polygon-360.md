# Lấy cụm tag đã gắn trên 2D và đặt lên 360

Mở http://127.0.0.1:4318/mapping và kết nối dự án. Các tag đã gắn trên bản đồ 2D hiện ngay trên ảnh nguồn.

Tag được hiển thị bằng chấm nhỏ trên 2D và lớp xem trước 360. Rê chuột lên chấm để xem mã căn.

Khung trái luôn có nền **toàn bộ bản đồ**, cùng lớp ảnh nét ở vùng đã tải. Bấm **Toàn bản đồ** để thu vừa toàn cảnh; **Phóng rộng** để mở lớn khung 2D (Esc để thu gọn). Zoom hoặc di chuyển tới vùng cần đọc rồi bấm **Tải nét vùng đang xem**. Có thể khoanh tag và chấm mốc trên toàn bản đồ, kể cả ngoài vùng ảnh chi tiết.

1. Chọn **Khoanh cụm tag**, bấm các đỉnh quanh những tag muốn lấy, rồi **Khép vùng chọn**.
2. Bấm **Lấy cụm tag**. Chỉ các tag đã có vị trí trên VHUB 2D nằm trong vùng khoanh được lấy. Có thể bỏ chọn từng tag trong danh sách.
3. Chọn **Chấm mốc**: bấm một điểm trên **2D**, rồi cùng vị trí trên **360** để ghép thành một cặp. Hai khung đánh cùng số mốc. Sau ít nhất **4 cặp mốc không thẳng hàng**, công cụ tự khớp cả cụm tag. Nên chấm mốc trải đều quanh cụm; có thể sửa vị trí hoặc ghép lại trong bảng mốc.
4. Chỉnh **Dịch X/Y**, **Xoay 2D**, **Tỷ lệ** hoặc yaw/pitch/roll để căn cả cụm. Khi bật **Cập nhật khi căn chỉnh**, chấm di chuyển realtime ngay trên ảnh 360 tại ứng dụng local. Bước này không gửi yêu cầu chụp ảnh hay chuyển sang tab VHUB. Ảnh nền giữ yên để dễ so sánh.
5. **Lưu profile trên máy** để giữ cụm và vị trí đặt; **Đồng bộ nhóm căn lên VHUB** để lưu vị trí các tag sản phẩm.

Để xem các chấm xanh trong trình xem VHUB thật, bấm **Demo trực tiếp trên VHUB**. Nút này tạo lớp runtime tạm và mở tab VHUB đang kết nối; chưa ghi dữ liệu lên máy chủ. **Ẩn lớp xem trước** xóa lớp tạm. Khi quay lại local, các thanh chỉnh vẫn cập nhật realtime tại khung local; bấm demo lần nữa nếu muốn cập nhật lớp trên VHUB.

Nếu muốn đặt cụm bằng tay, chọn **Khoanh cụm tag** rồi bấm một vị trí trên 360. Khi chuyển sang chấm mốc thật, các điểm đặt tự sinh của cách thủ công được loại bỏ. Luồng này chỉ lấy các tag đã có trên 2D.

Sai số mốc tính được hiển thị trong bảng. Muốn kiểm chứng độc lập, chọn **Mốc mới → Kiểm tra** và chấm các vị trí khác mốc tính; những mốc này không tham gia khớp mô hình. Với profile hiệu chuẩn, đồng bộ thật vẫn cần ít nhất 3 mốc kiểm tra đạt ngưỡng. Preview trong ứng dụng không cần bước này.

Khi đồng bộ, tool đọc đối chiếu từng vị trí đã tạo. Các tag đã có vị trí khác trên 360 được báo trong danh sách bỏ qua; phiên bản này chưa ghi đè vị trí có sẵn. Cần đăng nhập VHUB bằng tài khoản có quyền ghi để đồng bộ thật.

Lăn chuột để zoom ảnh 2D, Alt + kéo để di chuyển. Các nút mũi tên và phóng to/thu nhỏ điều khiển góc nhìn 360. Sau khi xoay trực tiếp trong tab VHUB, bấm **Lấy ảnh mới** trước khi đặt cụm.

Profile lưu trong `.data/mapping/profiles/`; mỗi profile thuộc một dự án, bản đồ và cảnh 360 cụ thể. Tối đa 1.000 tag mỗi nhóm. Profile hiệu chuẩn và polygon từ phiên bản cũ vẫn đọc được riêng; chúng không phải luồng đặt cụm tag bằng tay.

Kiểm tra: `npm.cmd run check` và `npm.cmd run test:e2e`.
