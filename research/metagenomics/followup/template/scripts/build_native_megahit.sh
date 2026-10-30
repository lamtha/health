#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/environment.sh"
# Pinned source is downloaded separately. Reverify before extracting/building.
python results/followup/scripts/fetch_tools.py megahit-v1.2.9.tar.gz --verify-only
src=analysis/tools/megahit-native
mkdir -p "$src"
tar -xzf analysis/followup/references/megahit-v1.2.9.tar.gz -C "$src" --strip-components 1
patch -d "$src" -p1 < results/followup/scripts/megahit_arm64_cpu_guards.patch
analysis/envs/assembly/bin/cmake -S "$src" -B "$src/build" -DCMAKE_BUILD_TYPE=Release -DCMAKE_C_COMPILER="${CC:-/opt/homebrew/bin/gcc-15}" -DCMAKE_CXX_COMPILER="${CXX:-/opt/homebrew/bin/g++-15}" -DCMAKE_OSX_ARCHITECTURES=arm64
analysis/envs/assembly/bin/cmake --build "$src/build" --target megahit_core_no_hw_accel -j 8
cp "$src/src/megahit" "$src/build/megahit"
chmod +x "$src/build/megahit"
ln -sf megahit_core_no_hw_accel "$src/build/megahit_core"
ln -sf megahit_core_no_hw_accel "$src/build/megahit_toolkit"
PATH="$PWD/$src/build:$PWD/analysis/envs/metagenomics/bin:$PATH" "$src/build/megahit" --test --no-hw-accel -t 2 -o analysis/followup/work/megahit_native_test_reproduction
