"""Four-suite migration only. No implicit downloads or engine invocation.

Commands: materialize, inputs, preflight, run. All writes are below a new work.
History is restored by exact inventory members into new work; no extractall.
Fixed SHA-verified self-produced XZ packages only; no decoder RSS hard limit.
This is controlled local-fixture safety, not a hostile same-UID filesystem sandbox.
"""
import argparse
import ast
import difflib
import hashlib
import lzma
import importlib.util
import json
import os
import pathlib
import re
import stat
import sys
import tarfile
import time

CANDIDATE = 'candidate.TURSqj'
GENERATOR = 'scale.1Kfm4c'
GENRUN = 'run-1792332750009771000'
GENSHA = '2822c8814f93dcef772f43a2afc36b3f2209caab4f9c81905b3b6ab8c0494da5'
REFERENCE = 'reference.BDHlVX/run-1792330916464532000/results.json'
EXTRACT = 'corpus-extract.kTIP71'
EXTRACTRUN = 'run-1792330318024936000'
LOCK = '639d75f7f400a528fb5879936175f31f51ba6a762e5cee8202f80f73dc00f347'
BUN = '539598c775882420b9d8deb7dc14d845f20f7d26f5600c50ab067dde6ac3f3bf'
TOOLS = {
    'rustc': 'b2011d06d5c7efff7b48b1e1aec6106989e44f3a5ad1d171e06a41c0fbc3ffea',
    'cargo': 'b617f75ab3fadd5d764368413b7e87532dfa45039aac431f9c0af883b824a6e6',
    'rustdoc': '07908f4c9e558bc6a4025c9aa3c717eeabf6cdb916b02f4790dc7b655a8744e4',
}


def clean(path, exists=True):
    value = pathlib.Path(path)
    assert value.is_absolute() and '..' not in value.parts and '\x00' not in str(value), 'ABSOLUTE_SAFE_PATH'
    # /tmp is itself a macOS symlink: callers must use canonical /private/tmp.
    for part in [*reversed(value.parents), value]:
        if part.exists() or part.is_symlink():
            assert not part.is_symlink(), 'SYMLINK_COMPONENT'
    if exists:
        assert value.exists(), 'MISSING_PATH'
    return value


def digest(path):
    path = clean(path)
    before = path.stat()
    assert stat.S_ISREG(before.st_mode), 'NOT_REGULAR'
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(65536), b''):
            h.update(block)
    after = path.stat()
    assert (before.st_ino, before.st_size, before.st_mtime_ns) == (after.st_ino, after.st_size, after.st_mtime_ns)
    return h.hexdigest()


def relative(value):
    assert not value.startswith('/') and '\x00' not in value
    assert all(part not in ('', '.', '..') for part in value.split('/')), 'RELATIVE_PATH'
    return pathlib.PurePosixPath(value)


def write_new(work, target, data):
    assert target.is_relative_to(work), 'WRITE_ESCAPE'
    clean(target, False)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open('xb') as output:
        output.write(data)


def load(config_path, inventory_path, inventory_sha):
    config = json.loads(clean(config_path).read_bytes())
    assert set(config) == {'work', 'archives', 'toolchain', 'bun', 'node', 'python', 'officialArchives', 'cargoCache'}
    config = {key: clean(value, key not in ('work', 'officialArchives', 'cargoCache')) for key, value in config.items()}
    work = config['work']
    for key in ('archives', 'toolchain', 'bun', 'node', 'python', 'officialArchives', 'cargoCache'):
        assert not config[key].is_relative_to(work) and not work.is_relative_to(config[key]), 'AMBIGUOUS_ROOTS'
    raw = clean(inventory_path).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == inventory_sha, 'INVENTORY_SHA'
    inventory = json.loads(raw)
    rows = {row['member']: row for row in inventory['files']}
    assert len(rows) == inventory['count'] == len(inventory['files'])
    assert sum(row['bytes'] for row in rows.values()) == inventory['bytes']
    for member in rows:
        relative(member)
    config['_inventorySHA'] = inventory_sha
    return config, rows


def historic(config, rows, member):
    path = config['work'] / 'history' / relative(member)
    row = rows[member]
    assert digest(path) == row['sha256'] and path.stat().st_size == row['bytes'], 'HISTORY_PIN'
    return path


