# VHUB Hotspot Assistant v0.1

Tool Windows hỗ trợ công việc gắn mã căn lên mặt bằng VHUB. Tool hiện hỗ trợ **VINHOMES SÀI GÒN PARK** và **VINHOMES GOLDEN CITY**; scene và thông số ảnh được đọc từ dự án đang chọn.

Tool đọc danh sách căn còn hàng chưa gắn, tìm mốc cùng dãy, tải vùng ảnh mặt bằng gốc, nhận diện mã bằng OCR cục bộ và lưu vị trí đã được người dùng xác nhận. Có thể gắn từ 1 tới 50 căn một lượt. Tool kiểm tra kết quả thực tế để nhận biết VHUB tạo nháp hay lưu ngay; với nháp, xem lại các tag rồi bấm Lưu lên VHUB.

## Chạy trên máy hiện tại

1. Mở **CHAY_TOOL.bat** trong thư mục này. Cần Node.js 24 trở lên và Microsoft Edge. Lần đầu file chạy tự cài thư viện Node nếu chưa có.
2. Giao diện mở tại **http://127.0.0.1:4318**. Giữ cửa sổ lệnh đang chạy tool.
3. Chọn dự án ở thanh trên cùng rồi bấm **Kết nối & đồng bộ**. Nếu được yêu cầu, tự đăng nhập tài khoản có quyền Quản lý hotspot trong cửa sổ Edge rồi kết nối lại.

Tool ưu tiên kết nối cửa sổ Edge đã mở trong buổi làm việc qua cổng cục bộ `9228`. Nếu không có cửa sổ này, tool mở Edge riêng và giữ phiên đăng nhập trong `.data/browser-profile`.

Máy phát triển hiện đã có Python và mô hình OCR trong dự án Parcel Studio kế bên. Tool tự phát hiện và dùng trình thông dịch/mô hình đó; không sửa dự án cũ và không mở dữ liệu của nó. Để cài OCR riêng cho dự án mới hoặc khi chuyển sang máy khác, chạy **CAI_OCR.bat**. Cần Python 64-bit và Internet khi cài, tải mô hình lần đầu. Khi mô hình đã có, nhận diện chạy cục bộ, không dùng API AI trả phí.

Có thể đặt `OCR_PYTHON` tới Python đã cài `requirements-ocr.txt`, `OCR_MODELS` tới thư mục có `craft_mlt_25k.pth` và `latin_g2.pth`. Nếu chưa có OCR, vẫn dùng được **Chỉ lấy ảnh** và chọn đúng ô trực tiếp.

## Quy trình hằng ngày

1. **Đồng bộ lại** để lấy đủ các trang sản phẩm và hotspot. Danh sách bên trái chỉ chứa sản phẩm còn hàng, không ẩn và chưa có hotspot trong scene hiện tại.
2. Chọn một căn, bấm **Dò mã**. Tool tìm các mốc cùng dãy, ví dụ `AS76-09` chỉ dùng mốc dãy `AS76`, không nhầm sang `AS7` hay `AS760`.
3. Đọc mã trên vùng ảnh. Tool đánh dấu các kết quả OCR khớp chính xác mã đang chọn. Có thể đổi mốc, tăng vùng ảnh hoặc bấm **Chỉ lấy ảnh**. Nếu chưa có mốc, tự di chuyển bản đồ tới khu vực đó rồi bấm **Lấy vùng đang xem trên VHUB**.
4. Bấm đúng điểm trong ô đất nếu cần chỉnh; thanh zoom và thanh cuộn giúp đọc chữ. Có thể dùng phím mũi tên chỉnh điểm, Shift + mũi tên chỉnh nhanh.
5. Đối chiếu mã và ô đất trên ảnh, chỉnh điểm nếu cần rồi bấm **Ghi nhớ vị trí**; không cần nhập lại mã căn. Việc này lưu tọa độ trên máy, chưa gắn hoặc lưu gì trên VHUB.
6. Bấm **Đặt nháp căn này**, hoặc chọn các căn đã xác nhận rồi bấm **Đặt nháp**. Tool đóng bảng chi tiết và bấm **Bỏ chọn** dưới ô tìm kiếm trước khi đặt, để tag mới hiện ngay. Điểm cần gắn được đưa ra phần mặt bằng không bị bảng quản lý che. Giao diện tự đưa tab VHUB lên trước để xem lại.
7. Quay lại tab tool, kiểm tra các tag, rồi bấm **Lưu lên VHUB**. Tool kiểm tra lại từng mã, vị trí nháp, gửi lưu bằng nút gốc và đọc lại dữ liệu máy chủ để xác nhận cả mã lẫn tọa độ.

**Dò mã đã chọn** hỗ trợ tối đa 50 căn một lượt, chỉ đọc ảnh. Các căn khác nằm trong cùng vùng đã OCR sẽ được dùng lại từ bộ nhớ đệm. **Đặt nháp** hỗ trợ tối đa 50 căn đã xác nhận một lượt.

Chỉ dùng một lượt điều khiển tại một thời điểm. Trong khi tool đang đặt nháp/lưu, để tool thao tác trên cửa sổ VHUB. Có thể dừng việc dò ảnh bằng **Dừng dò mã**.

Trên Golden City, dòng “Dữ liệu lưu lên server khi thao tác” của VHUB vẫn có thể xuất hiện khi đang tạo nháp. Tool dựa vào nháp và phản hồi máy chủ để xác nhận chế độ. Nút gắn sẽ cập nhật theo chế độ đã xác minh; khi VHUB lưu ngay, tool đọc lại từng mã và tọa độ sau khi gắn.

