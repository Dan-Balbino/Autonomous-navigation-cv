"""Gera a versão web do carro (models/car.glb) a partir de 3DModel/base_basic_pbr.glb.

Reduz as três texturas PBR de 2048 para 1024 px e as grava em JPEG, sem mexer na malha.
O arquivo original fica intocado. Uso: python tools/optimize_car.py [entrada] [saída] [lado]
"""
import io
import json
import struct
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / '3DModel' / 'base_basic_pbr.glb'
DST = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / 'models' / 'car.glb'
SIDE = int(sys.argv[3]) if len(sys.argv) > 3 else 1024
QUALITY = {'texture_normal': 92}  # normal map sofre mais com artefatos de JPEG


def read_glb(path):
    data = path.read_bytes()
    json_len = struct.unpack('<I', data[12:16])[0]
    gltf = json.loads(data[20:20 + json_len])
    bin_start = 20 + json_len + 8
    bin_len = struct.unpack('<I', data[20 + json_len:24 + json_len])[0]
    return gltf, data[bin_start:bin_start + bin_len]


def write_glb(path, gltf, binary):
    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    binary += b'\0' * (-len(binary) % 4)
    total = 12 + 8 + len(js) + 8 + len(binary)
    out = struct.pack('<III', 0x46546C67, 2, total)
    out += struct.pack('<II', len(js), 0x4E4F534A) + js
    out += struct.pack('<II', len(binary), 0x004E4942) + binary
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(out)


def main():
    gltf, binary = read_glb(SRC)
    image_views = {img['bufferView']: img for img in gltf.get('images', [])}
    chunks, views = [], []
    offset = 0
    for index, view in enumerate(gltf['bufferViews']):
        start = view.get('byteOffset', 0)
        blob = binary[start:start + view['byteLength']]
        if index in image_views:
            img = image_views[index]
            pic = Image.open(io.BytesIO(blob)).convert('RGB')
            if max(pic.size) > SIDE:
                pic = pic.resize((SIDE, SIDE), Image.LANCZOS)
            buf = io.BytesIO()
            pic.save(buf, 'JPEG', quality=QUALITY.get(img.get('name'), 85), optimize=True)
            blob = buf.getvalue()
            img['mimeType'] = 'image/jpeg'
        pad = -offset % 4
        chunks.append(b'\0' * pad)
        offset += pad
        new_view = dict(view, byteOffset=offset, byteLength=len(blob))
        views.append(new_view)
        chunks.append(blob)
        offset += len(blob)
    gltf['bufferViews'] = views
    gltf['buffers'] = [{'byteLength': offset}]
    write_glb(DST, gltf, b''.join(chunks))
    print(f'{SRC.name} {SRC.stat().st_size / 1e6:.1f} MB -> {DST} {DST.stat().st_size / 1e6:.2f} MB')


if __name__ == '__main__':
    main()
