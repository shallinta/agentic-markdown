"""CI-only fixed Rust supply. Never invoked by ordinary application builds."""
import argparse
import hashlib
import os
from pathlib import Path, PurePosixPath
import platform
import signal
import subprocess
import sys
import tarfile
import tempfile
import time

VERSION = "1.90.0"
BASE = "https://static.rust-lang.org/dist/2025-09-18/"
# channel-rust-1.90.0.toml SHA256:
# 489c19f20d331765ab2835661eb546de90f6446a107a8db83045e7371e45cae2
PINS = {
    "aarch64-apple-darwin": {
        "rustc": "89551c0ba1cc6d0312aebc4a6cafe4497223217ea8e87c81f6afbe127dfaeeb6",
        "cargo": "17a4410a27bf7dad4765f3809265c225f25f8b009da3d4b76cd0927acdae04b5",
        "rust-std": "c36777aec17d617f85f94b7cb87bdd4270eeca30ef38c6f686809d163c881609",
    },
    "x86_64-apple-darwin": {
        "rustc": "594687a61b671445ea9fff0e6b6c6eef81cba30b005d22710217b4da8d2d2ecc",
        "cargo": "b2fa21c8fed854775e379bb4617145abd047d1be729e8383148139ba1d05c88f",
        "rust-std": "dd731e6f9f30cb9b2928b92b084d2f12a3abf06a481ecbd8c3553c3e6f742139",
    },
}
COMPRESSED_LIMIT = 150 * 1024 * 1024
EXPANDED_LIMIT = 1024 * 1024 * 1024


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def verify_archive(archive, expected):
    require(archive.is_file() and archive.stat().st_size <= COMPRESSED_LIMIT,
            "component size invalid")
    digest = hashlib.sha256()
    with archive.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    require(digest.hexdigest() == expected, "component checksum mismatch")


def extract_component(archive, destination, root, expected):
    verify_archive(archive, expected)
    destination.mkdir()  # must be new, never extract over existing files
    total = 0
    seen = set()
    # Fixed checksum official archives only; no links or extractall.
    with tarfile.open(archive, mode="r|xz") as source:
        for member in source:
            name = member.name.rstrip("/")
            path = PurePosixPath(name)
            require(not path.is_absolute() and ".." not in path.parts
                    and str(path) == name and "\x00" not in name
                    and path.parts and path.parts[0] == root, "unsafe member")
            require(name not in seen and len(seen) < 10000, "duplicate/member limit")
            require(member.isfile() or member.isdir(), "unsupported member type")
            require(not member.pax_headers and not member.linkname, "extended member")
            total += member.size
            require(0 <= member.size <= EXPANDED_LIMIT and total <= EXPANDED_LIMIT,
                    "expanded size limit")
            seen.add(name)
            target = destination.joinpath(*path.parts)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                stream = source.extractfile(member)
                require(stream is not None, "missing member stream")
                remaining = member.size
                with target.open("xb") as output:
                    while remaining:
                        chunk = stream.read(min(remaining, 1024 * 1024))
                        require(bool(chunk), "truncated member")
                        output.write(chunk)
                        remaining -= len(chunk)
                target.chmod(0o755 if member.mode & 0o111 else 0o644)
    require((destination / root / "install.sh").is_file(), "missing installer")


def run(argv, deadline, seconds=180, **kwargs):
    timeout = min(seconds, deadline - time.monotonic())
    require(timeout > 0, "setup deadline")
    process = subprocess.Popen(argv, start_new_session=True, **kwargs)
    try:
        code = process.wait(timeout=timeout)
    except BaseException:
        # Only this newly-created command group, never unrelated processes.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()
        raise
    require(code == 0, "setup command failed: " + argv[0])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", required=True, choices=PINS)
    parser.add_argument("--extract", nargs=3, metavar=("ARCHIVE", "DEST", "PACKAGE"))
    args = parser.parse_args()
    if args.extract:
        archive, destination, package = args.extract
        require(package in PINS[args.target], "unknown package")
        extract_component(Path(archive), Path(destination),
                          f"{package}-{VERSION}-{args.target}", PINS[args.target][package])
        return
    require(platform.system() == "Darwin", "macOS required")
    expected_host = {"arm64": "aarch64-apple-darwin", "x86_64": "x86_64-apple-darwin"}
    require(expected_host.get(platform.machine()) == args.target, "native target mismatch")
    runner = Path(os.environ["RUNNER_TEMP"])
    require(runner.is_absolute() and runner.is_dir(), "absolute RUNNER_TEMP required")
    work = Path(tempfile.mkdtemp(prefix="agentic-index-rust-", dir=runner))
    prefix = work / "prefix"
    deadline = time.monotonic() + 900
    for package, checksum in PINS[args.target].items():
        name = f"{package}-{VERSION}-{args.target}"
        archive = work / (name + ".tar.xz")
        run(["curl", "--fail", "--silent", "--show-error", "--proto", "=https",
             "--connect-timeout", "15", "--max-time", "180", "--max-filesize",
             str(COMPRESSED_LIMIT), "--output", str(archive), BASE + archive.name], deadline)
        unpack = work / (package + "-unpack")
        run([sys.executable, str(Path(__file__).resolve()), "--target", args.target,
             "--extract", str(archive), str(unpack), package], deadline)
        run(["bash", str(unpack / name / "install.sh"), "--prefix=" + str(prefix),
             "--disable-ldconfig"], deadline, cwd=unpack / name)
        print(f"verified {package} {args.target} {checksum}", flush=True)
    rustc = subprocess.check_output([str(prefix / "bin/rustc"), "-vV"], timeout=15).decode()
    cargo = subprocess.check_output([str(prefix / "bin/cargo"), "--version"], timeout=15).decode()
    require("release: 1.90.0\n" in rustc and f"host: {args.target}\n" in rustc,
            "installed rustc mismatch")
    require(cargo.startswith("cargo 1.90.0 "), "installed cargo mismatch")
    print(rustc + cargo, flush=True)
    env = os.environ["GITHUB_ENV"]
    values = {"AGENTIC_MARKDOWN_INDEX_RUST_BIN": str(prefix / "bin"), "AGENTIC_MARKDOWN_INDEX_TARGET": args.target}
    require(all("\n" not in v and "\r" not in v for v in values.values()), "invalid env path")
    with open(env, "a", encoding="utf-8") as output:
        for key, value in values.items():
            output.write(f"{key}={value}\n")


if __name__ == "__main__":
    main()