Ảnh ghép được cắt sau khi hoàn tất ghép các ô ảnh để giữ đúng tọa độ gốc. Các ảnh và vị trí đã ghi nhớ bằng bản trước sửa lỗi này cần được dò và xác nhận lại. OCR hỗ trợ chữ xoay dọc, viền ô đất mảnh/đứt nét và ô góc màu hồng; kết quả vẫn cần được đối chiếu trên ảnh trước khi ghi nhớ.

## Dữ liệu và khôi phục

- `.data/store.json`: vị trí đã xác nhận và nhật ký. Có nút **Sao lưu vị trí** để xuất bản JSON đọc được.
- `.data/scans/`: vùng ảnh và kết quả OCR đã đọc; dùng lại sau khi mở tool lần sau.
- `.data/tiles/`: ảnh nhỏ được tải để ghép vùng xem trước.
- `.data/browser-profile/`: profile của cửa sổ Edge do tool tự mở, nếu có.
- Các thư mục trên đều nằm trong `.gitignore`; gói mã nguồn không kèm phiên đăng nhập hay dữ liệu dự án.

Vị trí gắn với tour, scene, thông số ảnh và dấu vân tay ảnh tổng quan. Khi các dữ liệu này đổi, đồng bộ lại sẽ không dùng các vị trí của phiên bản cũ. Nếu biết nội dung bản đồ đã được sửa, vẫn cần rà soát lại các vị trí đã ghi nhớ: bản đầu chưa theo dõi riêng phiên bản của mọi ô ảnh trên máy chủ. Chỉ số phần trăm OCR là độ tin cậy của bộ nhận diện, không phải bảo đảm ô đất đúng; cần đối chiếu chữ và ô trước khi ghi nhớ.

Nếu trên VHUB đang có bản nháp ngoài tool, tool yêu cầu xử lý chúng trước. Nếu đóng tool giữa một lượt đặt nháp, xử lý bản nháp còn lại trực tiếp trên VHUB rồi mở tool và đồng bộ lại. Nếu lưu bị mất kết nối, kiểm tra trên VHUB rồi **Đồng bộ lại**, không gửi lưu lặp lại. Tool không xóa hay gắn lại các hotspot đã có.

## Phạm vi và giới hạn bản đầu

- Đã kiểm tra trực tiếp: đọc đủ **140 căn chờ gắn**, **806 hotspot sản phẩm** trong phiên thử; đọc được **127 nhãn mã** trong vùng AS76, gồm đúng `AS76-09`.
- Có mã hotspot bị trùng sẵn trong dữ liệu (`TL1-30` lúc kiểm tra). Tool giữ nguyên bản ghi và loại các mốc trùng khỏi gợi ý định vị.
- Chưa đánh giá độ chính xác OCR trên toàn bộ dự án. Không tự suy diễn chữ O thành số 0, bỏ số 0 đầu hay gắn theo tên gần giống.
- Bản đầu hỗ trợ ảnh mặt bằng phẳng không xoay nguồn, giao diện VHUB tiếng Việt và Edge trên Windows. Chưa hỗ trợ tạo vị trí từ cảnh 360 hoặc cao tầng 3D.
- Nếu OCR không đọc được mã, có thể chọn đúng vị trí trực tiếp trên ảnh. Chưa tự gắn các kết quả OCR chưa được xác nhận.
- Toàn bộ kiểm tra phát triển của dự án mới dùng đọc thật và ghi mô phỏng; không tạo thêm hotspot thật trong các bài kiểm tra tự động.

## Phát triển và kiểm tra

```powershell
npm.cmd install
npm.cmd run check
npm.cmd run test:e2e
npm.cmd start
```

`npm run check` kiểm tra mã, tọa độ, lọc sản phẩm, xác nhận vị trí, lưu dữ liệu và quyền sở hữu nháp. `test:e2e` mở Edge headless riêng, chặn toàn bộ mạng và mô phỏng đặt/lưu nhiều căn; không ghi lên VHUB thật.

Khi đọc lại tọa độ, tool cho phép sai số tối đa 3 pixel trên ảnh gốc do thao tác click/render; vị trí di chuyển quá ngưỡng sẽ dừng lưu để kiểm tra.

`node scripts/smoke-live.mjs --sync --scan` dùng Edge đang đăng nhập để kiểm tra đồng bộ và OCR thật. Script này chỉ đọc, không bấm Gắn hoặc Lưu. Giao diện cần đang chạy tại cổng 4318.

Kiểm tra tách mã OCR: `python -m unittest discover -s tests -p test_ocr.py`.

Đóng gói mã nguồn: `python scripts/package_source.py`. File ZIP trong `dist` không chứa `.data`, `node_modules`, mô hình hay phiên đăng nhập. Khi chuyển sang máy khác, chạy `CHAY_TOOL.bat` để cài thư viện Node và `CAI_OCR.bat` để cài OCR riêng.

Có thể đặt biến môi trường `PORT` nếu cổng 4318 đang được dùng. Tool chỉ nghe tại `127.0.0.1`; giao diện gọi thao tác bằng khóa ngẫu nhiên mỗi lần khởi động. Mật khẩu và header đăng nhập không được ghi vào dữ liệu vị trí, nhật ký hay gói nguồn.

Công nghệ: Node.js, Playwright, Sharp, EasyOCR và OpenCV. Xem [THIRD_PARTY.md](THIRD_PARTY.md).
#   h o t s p o t - a s s i s t a n t  
 
