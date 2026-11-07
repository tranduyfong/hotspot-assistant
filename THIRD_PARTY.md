# Thư viện

Các thư viện được cài bằng npm/pip, không chép mã từ những dự án cũ trong workspace.

| Thư viện | Mục đích | Nguồn / giấy phép |
| --- | --- | --- |
| Playwright | Điều khiển Edge, đọc dữ liệu và kiểm tra giao diện | https://github.com/microsoft/playwright — Apache-2.0 |
| Sharp | Ghép các ô ảnh thành vùng mặt bằng nhỏ | https://github.com/lovell/sharp — Apache-2.0 |
| EasyOCR | Đọc nhãn mã trên ảnh cục bộ | https://github.com/JaidedAI/EasyOCR — Apache-2.0 |
| OpenCV | Xử lý góc chữ, tìm ô đất theo màu | https://github.com/opencv/opencv — Apache-2.0 ở các phiên bản hiện hành |
| PyTorch | Chạy mô hình của EasyOCR | https://github.com/pytorch/pytorch — BSD-style |

Ảnh mặt bằng và dữ liệu VHUB được đọc từ phiên của người dùng, lưu cục bộ trong `.data`, không kèm trong gói mã nguồn.