def replace_once(source, old, new):
    assert source.count(old) == 1, 'PATCH_COUNT_' + old
    return source.replace(old, new)


def migrated(config, name, raw):
    """Exact reviewed consumption sites; manifests/TSV and Rust remain untouched."""
    s = raw.decode('utf-8')
    tool = str(config['toolchain'])
    bun = str(config['bun'])
    work = config['work']
    if name in ('literal/run.mjs', 'crud/run.mjs'):
        s = replace_once(s, "const tool = '/tmp/agentic-f064a-rust190.zxE80R';", 'const tool = ' + json.dumps(tool) + ';')
        s = replace_once(s, "const bun = '/tmp/agentic-direct186.uXVnAg/Agentic Markdown-canary.app/Contents/MacOS/bun';", 'const bun = ' + json.dumps(bun) + ';')
        s = replace_once(s, "CARGO_HOME: tool + '/cargo-home',", 'CARGO_HOME: ' + json.dumps(str(work / 'cargo-home')) + ',\n  CARGO_NET_OFFLINE: \'true\',')
    if name in ('real/run.py', 'scale/processes.py'):
        s = replace_once(s, "TOOLCHAIN = pathlib.Path('/tmp/agentic-f064a-rust190.zxE80R')", 'TOOLCHAIN = pathlib.Path(' + repr(tool) + ')')
        s = replace_once(s, "BUN = '/tmp/agentic-direct186.uXVnAg/Agentic Markdown-canary.app/Contents/MacOS/bun'", 'BUN = ' + repr(bun))
    if name == 'real/run.py':
        s = replace_once(s, "ref = pathlib.Path('/tmp/agentic-f064a-reference.BDHlVX/run-1792330916464532000/results.json')", 'ref = pathlib.Path(' + repr(str(work / 'history' / REFERENCE)) + ')')
        s = replace_once(s, "path = pathlib.Path(manifest['corpusDirectory']) / doc['output']", 'path = pathlib.Path(' + repr(str(work / 'inputs/real')) + ") / doc['output']")
        s = replace_once(s, "manifest['corpusDirectory'] if phase=='build'", repr(str(work / 'inputs/real')) + " if phase=='build'")
        s = replace_once(s, "'CARGO_HOME':str(TOOLCHAIN/'cargo-home'),", "'CARGO_HOME':" + repr(str(work / 'cargo-home')) + ", 'CARGO_NET_OFFLINE':'true',")
        s = replace_once(s, "'PATH':str(prefix/'bin')+os.pathsep+os.environ['PATH']", "'PATH':str(prefix/'bin')+os.pathsep+'/usr/bin:/bin:/usr/sbin:/sbin'")
    if name == 'real/sqlite.mjs':
        s = replace_once(s, 'join(manifest.corpusDirectory,d.output)', 'join(' + json.dumps(str(work / 'inputs/real')) + ',d.output)')
    if name == 'scale/run.py':
        s = replace_once(s, "'CARGO_HOME': str(TOOLCHAIN / 'cargo-home'),", "'CARGO_HOME': " + repr(str(work / 'cargo-home')) + ", 'CARGO_NET_OFFLINE': 'true',")
        s = replace_once(s, "'PATH': str(prefix / 'bin') + os.pathsep + os.environ['PATH']", "'PATH': str(prefix / 'bin') + os.pathsep + '/usr/bin:/bin:/usr/sbin:/sbin'")
        s = replace_once(s, "corpus = pathlib.Path(corpus_record['corpus'])", 'corpus = pathlib.Path(' + repr(str(work / 'inputs/scale')) + ") / ('corpus-' + str(corpus_record['n']))")
    # No old experiment path may remain in executable code, even on an error branch.
    if name.endswith(('.py', '.mjs', '.rs')):
        old_paths = re.findall(r'(?<!/private)/tmp/agentic-[^\s\"\']+', s)
        assert not old_paths, 'UNMAPPED_EXECUTABLE_PATH_' + name
    return s.encode()


