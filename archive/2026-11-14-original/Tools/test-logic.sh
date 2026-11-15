#!/usr/bin/env bash
# Runs the exact Unity edit-mode state tests without an editor/license.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
if ! command -v mcs >/dev/null || ! command -v mono >/dev/null; then
  if command -v nix-shell >/dev/null; then
    exec nix-shell -p mono --run 'bash Tools/test-logic.sh'
  fi
  echo 'Install Mono (mcs and mono), or run these tests with the Unity Test Runner.' >&2
  exit 2
fi
work="$(mktemp -d /tmp/poor-words-tests.XXXXXXXX)"
trap 'rm -rf -- "$work"' EXIT
for package in nunit nunitlite; do
  curl -fsSL --retry 2 "https://api.nuget.org/v3-flatcontainer/$package/3.14.0/$package.3.14.0.nupkg" -o "$work/$package.zip"
done
python3 - "$work" <<'PY'
import pathlib,sys,zipfile
root=pathlib.Path(sys.argv[1])
for p in root.glob('*.zip'):
    with zipfile.ZipFile(p) as z:
        for n in z.namelist():
            if n.startswith('lib/net45/') and n.endswith('.dll'):
                (root/pathlib.Path(n).name).write_bytes(z.read(n))
(root/'Runner.cs').write_text('public static class Runner { public static int Main(string[] args) { return new NUnitLite.AutoRun().Execute(args); } }')
PY
mcs -langversion:latest -r:"$work/nunit.framework.dll" -r:"$work/nunitlite.dll" -out:"$work/Tests.exe" Assets/Scripts/PuzzleState.cs Assets/Tests/Editor/PuzzleStateTests.cs "$work/Runner.cs"
mkdir -p Builds
mono "$work/Tests.exe" --work="$PWD/Builds" --noheader
