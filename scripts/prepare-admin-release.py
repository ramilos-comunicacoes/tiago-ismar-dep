#!/usr/bin/env python3
"""Prepare a pinned CMS release. Never activates services, symlinks or Nginx."""

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tarfile
import tempfile
from urllib.request import Request, urlopen
import venv


REPOSITORY = "ramilos-comunicacoes/tiago-ismar-dep"
BASE = Path("/opt/tiago-admin")
RELEASES = BASE / "releases"
MAX_ARCHIVE = 100 * 1024 * 1024
MAX_EXPANDED = 500 * 1024 * 1024
REQUIRED = {
    "server/__init__.py", "server/app.py", "server/seed.json", "server/requirements.txt",
    "admin/index.html", "admin/admin.css", "admin/admin.js",
    "deploy/tiago-admin.service", "deploy/nginx-admin.conf.example",
}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def selected(path):
    if len(path.parts) < 2:
        return False
    if path.parts[0] == "server":
        return path.suffix in {".py", ".json"} or str(path) == "server/requirements.txt"
    if path.parts[0] == "admin":
        return path.suffix in {".html", ".css", ".js"}
    return str(path) in {
        "deploy/tiago-admin.service", "deploy/nginx-admin.conf.example", "docs/ADMIN-DEPLOY.md",
    }


def extract_release(commit, destination):
    archive_url = f"https://codeload.github.com/{REPOSITORY}/tar.gz/{commit}"
    expected_root = f"tiago-ismar-dep-{commit}"
    with tempfile.TemporaryFile() as download:
        request = Request(archive_url, headers={"User-Agent": "tiago-admin-pinned-prepare/1"})
        archive_hash = hashlib.sha256()
        with urlopen(request, timeout=60) as response:
            total = 0
            while chunk := response.read(1024 * 1024):
                total += len(chunk)
                require(total <= MAX_ARCHIVE, "Downloaded archive exceeds the size limit.")
                archive_hash.update(chunk)
                download.write(chunk)
        download.seek(0)
        with tarfile.open(fileobj=download, mode="r:gz") as archive:
            members, seen, expanded = [], set(), 0
            for count, member in enumerate(archive, 1):
                require(count <= 10000, "Archive has too many entries.")
                name = PurePosixPath(member.name)
                require(not name.is_absolute() and ".." not in name.parts and "\\" not in member.name
                        and "\x00" not in member.name, f"Unsafe archive path: {member.name}")
                require(name.parts and name.parts[0] == expected_root, "Unexpected archive root.")
                require(member.isfile() or member.isdir(), "Archive links and special files are prohibited.")
                require(member.size >= 0, "Invalid archive entry size.")
                expanded += member.size
                require(expanded <= MAX_EXPANDED, "Expanded archive exceeds the size limit.")
                if member.isdir() or len(name.parts) < 2:
                    continue
                path = PurePosixPath(*name.parts[1:])
                if selected(path):
                    require(str(path) not in seen, f"Duplicate release path: {path}")
                    seen.add(str(path))
                    members.append((member, path))
            require(REQUIRED.issubset(seen), "Archive is missing required CMS files.")
            destination.mkdir(mode=0o755)
            hashes = {}
            for member, path in members:
                output = destination.joinpath(*path.parts)
                output.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
                digest = hashlib.sha256()
                with archive.extractfile(member) as source, output.open("xb") as target:
                    while chunk := source.read(1024 * 1024):
                        digest.update(chunk)
                        target.write(chunk)
                output.chmod(0o644)
                hashes[str(path)] = digest.hexdigest()
    return archive_hash.hexdigest(), hashes


def main():
    arguments = argparse.ArgumentParser(description=__doc__)
    arguments.add_argument("--commit", required=True, help="Full GitHub commit SHA, already pushed and reviewed.")
    args = arguments.parse_args()
    commit = args.commit.lower()
    require(re.fullmatch(r"[0-9a-f]{40}", commit), "--commit must be a full 40-character SHA.")
    require(sys.platform.startswith("linux"), "Run this preparer only on the Linux VPS.")
    require(os.geteuid() == 0, "Run as root after authorizing the CMS installation.")
    require(sys.version_info >= (3, 11), "Python 3.11 or later is required.")
    for directory in (BASE, RELEASES):
        require(directory.is_dir() and directory.resolve() == directory,
                f"Create a real directory first, after installation approval: {directory}")
        info = directory.stat()
        require(info.st_uid == 0 and not info.st_mode & 0o022, f"Directory must be root-owned and not group/world-writable: {directory}")
    lock_path = BASE / ".prepare.lock"
    require(not lock_path.is_symlink(), "Prepare lock must not be a symlink.")
    with lock_path.open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        release = RELEASES / f"git-{commit[:12]}"
        require(not os.path.lexists(release), f"Release already exists; inspect it instead of overwriting: {release}")
        archive_hash, hashes = extract_release(commit, release)
        # Release contains code only. Ensure the dedicated service user can read
        # installed dependencies even if the root shell uses a private umask.
        os.umask(0o022)
        venv_path = release / "venv"
        venv.EnvBuilder(with_pip=True).create(venv_path)
        python = venv_path / "bin/python"
        subprocess.run([
            str(python), "-m", "pip", "install", "--disable-pip-version-check", "--no-cache-dir",
            "--only-binary=:all:", "--requirement", str(release / "server/requirements.txt"),
        ], check=True)
        subprocess.run([str(python), "-m", "pip", "check"], check=True)
        subprocess.run([str(python), "-m", "compileall", "-q", str(release / "server")], check=True)
        installed = subprocess.check_output([str(python), "-m", "pip", "freeze"], text=True)
        (release / "installed-requirements.txt").write_text(installed, encoding="utf-8")
        (release / "release.json").write_text(json.dumps({
            "commit": commit, "archive_sha256": archive_hash, "files": hashes,
            "state": "prepared_not_activated",
        }, indent=2) + "\n", encoding="utf-8")
        # The service account can read code, but cannot change any release files.
        for directory in [release, *[path for path in release.rglob("*") if path.is_dir() and not path.is_symlink()]]:
            directory.chmod(0o755)
        print(f"PREPARED commit={commit}\nrelease={release}")
        print("No current symlink, database, service, Nginx, DNS, SSL, SSH or firewall was changed.")
        print("Activation requires the separate, approved steps in docs/ADMIN-DEPLOY.md.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"PREPARATION FAILED: {error}\nNo existing release was deleted or overwritten. Inspect any partial new release before retrying.", file=sys.stderr)
        sys.exit(1)
