#!/usr/bin/env python3
"""Publish a pinned GitHub commit on the existing Ubuntu VPS (stdlib only)."""

import argparse
import fcntl
from html.parser import HTMLParser
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import sys
import tarfile
import tempfile
from urllib.parse import unquote, urlsplit
from urllib.request import Request, urlopen
import uuid


REPOSITORY = "ramilos-comunicacoes/tiago-ismar-dep"
SITE = Path("/var/www/tiagoismar.com")
RELEASES = SITE / "releases"
CURRENT = SITE / "current"
HOSTS = {"tiagoismar.com", "www.tiagoismar.com"}
ASSET_TYPES = {".webp", ".jpg", ".jpeg", ".png", ".svg", ".avif", ".gif", ".ico", ".woff", ".woff2"}
MAX_ARCHIVE = 100 * 1024 * 1024
MAX_EXPANDED = 500 * 1024 * 1024
CSS_URL = re.compile(
    r'''url\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^'"\)]*?))\s*\)''',
    re.IGNORECASE,
)


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def static_file(path):
    return (
        path == PurePosixPath("index.html")
        or (path.parts[0] == "css" and path.suffix.lower() == ".css")
        or (path.parts[0] == "js" and path.suffix.lower() == ".js")
        or (path.parts[0] == "assets" and path.suffix.lower() in ASSET_TYPES)
    )