def materialize(config, rows):
    work = config['work']
    assert not work.exists(), 'WORK_MUST_BE_NEW'
    work.mkdir()
    restore(config, rows)
    records, diffs = [], []
    for member in rows:
        if not member.startswith(CANDIDATE + '/'):
            continue
        name = member[len(CANDIDATE) + 1:]
        if any(part.startswith('run-') for part in relative(name).parts):
            continue
        old = historic(config, rows, member).read_bytes()
        new = migrated(config, name, old) if name.endswith(('.py', '.mjs', '.rs')) else old
        write_new(work, work / 'candidate' / name, new)
        records.append({'name': name, 'oldSHA': hashlib.sha256(old).hexdigest(), 'newSHA': hashlib.sha256(new).hexdigest()})
        if new != old:
            diffs.extend(difflib.unified_diff(old.decode().splitlines(True), new.decode().splitlines(True), fromfile=member, tofile='candidate/' + name))
    for folder in ('inputs/real', 'inputs/scale', 'tmp', 'cargo-home'):
        (work / folder).mkdir(parents=True)
    write_new(work, work / 'migration.patch', ''.join(diffs).encode())
    write_new(work, work / 'migration-sources.json', json.dumps(records, indent=2).encode())
    write_new(work, work / 'migration-environment.json', json.dumps({
        'inventorySHA': config['_inventorySHA'], 'replaySHA': digest(pathlib.Path(__file__).resolve()),
        'nodeSHA': digest(config['node']), 'pythonSHA': digest(config['python']),
        'network': 'disabled-in-runners', 'historyBytesUnchanged': True,
    }, indent=2).encode())


class Bounded:
    def __init__(self, source, payload, deadline):
        self.source, self.payload, self.deadline, self.count = source, payload, deadline, 0

    def read(self, size=-1):
        assert time.monotonic() < self.deadline, 'RESTORE_DEADLINE'
        data = self.source.read(min(65536, size) if size >= 0 else 65536)
        assert not any(data[max(0, self.payload - self.count):]), 'NONZERO_TAIL'
        self.count += len(data)
        assert self.count <= self.payload + 10240, 'EXPANSION_LIMIT'
        return data


