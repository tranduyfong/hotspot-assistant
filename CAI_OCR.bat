@echo off
cd /d "%~dp0"
python -m venv .venv
if errorlevel 1 goto failed
.venv\Scripts\python.exe -m pip install -r requirements-ocr.txt
if errorlevel 1 goto failed
.venv\Scripts\python.exe scripts\ocr_worker.py --download
if errorlevel 1 goto failed
echo Da cai OCR. Mo CHAY_TOOL.bat de tiep tuc.
pause
exit /b 0
:failed
echo Chua cai xong OCR. Kiem tra Python 64-bit va ket noi mang.
pause
exit /b 1
