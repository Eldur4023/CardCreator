#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
BUILD="$ROOT/build"

cmake -S "$ROOT" -B "$BUILD" -DCMAKE_BUILD_TYPE=Release -DCMAKE_EXPORT_COMPILE_COMMANDS=ON --log-level=WARNING
cmake --build "$BUILD" -j"$(nproc)"

cd "$ROOT"
exec "$BUILD/proxys"
