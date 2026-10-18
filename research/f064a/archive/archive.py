"""Prepare immutable stage packages in a NEW temp folder. Requires separate approval.

No extraction, migration to repository, source rewrite, or content deduplication.
Fixed self-produced preset6 XZ only; expansion bounds are not decoder RSS limits.
600s cooperative checks bound loops, not a hard bound on a blocked filesystem call.
"""
import lzma
import resource
import hashlib
import json
import pathlib
import sys
import tarfile
import tempfile
import time
from freeze import sha

ROOT = pathlib.Path(__file__).resolve().parent


class BoundedReader:
    def __init__(self, stream, limit, deadline, payload_end):
        self.stream, self.limit, self.deadline, self.count = stream, limit, deadline, 0
        self.payload_end = payload_end

    def read(self, size=-1):
        assert time.monotonic() < self.deadline, 'DEADLINE'
        if size < 0:
            size = 65536
        data = self.stream.read(min(size, 65536))
        tail_offset = max(0, self.payload_end - self.count)
        assert not any(data[tail_offset:]), 'NONZERO_TAR_PADDING'
        self.count += len(data)
        assert self.count <= self.limit, 'EXPANDED_BYTES'
        return data


def main():
    assert len(sys.argv) == 3 and sys.argv[1] == 'pack', 'EXPLICIT_PACK_AND_INVENTORY_SHA'
    data = (ROOT / 'inventory.json').read_bytes()
    assert hashlib.sha256(data).hexdigest() == sys.argv[2], 'INVENTORY_SHA'
    inventory = json.loads(data)
    rows = inventory['files']
    assert inventory['count'] == len(rows) and inventory['bytes'] == sum(r['bytes'] for r in rows)
    assert len({r['member'] for r in rows}) == len(rows)
    for row in rows:
        path = pathlib.PurePosixPath(row['member'])
        assert not path.is_absolute() and '\x00' not in row['member']
        assert all(p not in ('', '.', '..') for p in row['member'].split('/'))
        assert path.parts[0] == row['stage'] and row['stage'] in inventory['stages']
    output = pathlib.Path(tempfile.mkdtemp(prefix='agentic-f064a-archives.'))
    started = time.monotonic()
    cpu_started = time.process_time()
    deadline = started + 600
    result = {'complete': False, 'inventorySHA': sys.argv[2], 'packages': [],
              'sourceSHA': sha(pathlib.Path(__file__))[1], 'freezeSourceSHA': sha(ROOT / 'freeze.py')[1]}
    try:
        for stage, summary in inventory['stages'].items():
            selected = [r for r in rows if r['stage'] == stage]
            assert summary == {'count': len(selected), 'bytes': sum(r['bytes'] for r in selected)}
            package = output / (stage + '.tar.xz')
            with package.open('xb') as raw, lzma.LZMAFile(raw, mode='wb', format=lzma.FORMAT_XZ, preset=6) as compressed:
                with tarfile.open(fileobj=compressed, mode='w|', format=tarfile.USTAR_FORMAT) as archive:
                    for row in selected:
                        assert time.monotonic() < deadline, 'DEADLINE'
                        source = pathlib.Path(row['source'])
                        assert sha(source) == (row['bytes'], row['sha256']), 'SOURCE_PIN'
                        entry = tarfile.TarInfo(row['member'])
                        entry.size, entry.mode, entry.mtime = row['bytes'], 0o644, 0
                        with source.open('rb') as stream:
                            archive.addfile(entry, stream)
                        assert sha(source) == (row['bytes'], row['sha256']), 'SOURCE_CHANGED'
            # Exact declared data + padding/header + tarfile record tail, not compression-ratio trust.
            payload_end = sum(512 + ((r['bytes'] + 511) // 512) * 512 for r in selected)
            expanded_limit = payload_end + 10240
            expected = {r['member']: r for r in selected}
            seen = set()
            with package.open('rb') as raw, lzma.LZMAFile(raw, mode='rb', format=lzma.FORMAT_XZ) as compressed:
                bounded = BoundedReader(compressed, expanded_limit, deadline, payload_end)
                with tarfile.open(fileobj=bounded, mode='r|') as archive:
                    for member in archive:
                        assert member.isfile() and member.type == tarfile.REGTYPE, 'NON_REGULAR_MEMBER'
                        assert member.name in expected and member.name not in seen, 'MEMBER_SET'
                        row = expected[member.name]
                        assert member.size == row['bytes'], 'MEMBER_SIZE'
                        digest, count = hashlib.sha256(), 0
                        stream = archive.extractfile(member)
                        assert stream is not None
                        with stream:
                            for chunk in iter(lambda: stream.read(65536), b''):
                                assert time.monotonic() < deadline, 'DEADLINE'
                                count += len(chunk)
                                assert count <= row['bytes'], 'MEMBER_OVERFLOW'
                                digest.update(chunk)
                        assert count == row['bytes'] and digest.hexdigest() == row['sha256'], 'MEMBER_SHA'
                        seen.add(member.name)
                while True:
                    tail = bounded.read(65536)
                    if not tail:
                        break
                    assert not any(tail), 'NONZERO_TAIL'
                assert seen == set(expected), 'MISSING_MEMBER'
            size, digest = sha(package)
            result['packages'].append({'stage': stage, 'path': str(package), 'bytes': size,
                                       'sha256': digest, 'members': len(seen), 'expandedBytes': bounded.count})
        assert (ROOT / 'inventory.json').read_bytes() == data, 'INVENTORY_CHANGED'
        assert sha(pathlib.Path(__file__))[1] == result['sourceSHA']
        assert sha(ROOT / 'freeze.py')[1] == result['freezeSourceSHA']
        result['complete'] = True
    except Exception as error:
        result['error'] = repr(error)
        raise
    finally:
        result['archiveMetrics'] = {'format': 'xz', 'preset': 6,
            'elapsedSeconds': time.monotonic() - started,
            'cpuSeconds': time.process_time() - cpu_started,
            'maxRSSRaw': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            'maxRSSUnit': 'bytes' if sys.platform == 'darwin' else 'platform-native',
            'productPerformance': False, 'decoderRSSHardLimit': False}
        with (output / 'receipt.json').open('x') as stream:
            json.dump(result, stream, indent=2)
        print(output)


if __name__ == '__main__':
    main()

