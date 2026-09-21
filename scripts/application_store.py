"""Confined, hash-checked Agent Loop applications; never writes SDK/test scripts."""
import hashlib
import pathlib
import re
import os


def digest(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


class ApplicationStore:
    def __init__(self, root=None):
        self.root = root if root is not None else pathlib.Path.home() / "vxworks-agent-apps"
        self.owned = {}

    def paths(self, runId):
        if not isinstance(runId, str) or not re.fullmatch(r'agent-loop-[0-9TZa-f-]{15,80}', runId):
            raise ValueError('Invalid application run id')
        if self.root.resolve() != self.root or self.root.is_symlink():
            raise ValueError('Application root must be a canonical Linux directory')
        folder = self.root / runId
        if folder.resolve() != folder:
            raise ValueError('Application directory must not be a symlink')
        for file in (folder / 'main.c', folder / 'app.vxe'):
            if file.is_symlink() or (file.exists() and (not file.is_file() or file.stat().st_nlink != 1)):
                raise ValueError('Application files must be private regular files')
        return folder / 'main.c', folder / 'app.vxe'

    def write(self, runId, source, previousHash):
        if not isinstance(source, str) or len(source.encode('utf-8')) > 131072 or '\0' in source:
            raise ValueError('Invalid application source (maximum 128 KiB)')
        path, binary = self.paths(runId)
        if runId not in self.owned:
            if previousHash != digest(''):
                raise ValueError('Initial source hash must be empty')
            self.root.mkdir(exist_ok=True)
            path.parent.mkdir()  # Never take over a previous/user application.
            self.owned[runId] = {'source': digest(''), 'built': None}
        previous = path.read_text(encoding='utf-8') if path.exists() else ''
        if digest(previous) != previousHash or self.owned[runId]['source'] != previousHash:
            raise ValueError('Source changed outside the loop; refusing overwrite')
        temporary = path.with_suffix('.pending')
        with temporary.open('x', encoding='utf-8', newline='') as handle:
            handle.write(source)
        os.replace(temporary, path)
        self.owned[runId] = {'source': digest(source), 'built': None}
        return dict(path=str(path), previousSource=previous, sourceHash=digest(source))

    def check(self, runId):
        source, binary = self.paths(runId)
        if runId not in self.owned or digest(source.read_text(encoding='utf-8')) != self.owned[runId]['source']:
            raise ValueError('Unowned or externally modified source')
        return source, binary

    def built(self, runId):
        source, binary = self.check(runId)
        self.owned[runId]['built'] = hashlib.sha256(binary.read_bytes()).hexdigest()

    def runnable(self, runId):
        source, binary = self.check(runId)
        if not self.owned[runId]['built'] or hashlib.sha256(binary.read_bytes()).hexdigest() != self.owned[runId]['built']:
            raise ValueError('No successful build for current source/binary')
        return binary