class PageReferences(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.references = []
        self.title = []
        self.in_title = False

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if tag == "title":
            self.in_title = True
        # data-photo is loaded by the gallery only when its dialog is opened.
        for name in ("src", "href", "poster", "data-photo"):
            if attrs.get(name):
                self.references.append(attrs[name])
        # Site srcset entries are ordinary URL + optional width/density pairs.
        if attrs.get("srcset"):
            require("data:" not in attrs["srcset"], "Inline data srcset is unsupported; use asset files.")
            self.references.extend(item.strip().split()[0] for item in attrs["srcset"].split(",") if item.strip())
        if tag == "meta" and (attrs.get("property") == "og:image" or attrs.get("name") == "twitter:image"):
            if attrs.get("content"):
                self.references.append(attrs["content"])

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False

    def handle_data(self, data):
        if self.in_title:
            self.title.append(data)


def validate_reference(release, reference, relative_to=PurePosixPath(".")):
    reference = reference.strip()
    if not reference or reference.startswith("#"):
        return
    url = urlsplit(reference)
    if url.netloc and url.hostname not in HOSTS:
        return
    if url.scheme and url.scheme not in {"http", "https"}:
        return
    decoded = unquote(url.path)
    require("\\" not in decoded and "\x00" not in decoded, f"Invalid asset URL: {reference}")
    path = PurePosixPath(decoded.lstrip("/"))
    # Resolve normal CSS ../assets references, then enforce the release boundary.
    base = release if decoded.startswith("/") or url.netloc else release.joinpath(*relative_to.parts)
    target = base.joinpath(*path.parts).resolve()
    require(target.is_relative_to(release), f"Asset URL escapes release: {reference}")
    if target.is_dir():
        target = target / "index.html"
    require(target.is_file(), f"Missing local reference: {reference}")


def validate_release(release):
    index = release / "index.html"
    require(index.is_file(), "Release has no index.html.")
    parser = PageReferences()
    parser.feed(index.read_text(encoding="utf-8"))
    require("tiago ismar" in " ".join(parser.title).casefold(), "Unexpected or missing page title.")
    for reference in parser.references:
        validate_reference(release, reference)
    for css in (release / "css").rglob("*.css"):
        content = css.read_text(encoding="utf-8")
        # Consume a quoted URL as one token: embedded SVG data can itself contain url(...).
        for match in CSS_URL.finditer(content):
            reference = next(group for group in match.groups() if group is not None)
            validate_reference(release, reference, PurePosixPath(css.parent.relative_to(release).as_posix()))


def create_release(commit, release):
    url = f"https://codeload.github.com/{REPOSITORY}/tar.gz/{commit}"
    expected_root = f"tiago-ismar-dep-{commit}"
    with tempfile.TemporaryFile() as download:
        request = Request(url, headers={"User-Agent": "tiago-ismar-pinned-deploy/1"})
        with urlopen(request, timeout=60) as response:
            total = 0
            while chunk := response.read(1024 * 1024):
                total += len(chunk)
                require(total <= MAX_ARCHIVE, "Downloaded archive exceeds the size limit.")
                download.write(chunk)
        download.seek(0)
        with tarfile.open(fileobj=download, mode="r:gz") as archive:
            selected, seen = [], set()
            expanded = 0
            for count, member in enumerate(archive, 1):
                require(count <= 10000, "Archive has too many entries.")
                name = PurePosixPath(member.name)
                require(not name.is_absolute() and ".." not in name.parts and "\\" not in member.name,
                        f"Unsafe archive path: {member.name}")
                require(name.parts and name.parts[0] == expected_root, "Unexpected archive root.")
                require(member.isdir() or member.isfile(), f"Archive links/special files are prohibited: {member.name}")
                require(member.size >= 0, "Invalid archive entry size.")
                expanded += member.size
                require(expanded <= MAX_EXPANDED, "Expanded archive exceeds the size limit.")
                if member.isdir() or len(name.parts) == 1:
                    continue
                path = PurePosixPath(*name.parts[1:])
                if static_file(path):
                    require(path not in seen, f"Duplicate asset: {path}")
                    seen.add(path)
                    selected.append((member, path))
            require(PurePosixPath("index.html") in seen, "Archive has no index.html.")
            release.mkdir(mode=0o755)  # Never overwrite an existing or partial release.
            os.chmod(release, 0o755)
            for member, path in selected:
                destination = release.joinpath(*path.parts)
                destination.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
                with archive.extractfile(member) as source, destination.open("xb") as output:
                    while chunk := source.read(1024 * 1024):
                        output.write(chunk)
                os.chmod(destination, 0o644)
            for directory in release.rglob("*"):
                if directory.is_dir():
                    os.chmod(directory, 0o755)
    validate_release(release)


def main():
    arguments = argparse.ArgumentParser(description=__doc__)
    arguments.add_argument("--commit", required=True, help="Full 40-character GitHub commit SHA")
    commit = arguments.parse_args().commit.lower()
    require(re.fullmatch(r"[0-9a-f]{40}", commit), "--commit must be a full 40-character hexadecimal SHA.")
    require(SITE.is_dir() and SITE.resolve() == SITE, f"Expected a real site directory: {SITE}")
    require(RELEASES.is_dir() and RELEASES.resolve() == RELEASES, f"Expected a real releases directory: {RELEASES}")
    lock_path = SITE / ".deploy.lock"
    require(not lock_path.is_symlink(), "Deploy lock must not be a symlink.")
    with lock_path.open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        require(CURRENT.is_symlink(), f"Refusing to replace a non-symlink current path: {CURRENT}")
        previous_link = os.readlink(CURRENT)
        previous = CURRENT.resolve(strict=True)
        require(previous.is_dir() and previous.is_relative_to(RELEASES), "Current target must be a release directory.")
        release = RELEASES / f"git-{commit[:12]}"
        require(not os.path.lexists(release), f"Release already exists; inspect it before retrying: {release}")
        create_release(commit, release)
        require(CURRENT.is_symlink() and os.readlink(CURRENT) == previous_link, "Current changed during preparation; publication aborted.")
        marker = SITE / "previous-release.txt"
        require(not marker.is_symlink() and (not marker.exists() or marker.is_file()), "Invalid rollback marker path.")
        rollback_link = SITE / (".rollback-" + uuid.uuid4().hex)
        rollback_command = f"ln -s -- {shlex.quote(str(previous))} {shlex.quote(str(rollback_link))} && mv -Tf -- {shlex.quote(str(rollback_link))} {shlex.quote(str(CURRENT))}"
        marker_text = f"commit={commit}\nprevious={previous}\nprevious_link={previous_link}\nrelease={release}\nrollback={rollback_command}\n"
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=SITE, prefix=".previous-", delete=False) as record:
            record.write(marker_text)
            record.flush()
            os.fsync(record.fileno())
        os.replace(record.name, marker)
        temporary_link = SITE / (".current-" + uuid.uuid4().hex)
        os.symlink(release, temporary_link)
        os.replace(temporary_link, CURRENT)
        print(f"DEPLOYED commit={commit}\ncurrent={release}\nprevious={previous}\nrollback_record={marker}")
        print(f"Manual rollback (only if still current): {rollback_command}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"DEPLOY FAILED: {error}\nNo release directories were deleted. Inspect any partial release before retrying.", file=sys.stderr)
        sys.exit(1)
