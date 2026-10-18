"""Fixed F064b evidence package only. No extraction, replay, network or engine."""
import hashlib
import io
import json
import lzma
import pathlib
import stat
import tarfile
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent
PIN = 'bac8ca269150f2d75d420dad1e16807abe2cf850e6d64d24b7b0963e0589af6a'
LIMIT = 2 * 1024 * 1024

def sha(data):
    return hashlib.sha256(data).hexdigest()

def inventory():
    raw = (ROOT / 'inventory.json').read_bytes()
    assert sha(raw) == PIN
    value = json.loads(raw)
    assert value['version'] == 1 and value['members'] == 164 and value['bytes'] == 1223070
    rows = value['files']
    assert len(rows) == 164 and sum(r['size'] for r in rows) == 1223070
    names = set()
    for row in rows:
        name = row['path']
        path = pathlib.PurePosixPath(name)
        assert not path.is_absolute() and '..' not in path.parts and str(path) == name
        assert name not in names and '\x00' not in name
        assert 0 <= row['size'] <= LIMIT and len(row['sha256']) == 64
        names.add(name)
    return rows

def original(row):
    path = pathlib.Path(row['source'])
    info = path.lstat()
    assert stat.S_ISREG(info.st_mode) and info.st_size == row['size']
    raw = path.read_bytes()
    assert len(raw) == row['size'] and sha(raw) == row['sha256']
    return raw

def main():
    rows = inventory()
    output = pathlib.Path(tempfile.mkdtemp(prefix='agentic-f064b-pack.'))
    archive = output / 'evidence.tar.xz'
    result = {'status': 'running', 'inventorySHA': PIN, 'scriptSHA': sha((ROOT / 'pack.py').read_bytes()),
              'members': 164, 'originalBytes': 1223070, 'archive': str(archive)}
    try:
        with archive.open('xb') as target:
            with tarfile.open(fileobj=target, mode='w:xz', format=tarfile.USTAR_FORMAT, preset=6) as tar:
                for row in rows:
                    raw = original(row)
                    entry = tarfile.TarInfo(row['path'])
                    entry.size = len(raw)
                    entry.mode = 0o644
                    entry.mtime = entry.uid = entry.gid = 0
                    tar.addfile(entry, io.BytesIO(raw))
        # Fixed self-generated preset6 package; expanded limit is not decoder RSS bound.
        with lzma.open(archive, 'rb') as compressed:
            expanded = compressed.read(LIMIT + 1)
            assert len(expanded) <= LIMIT
            assert compressed.read(1) == b''  # full XZ EOF / checksum
        expected = {r['path']: r for r in rows}
        seen = set()
        total = 0
        with tarfile.open(fileobj=io.BytesIO(expanded), mode='r:') as tar:
            for entry in tar:
                assert entry.isfile() and entry.name in expected and entry.name not in seen
                assert not entry.pax_headers and entry.linkname == ''
                row = expected[entry.name]
                assert entry.size == row['size']
                stream = tar.extractfile(entry)
                assert stream is not None
                raw = stream.read(entry.size + 1)
                assert len(raw) == entry.size and sha(raw) == row['sha256']
                total += len(raw)
                assert total <= 1223070
                seen.add(entry.name)
            tail = expanded[tar.offset:]
            assert len(tail) >= 1024 and not any(tail)  # complete zero tar terminator/padding
        assert len(seen) == 164 and total == 1223070
        assert inventory() == rows
        for row in rows:
            original(row)
        packed = archive.read_bytes()
        result.update(status='complete', archiveBytes=len(packed), archiveSHA=sha(packed),
                      expandedTarBytes=len(expanded), verifiedMembers=len(seen), verifiedBytes=total)
    except Exception as error:
        result.update(status='failed', error=repr(error))
        raise
    finally:
        (output / 'pack-receipt.json').write_text(json.dumps(result, indent=2) + '\n')
        print(output)

if __name__ == '__main__':
    main()
