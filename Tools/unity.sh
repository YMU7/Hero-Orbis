#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
editor="${UNITY_EDITOR:-unity-editor}"
mkdir -p Logs Builds
case "${1:-editor}" in
  editor) exec "$editor" -projectPath "$PWD" ;;
  setup) exec "$editor" -batchmode -nographics -quit -projectPath "$PWD" -executeMethod PoorWords.Editor.ProjectSetup.Configure -logFile "$PWD/Logs/setup.log" ;;
  test) exec "$editor" -batchmode -nographics -projectPath "$PWD" -runTests -testPlatform EditMode -testResults "$PWD/Builds/test-results.xml" -logFile "$PWD/Logs/tests.log" ;;
  test-play) exec "$editor" -batchmode -nographics -projectPath "$PWD" -runTests -testPlatform PlayMode -testResults "$PWD/Builds/play-results.xml" -logFile "$PWD/Logs/play-tests.log" ;;
  build-windows) exec "$editor" -batchmode -nographics -quit -projectPath "$PWD" -executeMethod PoorWords.Editor.ProjectSetup.BuildWindows -logFile "$PWD/Logs/build-windows.log" ;;
  build-linux) exec "$editor" -batchmode -nographics -quit -projectPath "$PWD" -executeMethod PoorWords.Editor.ProjectSetup.BuildLinux -logFile "$PWD/Logs/build.log" ;;
  *) echo 'Usage: bash Tools/unity.sh [editor|setup|test|test-play|build-linux|build-windows]' >&2; exit 2 ;;
esac
