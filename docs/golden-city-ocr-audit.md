# Kiểm tra OCR Golden City — 12/11/2026

## Nguyên nhân và thay đổi

1. **Ảnh cắt không khớp gốc tọa độ.** Sharp thực hiện `extract` trước `composite` trong cùng pipeline. Vùng ảnh thực tế bắt đầu ở biên tile, trong khi metadata dùng gốc vùng cắt. Ở hai ảnh đã kiểm tra, sai lệch lần lượt là `(194, 391)` và `(338, 408)` pixel, đúng bằng phần dư gốc ảnh chia cho kích thước tile 512. Đã sửa thành ghép ảnh → buffer → cắt ảnh và thêm kiểm thử biên tile.
2. **Mặt nạ màu vàng nối nhiều căn thành cả dãy.** Việc chuyển tâm chữ sang trọng tâm vùng vàng có thể đẩy nhiều mã về cùng một điểm. Ví dụ `ĐLBM-06` lệch khoảng 241 pixel; có trường hợp hơn 435 pixel. Golden City hiện dùng tâm hộp chữ; dự án khác chỉ chấp nhận vùng màu nhỏ, gần tâm chữ.
3. **Chữ nhỏ, nghiêng và nền nhiều màu.** Golden City được chia vùng 1.200 pixel, chồng lấn 160 pixel, tăng tương phản CLAHE, phóng đại và đọc nhiều góc. Quy đổi ngược hộp chữ về ảnh gốc sau xoay. Chỉ giữ mã khớp chính xác danh mục; không tự đổi O thành 0 hay bỏ số 0 đầu.
4. **Mốc hotspot không nhất thiết nằm ở tâm chữ.** Nhiều mốc đã gắn đúng nằm gần cạnh căn. Không dùng khoảng cách từ mốc đến chữ để kết luận mốc sai, cũng không dùng chúng để nắn tọa độ ảnh. Sau khi sửa ảnh cắt, phép chiếu mặt phẳng đã khớp với VHUB.

Scan và vị trí cũ được giữ trên đĩa nhưng không dùng lại để gắn. Phiên bản dữ liệu tọa độ hiện tại là `ocrVersion: 3`; cần dò và ghi nhớ lại các vị trí cũ. Hotspot đã có trên VHUB không bị di chuyển.

## Thử nghiệm tiền xử lý

Tham khảo [bài Viblo về tiền xử lý OCR](https://viblo.asia/p/cach-cai-thien-do-chinh-xac-cua-ket-qua-ocr-bang-cac-ky-thuat-tien-xu-ly-anh-BQyJK377JMe), [hướng dẫn tăng độ chính xác trên easyocr.org](https://easyocr.org/en/help/ocr-accuracy-improvement) và [tài liệu tham số thư viện EasyOCR](https://www.jaided.ai/easyocr/documentation/).

Áp dụng tăng tương phản, giữ độ phân giải chữ, chia ảnh có chồng lấn và xoay ảnh. Đã thử nhị phân hóa thích nghi trên cùng vùng BM: CLAHE cho 514 kết quả, 46 mã có trong danh mục và 21 căn đang chờ; nhị phân hóa cho 133 kết quả, 11 mã danh mục và 5 căn đang chờ. Vì vậy chọn CLAHE làm mặc định, giữ nhị phân hóa làm tùy chọn thử nghiệm. Đây là phép so sánh độ bao phủ trên một vùng, chưa phải tỷ lệ chính xác của toàn dự án.

## Sai số đo trên VHUB

Đối chiếu ảnh gốc với ảnh màn hình VHUB bằng SIFT/RANSAC, độc lập với vị trí hotspot. Tập điểm kiểm tra lấy mỗi điểm thứ ba sau khi lọc inlier; không dùng tập này trong bước khớp cuối. Vì inlier đã được sàng lọc trước trên toàn tập, các số dưới đây là độ khớp hình ảnh có điều kiện, không phải đánh giá mù.

| Vùng | Điểm khớp | Điểm kiểm tra | RMS kiểm tra (pixel gốc) | Phân vị 95% (pixel gốc) |
|---|---:|---:|---:|---:|
| Bình Minh | 1.820 | 607 | 0,397 | 0,713 |
| Ánh Sao | 2.203 | 735 | 0,267 | 0,428 |

Tại điểm đối chiếu của từng vùng, phép chiếu phẳng và phép khớp ảnh khác nhau khoảng 0,039 và 0,023 pixel. **Đây là sai số căn chỉnh tọa độ ảnh, không phải độ chính xác đọc mã hoặc ranh giới thửa.**

Mỗi căn mới chỉ được gắn sau khi đối chiếu mã in trên ảnh. Khi lưu, driver kiểm tra nháp đúng mã, đúng vị trí, rồi đọc lại từ máy chủ; tọa độ phải nằm trong ngưỡng 3 pixel gốc.

## Tái hiện và dữ liệu kiểm tra

- `npm.cmd run check`: 12 kiểm thử Node, có hồi quy ảnh cắt lệch biên tile.
- `.venv\Scripts\python.exe -B -m unittest discover -s tests -p test_ocr.py`: 8 kiểm thử Python, gồm vùng màu nối cả dãy và chia ảnh chồng lấn.
- `npm.cmd run test:e2e`: thao tác gắn/lưu trên fixture, chặn mạng; không ghi dữ liệu thật.
- `scripts/audit-golden.mjs`: đọc danh mục và toàn ảnh, chạy OCR ban đầu; không ghi VHUB.
- `scripts/rescan-golden.mjs ANGLE`: OCR bổ sung trên ảnh đã tải.
- `scripts/review-golden.mjs`: tổng hợp kết quả, giữ riêng các mã có nhiều vị trí và tạo ảnh để đối chiếu.
- `scripts/apply-reviewed-golden.mjs N`: **ghi thật** tối đa N căn có trong danh sách đã đối chiếu; bỏ qua căn không còn chờ. Chỉ chạy khi đã kiểm tra các ảnh tương ứng.
- `lib/registration.mjs`, `scripts/register_image.py`: công cụ chẩn đoán độ khớp ảnh; không nằm trong luồng gắn căn thông thường.

Ảnh, danh mục, ảnh đối chiếu, kết quả từng góc và biên nhận lưu nằm trong `.data/run/golden-audit/`; phép đo căn chỉnh nằm trong `.data/run/corrected-validation.json`. Các tệp này là dữ liệu cục bộ, không đóng gói vào mã nguồn.

Việc rà soát toàn bộ danh mục đang tiếp tục. Danh mục VHUB có thể thay đổi trong phiên; cần báo riêng số căn do lượt kiểm tra này lưu và số căn đã có từ trước, không suy ra thành tích OCR từ chênh lệch tổng hotspot.