def restore(config, rows):
    work, archive_dir = config['work'], config['archives']
    receipt = json.loads(clean(archive_dir / 'receipt.json').read_bytes())
    assert receipt['complete'] and receipt['inventorySHA'] == config['_inventorySHA'], 'ARCHIVE_NOT_COMPLETE_OR_WRONG_INVENTORY'
    expected_stages = {r['stage'] for r in rows.values()}
    packages = {p['stage']: p for p in receipt['packages']}
    assert set(packages) == expected_stages and len(packages) == len(receipt['packages'])
    deadline = time.monotonic() + 600
    for stage, package in packages.items():
        archive = clean(archive_dir / (stage + '.tar.xz'))
        assert digest(archive) == package['sha256'] and archive.stat().st_size == package['bytes']
        expected = {name: row for name, row in rows.items() if row['stage'] == stage}
        payload = sum(512 + ((r['bytes'] + 511) // 512) * 512 for r in expected.values())
        seen = set()
        with lzma.LZMAFile(archive, 'rb', format=lzma.FORMAT_XZ) as compressed:
            bounded = Bounded(compressed, payload, deadline)
            with tarfile.open(fileobj=bounded, mode='r|') as tar:
                for member in tar:
                    assert member.type == tarfile.REGTYPE and not member.pax_headers, 'MEMBER_TYPE'
                    assert member.name in expected and member.name not in seen, 'MEMBER_SET'
                    row = expected[member.name]
                    assert member.size == row['bytes'], 'MEMBER_SIZE'
                    target = work / 'history' / relative(member.name)
                    clean(target, False)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    h, count = hashlib.sha256(), 0
                    source = tar.extractfile(member)
                    assert source is not None
                    with source, target.open('xb') as output:
                        for block in iter(lambda: source.read(65536), b''):
                            assert time.monotonic() < deadline, 'RESTORE_DEADLINE'
                            count += len(block)
                            assert count <= row['bytes']
                            h.update(block)
                            output.write(block)
                    assert count == row['bytes'] and h.hexdigest() == row['sha256'], 'MEMBER_SHA'
                    seen.add(member.name)
            while bounded.read(65536):
                pass
            assert seen == set(expected)


def module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    # Avoid writing __pycache__ beside historical read-only input.
    exec(compile(path.read_bytes(), str(path), 'exec'), value.__dict__)
    return value


def inputs(config, rows):
    """Offline reconstruction from caller-provided fixed official archives/cache."""
    work = config['work']
    assert (work / 'migration-sources.json').exists(), 'MATERIALIZE_FIRST'
    assert not (work / 'inputs.complete.json').exists(), 'INPUTS_ALREADY_COMPLETE'
    deadline = time.monotonic() + 600
    allow = json.loads(historic(config, rows, EXTRACT + '/allowlist.json').read_bytes())
    safe = module(historic(config, rows, EXTRACT + '/safe_tar.py'), 'f064a_safe_tar')
    # Exact previously extracted byte hashes; original content is not an oracle input here.
    original = json.loads(historic(config, rows, EXTRACT + '/' + EXTRACTRUN + '/receipt.json').read_bytes())
    assert original['status'] == 'complete'
    extracted = [entry for record in original['records'] for entry in record['entries']]
    expected_hashes = {entry['id']: entry['sha256'] for entry in extracted}
    for repo in allow['repos']:
        archive = clean(config['officialArchives'] / (repo['repo'] + '.tar.gz'))
        assert archive.stat().st_size == repo['bytes'] and digest(archive) == repo['sha256'], 'OFFICIAL_ARCHIVE_PIN'
        prefix = repo['repo'] + '-' + repo['commit']
        expected = {prefix + '/' + e['path']: e for e in allow['entries'] if e['repo'] == repo['repo']}
        seen = set()

        def selected(name, size, directory):
            assert time.monotonic() < deadline, 'INPUT_DEADLINE'
            if name not in expected:
                return False
            assert not directory and size == expected[name]['bytes'] and name not in seen
            return True

        def consume(name, data):
            item = expected[name]
            data.decode('utf-8', 'strict')
            assert hashlib.sha256(data).hexdigest() == expected_hashes[item['id']], 'RAW_SHA'
            write_new(work, work / 'inputs/real' / (item['id'] + '.raw'), data)
            seen.add(name)
        safe.scan(str(archive), prefix, str(work / 'inputs/real' / (repo['repo'] + '.members.jsonl')), selected, consume)
        assert seen == set(expected)
    model = module(historic(config, rows, GENERATOR + '/model.py'), 'f064a_model')
    for n in (100, 1000, 10000):
        source = work / 'history' / GENERATOR / GENRUN / ('corpus-' + str(n))
        target = work / 'inputs/scale' / ('corpus-' + str(n))
        assert not target.exists()
        target.mkdir()
        for path in source.rglob('*'):
            if path.is_file():
                write_new(work, target / path.relative_to(source), path.read_bytes())
        complete = json.loads((target / 'complete.json').read_bytes())
        for doc in complete['files']:
            assert time.monotonic() < deadline, 'INPUT_DEADLINE'
            raw = model.payload(doc['id'], doc['revision'], doc['life'], doc['bytes'])
            assert hashlib.sha256(raw).hexdigest() == doc['sha256'], 'SYNTHETIC_RAW_SHA'
            write_new(work, target / relative(doc['output']), raw)
    # Cargo may mutate its cache; copy only caller-provided registry into new work, never use it in place.
    registry = clean(config['cargoCache'] / 'registry')
    for path in registry.rglob('*'):
        assert time.monotonic() < deadline, 'INPUT_DEADLINE'
        clean(path)
        if path.is_file():
            write_new(work, work / 'cargo-home/registry' / path.relative_to(registry), path.read_bytes())
        else:
            assert path.is_dir(), 'CACHE_SPECIAL'
    write_new(work, work / 'inputs.complete.json', b'{"complete":true,"network":false}\n')


def preflight(config, rows):
    work = config['work']
    environment = json.loads((work / 'migration-environment.json').read_bytes())
    assert environment['inventorySHA'] == config['_inventorySHA']
    assert environment['replaySHA'] == digest(pathlib.Path(__file__).resolve())
    assert environment['nodeSHA'] == digest(config['node']) and environment['pythonSHA'] == digest(config['python'])
    assert digest(config['bun']) == BUN, 'BUN_IDENTITY'
    for name, pin in TOOLS.items():
        assert digest(config['toolchain'] / 'prefix/bin' / name) == pin, 'TOOLCHAIN_IDENTITY'
    records = json.loads(clean(work / 'migration-sources.json').read_bytes())
    for row in records:
        name = row['name']
        old = historic(config, rows, CANDIDATE + '/' + name).read_bytes()
        new = migrated(config, name, old) if name.endswith(('.py', '.mjs', '.rs')) else old
        assert hashlib.sha256(new).hexdigest() == row['newSHA'] == digest(work / 'candidate' / name)
        if name.endswith('.py'):
            ast.parse(new)
    for suite in ('literal', 'crud', 'real', 'scale'):
        assert digest(work / 'candidate' / suite / 'Cargo.lock') == LOCK
    assert json.loads((work / 'inputs.complete.json').read_bytes())['complete']
    real = json.loads((work / 'candidate/real/manifest.json').read_bytes())
    for line in (work / 'candidate/real/docs.tsv').read_text().splitlines():
        relative(bytes.fromhex(line.split('\t')[3]).decode())
    for doc in real['documents']:
        file = work / 'inputs/real' / relative(doc['output'])
        assert file.stat().st_size == doc['bytes'] and digest(file) == doc['sha256']
    generation = work / 'history' / GENERATOR / GENRUN / 'receipt.json'
    assert digest(generation) == GENSHA
    for record in json.loads(generation.read_bytes())['records']:
        corpus = work / 'inputs/scale' / ('corpus-' + str(record['n']))
        assert digest(corpus / 'complete.json') == record['completeSHA']
        complete = json.loads((corpus / 'complete.json').read_bytes())
        for doc in complete['files']:
            raw = corpus / relative(doc['output'])
            assert raw.stat().st_size == doc['bytes'] and digest(raw) == doc['sha256']
        for stage in complete['stages']:
            for name, pin in stage['pins'].items():
                assert digest(corpus / stage['name'] / name) == pin
            for name in ('docs.tsv', 'changes.tsv'):
                for line in (corpus / stage['name'] / name).read_text().splitlines():
                    relative(bytes.fromhex(line.split('\t')[3]).decode())
    print(json.dumps({'preflight': 'complete', 'engineExecuted': False}))


def correctness_required(work):
    for suite in ('literal', 'crud', 'real', 'scale'):
        mode = 'diagnose' if suite in ('literal', 'crud') else 'correctness'
        root = work / 'candidate' / suite
        approved = False
        for path in root.glob('run-*/receipt.json'):
            value = json.loads(clean(path).read_bytes())
            if value.get('status') != 'complete' or value.get('mode') != mode:
                continue
            if value.get('binarySHA') != digest(root / 'target/release/f064a-toolchain-check'):
                continue
            sources = value.get('sources', {})
            if sources and all(digest(root / relative(name)) == pin for name, pin in sources.items()):
                approved = True
        assert approved, 'MIGRATED_CORRECTNESS_REQUIRED_' + suite


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['materialize', 'inputs', 'preflight', 'run'])
    parser.add_argument('--paths', required=True)
    parser.add_argument('--inventory', required=True)
    parser.add_argument('--inventory-sha', required=True)
    parser.add_argument('--suite', choices=['literal', 'crud', 'real', 'scale'])
    parser.add_argument('--mode', choices=['compile', 'correctness', 'finite20'])
    args = parser.parse_args()
    config, rows = load(args.paths, args.inventory, args.inventory_sha)
    if args.command == 'materialize':
        materialize(config, rows)
    elif args.command == 'inputs':
        inputs(config, rows)
    elif args.command == 'preflight':
        preflight(config, rows)
    else:
        assert args.suite and args.mode and (args.mode != 'finite20' or args.suite == 'scale')
        preflight(config, rows)
        work = config['work']
        if args.mode == 'finite20':
            correctness_required(work)
        suite = work / 'candidate' / args.suite
        if args.suite in ('literal', 'crud'):
            argv = [str(config['node']), str(suite / 'run.mjs'), 'diagnose' if args.mode == 'correctness' else args.mode]
        else:
            argv = [str(config['python']), str(suite / 'run.py'), args.mode]
            if args.suite == 'scale' and args.mode != 'compile':
                argv += [str(work / 'history' / GENERATOR / GENRUN / 'receipt.json'), GENSHA]
        # All argv/exec/cwd paths are explicit canonical work/tool locations; no historical fallback.
        clean(suite)
        environment = {**os.environ, 'TMPDIR': str(work / 'tmp'), 'CARGO_NET_OFFLINE': 'true',
                       'PYTHONDONTWRITEBYTECODE': '1', 'PATH': '/usr/bin:/bin:/usr/sbin:/sbin'}
        os.chdir(suite)
        os.execve(argv[0], argv, environment)


if __name__ == '__main__':
    main()
