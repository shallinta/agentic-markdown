"""Inventory preparation only: read stable files, write one exclusive manifest. No archive."""
import hashlib
import json
import pathlib
import re
import stat

ROOT = pathlib.Path(__file__).resolve().parent
STAGES = [
    'toolchain.XOLigk', 'rust190.zxE80R', 'native.hHjGn7', 'literal.TNa1mW',
    'literal-blob.pf89ql', 'bom-repro.eaiqPG', 'crud.qyfN9u', 'crud-rw.h2jpT5',
    'corpus-meta.meLM1N', 'meta-tests.wQQUwy', 'meta-review.Miju03',
    'corpus-extract.kTIP71', 'reference.BDHlVX', 'corpus-cost.hrCQVN',
    'scale.1Kfm4c', 'scale-typed.Xx6GxU', 'profile.e7G48i', 'iterate.aHgt7N',
    'order.DwUfIx', 'candidate.TURSqj',
]
CANDIDATE_RUNS = {
    'literal/run-1792336068913', 'literal/run-1792336105456',
    'crud/run-1792336112944', 'crud/run-1792336147372',
    'real/run-1792336150248370000', 'real/run-1792336186254059000',
    'scale/run-1792336187892538000', 'scale/run-1792336224092809000',
    'scale/run-1792336563627890000',
}
EXCLUDE = {'target', 'cargo-home', 'prefix', 'unpack', '__pycache__', 'raw', 'index-copy', 'index'}


def sha(path):
    before = path.lstat()
    assert stat.S_ISREG(before.st_mode), 'NOT_REGULAR'
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(65536), b''):
            digest.update(block)
    after = path.lstat()
    assert (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) == (
        after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns), 'CHANGED'
    return before.st_size, digest.hexdigest()


def category(stage, relative):
    name = relative.name
    if re.fullmatch(r'l[1-5]\.raw', name):
        return 'license'
    if 'fixtures' in relative.parts or stage.startswith('meta-tests.') and name.endswith('.tar.gz'):
        return 'fixture'
    if relative.parts[0] == 'downloads':
        return 'official-manifest'
    if re.search(r'\.(mjs|py|rs)(\.v1)?$', name) or name in ('Cargo.toml', 'Cargo.lock', 'README.md'):
        return 'source'
    if re.search(r'manifest|inputs|complete|allowlist|reference|docs\.tsv|queries\.tsv|changes\.tsv|deleted\.tsv', name):
        return 'manifest-reference'
    if re.search(r'\.(json|jsonl|stdout|stderr|list|sha256|txt|md)$', name) or name in ('stdout', 'stderr'):
        return 'receipt'
    raise ValueError('UNCLASSIFIED_' + str(relative))


def main():
    assert not (ROOT / 'inventory.json').exists(), 'ALREADY_FROZEN'
    rows = []
    for stage in STAGES:
        origin = pathlib.Path('/tmp/agentic-f064a-' + stage)

        def walk(directory):
            for path in sorted(directory.iterdir(), key=lambda p: p.name.encode()):
                info = path.lstat()
                relative = path.relative_to(origin)
                assert not path.is_symlink(), 'SYMLINK'
                if stat.S_ISDIR(info.st_mode):
                    if path.name in EXCLUDE or path.name.endswith('-index'):
                        continue
                    if stage.startswith('candidate.') and path.name.startswith('run-'):
                        if relative.as_posix() not in CANDIDATE_RUNS:
                            continue
                        receipt = json.loads((path / 'receipt.json').read_bytes())
                        assert receipt['status'] in ('complete', 'failed'), 'CANDIDATE_NOT_TERMINAL'
                    walk(path)
                    continue
                assert stat.S_ISREG(info.st_mode), 'SPECIAL'
                name = path.name
                if re.search(r'\.(db|db-shm|db-wal|sqlite|xz)$', name):
                    continue
                if name.endswith('.tar.gz') and not stage.startswith('meta-tests.'):
                    continue
                if re.fullmatch(r'd\d+\.raw', name):
                    continue
                kind = category(stage, relative)
                size, digest = sha(path)
                member = stage + '/' + relative.as_posix()
                assert all(part not in ('', '.', '..') for part in member.split('/'))
                assert not member.startswith('/') and '\x00' not in member
                rows.append({'source': str(path), 'stage': stage, 'member': member,
                             'category': kind, 'bytes': size, 'sha256': digest})
        walk(origin)
    assert len({row['member'] for row in rows}) == len(rows)
    summary = {stage: {'count': sum(r['stage'] == stage for r in rows),
                       'bytes': sum(r['bytes'] for r in rows if r['stage'] == stage)} for stage in STAGES}
    value = {'version': 1, 'purpose': 'f064a-historical-artifact-whitelist',
             'count': len(rows), 'bytes': sum(r['bytes'] for r in rows),
             'stages': summary, 'files': rows, 'freezeSourceSHA': sha(pathlib.Path(__file__))[1]}
    data = (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()
    with (ROOT / 'inventory.json').open('xb') as stream:
        stream.write(data)
    print(json.dumps({'count': value['count'], 'bytes': value['bytes'],
                      'inventorySHA': hashlib.sha256(data).hexdigest(), 'stages': summary}))


if __name__ == '__main__':
    main()
