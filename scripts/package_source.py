"""Package source only: never include browser profiles, cached images or user data."""
import hashlib
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
files = [root / name for name in (
    'package.json', 'package-lock.json', '.gitignore', 'README.md', 'THIRD_PARTY.md',
    'server.mjs', 'requirements-ocr.txt', 'CHAY_TOOL.bat', 'CAI_OCR.bat',
)]
for directory in ('lib', 'public', 'scripts', 'tests'):
    files.extend(p for p in (root / directory).rglob('*')
                 if p.is_file() and '__pycache__' not in p.parts and p.suffix != '.pyc')
target = root / 'dist' / 'VHUB_Hotspot_Assistant_v0.1.zip'
target.parent.mkdir(exist_ok=True)
with ZipFile(target, 'w', ZIP_DEFLATED) as archive:
    for path in sorted(files):
        archive.write(path, Path('vhub-hotspot-assistant') / path.relative_to(root))
with ZipFile(target) as archive:
    assert archive.testzip() is None
    assert not any('/.data/' in name or '/node_modules/' in name for name in archive.namelist())
print(f'{target}\n{len(files)} files; {target.stat().st_size:,} bytes\nSHA256: {hashlib.sha256(target.read_bytes()).hexdigest()}')
