# RocksDB BlobDB Filesystem Backend Handoff

Date: 2026-06-21

## Status

Draft PRs:

- Lix implementation: https://github.com/opral/lix/pull/553
- Parent experiment log and submodule pointer: https://github.com/opral/flashtype/pull/180

Branches:

- `opral/lix`: `experiment/rocksdb-blobdb-fs-backend`
- `opral/flashtype`: `experiment/rocksdb-blobdb-fs-backend`

Current recommendation:

```text
Backend: RocksDB BlobDB
BlobDB min_blob_size: 32 KiB
FastCDC min/avg/max: 256/1024/4096 KiB
Single-chunk fast path: default 64 KiB in the final measured runs
```

This should be treated as an experiment winner, not a production-ready default. The next engineering task is turning the experiment knobs into stable backend/chunking configuration.

## Executive Summary

The original problem is that the filesystem backend stores file payload chunks in SQLite. SQLite can store blobs, but this workload fights its small page-oriented design. With current FastCDC chunking, large files produce many CAS chunk rows, and opening a large diverse folder like Downloads becomes dominated by many small chunk/blob operations.

The experiment tested a filesystem-specialized RocksDB backend, then RocksDB integrated BlobDB for CAS chunk values. BlobDB fits this workload because it keeps large values out of SST/LSM files: SSTs store keys and blob pointers, while payload bytes live in blob files.

The final direct comparison against current SQLite is strong:

| Backend/config | Cold | Warm | Read all files | Read 4 largest | Repeat 4 largest | Read 16 small | `.lix` total | CAS chunks |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SQLite current `16/64/256` | 17232 ms | 11506 ms | 3231 ms | 12570 ms | 12230 ms | 50196 ms | 1.636 GB | 20,223 |
| BlobDB 32 KiB + FastCDC `256/1024/4096` | 6431 ms | 3772 ms | 799 ms | 2609 ms | 2206 ms | 9543 ms | 1.602 GB | 1,745 |

Compared with current SQLite on the sanitized Downloads sample, the BlobDB candidate was:

- 2.7x faster on cold open/import.
- 3.0x faster on warm reopen.
- 4.0x faster reading all files.
- 4.8-5.5x faster reading the four largest files.
- 5.3x faster on the 16-small-file point-read sample.
- 11.6x fewer unique CAS chunk rows.
- Slightly smaller on disk.

## Corpus And Harness

Corpus:

```text
submodule/lix/target/fs-backend-experiment/downloads-sample/corpus
```

This is a deterministic sanitized sample from the user's Downloads folder:

- 604 files.
- About 1.61 GB logical bytes.
- Mix of small text/code, PDFs/docs, spreadsheet/data files, images, archives/installers, medium media files, and four large files.

Main harness:

```text
submodule/lix/packages/rs-sdk/examples/profile_fs_open.rs
```

Important profiler features added during the experiment:

- `--backend sqlite|rocksdb|rocksdb-blob`
- `--blob-min <size>`
- `--json`
- `--keep-workspace`
- `--compact-before-stats`
- `--read-bench`
- Disk layout stats for SQLite and RocksDB.
- Binary CAS row stats.
- CAS chunk existence lookup metrics.
- Read benchmark timings.

FastCDC experiment env vars:

```text
LIX_EXPERIMENT_FASTCDC_MIN_BYTES
LIX_EXPERIMENT_FASTCDC_AVG_BYTES
LIX_EXPERIMENT_FASTCDC_MAX_BYTES
LIX_EXPERIMENT_FASTCDC_SINGLE_BYTES
```

Important caveat: final candidate runs set min/avg/max only. The single-chunk fast path stayed at the default `64 KiB`.

## Implementation Summary

The experiment adds a new filesystem-specialized backend crate:

```text
submodule/lix/packages/fs-backend
```

Key idea: this is not a generic `lix_backends` replacement. It is a persistence layer specialized for filesystem CAS payloads and the existing `FilesystemSync<B>` path.

Implemented in Lix:

- New `lix_fs_backend` crate.
- RocksDB filesystem backend with optional integrated BlobDB.
- `lix_sdk` feature wiring for RocksDB filesystem open paths.
- `profile_fs_open` backend selection and JSON profiling.
- Disk-size classification for SQLite and RocksDB files.
- Binary CAS stats collection.
- FastCDC experiment overrides.
- RocksDB compaction profiling hook.
- Skip-existing CAS chunk payload writes.
- Batched CAS chunk existence checks.
- Read benchmark support.
- RocksDB Rust wrapper upgraded from `rocksdb 0.22` / RocksDB 8.10 to `rocksdb 0.24` / RocksDB 10.4.2.

The main SDK/profiler open paths are:

```rust
FsBackend::open_rocksdb(...)
FsBackend::open_rocksdb_with_blob_options(...)
```

The BlobDB backend still uses normal RocksDB writes. Existing `WriteBatch::put(key, value)` style code remains viable; BlobDB behavior is enabled through RocksDB options.

## Major Findings

### 1. Current SQLite Suffers From Too Many CAS Chunk Rows

Current chunking:

```text
FastCDC min/avg/max: 16/64/256 KiB
single-chunk fast path: 64 KiB
```

On the Downloads sample, SQLite/current produced:

```text
CAS chunk rows: 20,223
CAS chunk refs: 20,299
Cold open/import median: 17.2 s
Warm reopen median: 11.5 s
```

The same corpus with the BlobDB candidate produced:

```text
CAS chunk rows: 1,745
CAS chunk refs: 1,746
Cold open/import median: 6.4 s
Warm reopen median: 3.8 s
```

The largest single win is not BlobDB alone. It is BlobDB plus much larger chunking, which reduces row/key count by about 11.6x.

### 2. Plain RocksDB Helps, But BlobDB Has Better Storage Shape

Plain RocksDB improves over SQLite, especially with larger chunks, but it stores payload bytes in SST files. BlobDB keeps payload mass out of SST/LSM.

Core post-batching matrix at FastCDC `256/1024/4096 KiB`:

| Backend | BlobDB min | Cold | Warm | Lookup keys | Lookup batches | Lookup time | `.lix` total | SST | Blob | CAS chunks |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| rocksdb | - | 7246 ms | 3838 ms | 1,757 | 589 | 396 ms | 1.728 GB | 1.728 GB | 0 B | 1,745 |
| rocksdb-blob | 16 KiB | 6277 ms | 3642 ms | 1,757 | 589 | 6.5 ms | 1.602 GB | 2.4 MB | 1.600 GB | 1,745 |
| rocksdb-blob | 32 KiB | 6243 ms | 3698 ms | 1,757 | 589 | 6.1 ms | 1.602 GB | 2.9 MB | 1.599 GB | 1,745 |

BlobDB keeps SSTs around a few MB while the payload bytes live in blob files.

### 3. BlobDB 16 KiB And 32 KiB Are Close; 32 KiB Is The Current Candidate

16 KiB and 32 KiB were very close across open/import, rewrite/delete, and reads.

Why 32 KiB is currently preferred:

- It had the best read-benchmark medians in the latest read matrix.
- It was slightly faster in the final direct SQLite-vs-candidate comparison.
- It keeps the same practical storage shape as 16 KiB on the larger FastCDC profile.

Why 16 KiB remains a plausible fallback:

- Slightly smaller SST footprint in some runs.
- Slightly better compaction time in the single rewrite/delete run.

Recommendation: default the next production-config experiment to BlobDB 32 KiB, but keep 16 KiB one config flag away.

### 4. FastCDC `256/1024/4096 KiB` Was Best For This Corpus

Earlier candidates:

- `128/512/2048 KiB` was initially strong.
- Neighborhood sweeps showed `192/768/3072` and `256/1024/4096` beat it on the Downloads sample.
- `256/1024/4096` had the best cold median and the fewest CAS chunk rows in the sweep.

Important nuance: larger chunks are known to regress SQLite, so the final baseline did not test SQLite with larger chunking. The candidate is intentionally a backend+chunking package: BlobDB makes larger chunks viable for this workload.

### 5. Skip-Existing Chunk Payload Writes Were Necessary

Initial rewrite/delete stress showed BlobDB could grow much larger than plain RocksDB after rewrites/deletes because existing CAS chunk payloads were being written again.

Fix:

- Before staging a CAS chunk payload, check whether that chunk key already exists.
- Still write new blob manifests and manifest-chunk references for history.
- Skip duplicate chunk payload writes.

Effect after skip-existing:

| Variant | Backend | Stage | `.lix` total | SST | Blob | CAS chunks | CAS refs |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| before skip | BlobDB 16 KiB | delete | 2.943 GB | 2.5 MB | 2.940 GB | 1,774 | 3,305 |
| before skip | BlobDB 16 KiB | compact after delete | 2.576 GB | 2.6 MB | 2.573 GB | 1,774 | 3,305 |
| after skip | BlobDB 16 KiB | delete | 1.661 GB | 2.5 MB | 1.659 GB | 1,774 | 3,305 |
| after skip | BlobDB 16 KiB | compact after delete | 1.661 GB | 2.6 MB | 1.659 GB | 1,774 | 3,305 |

Interpretation: the earlier BlobDB disk-size penalty was mostly duplicate payload writes, not inevitable BlobDB garbage.

### 6. Batched Existence Checks Are Cleaner, But Not The Main Win

The first skip-existing implementation did one key-only lookup per chunk. This was then batched per file/blob using `PointReadPlan::from_unique_keys`.

Post-batching:

```text
Lookup keys: 1,757
Lookup batches: 589
```

Plain RocksDB lookup time improved modestly:

```text
Before batching: about 489 ms
After batching: about 396-416 ms
```

BlobDB lookup time was already tiny and stayed tiny:

```text
about 6-7 ms
```

Keep batching because it is architecturally better and avoids avoidable backend calls, but do not expect it to change the overall conclusion.

### 7. BlobDB Did Not Show A Meaningful Read Regression

Read benchmark matrix at BlobDB candidate chunking:

| Backend | BlobDB min | Cold | Warm | Read all files | Read 4 largest | Repeat 4 largest | Read 16 small | `.lix` total | SST | Blob |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| rocksdb | - | 7097 ms | 3906 ms | 812 ms | 2482 ms | 2185 ms | 8686 ms | 1.603 GB | 1.602 GB | 0 B |
| rocksdb-blob | 16 KiB | 6636 ms | 3895 ms | 800 ms | 2780 ms | 2307 ms | 8943 ms | 1.602 GB | 2.4 MB | 1.600 GB |
| rocksdb-blob | 32 KiB | 6283 ms | 3712 ms | 794 ms | 2415 ms | 2128 ms | 8214 ms | 1.602 GB | 2.8 MB | 1.599 GB |

Interpretation:

- Full-corpus reads were essentially tied.
- Largest-file reads were noisy; BlobDB 32 KiB was best in the median.
- Small-file point reads were slow for all backends, suggesting SQL/read-path overhead rather than BlobDB indirection.

An initial 128-small-file point-read benchmark took about 71-75 seconds across backends. The reportable matrix uses 16 small files to keep the benchmark tractable while preserving the signal.

### 8. Rewrite/Delete Stress Still Favors BlobDB Shape

Post-batching rewrite/delete stress:

Workload:

- Import Downloads sample.
- Patch three 4 KiB regions in each of the four largest files for three rounds.
- Delete those four files.
- Force compact.

| Backend | Stage | Open | Compact | `.lix` total | SST | Blob | CAS chunks | CAS refs | Live corpus |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| rocksdb | compact after delete | 2517 ms | 436 ms | 1.664 GB | 1.663 GB | 0 B | 1,781 | 3,309 | 949.2 MB |
| rocksdb-blob 16 KiB | compact after delete | 2392 ms | 112 ms | 1.663 GB | 2.6 MB | 1.661 GB | 1,781 | 3,309 | 949.2 MB |
| rocksdb-blob 32 KiB | compact after delete | 2457 ms | 123 ms | 1.663 GB | 3.1 MB | 1.660 GB | 1,781 | 3,309 | 949.2 MB |

Interpretation:

- Rewrites grew physical `.lix` size by only about 61 MB for all backends after skip-existing payload writes.
- CAS refs grew because history keeps references to new file versions.
- BlobDB kept SSTs tiny after delete+compact.
- Forced compaction was cheaper for BlobDB in this single run.

### 9. RocksDB Upgrade Notes

The Rust wrapper was upgraded:

```text
rocksdb 0.22 / librocksdb-sys 0.16.0+8.10.0
to
rocksdb 0.24 / librocksdb-sys 0.17.3+10.4.2
```

This is not latest upstream RocksDB 11.5.0. It is the latest crates.io Rust wrapper observed during the experiment, packaging RocksDB 10.4.2.

Local build caveat:

```sh
DYLD_LIBRARY_PATH=/opt/homebrew/opt/llvm/lib \
LIBCLANG_PATH=/opt/homebrew/opt/llvm/lib \
cargo check -p lix_sdk --features sqlite,rocksdb --example profile_fs_open
```

The newer `librocksdb-sys` bindgen runtime needs `libclang.dylib` locally.

The upgrade did not remove plain RocksDB lookup cost, but it improved some BlobDB medians and reduced plain RocksDB disk size in one comparison.

## Productionization Plan

### 1. Replace Experiment Env Vars With Real Config

Move from env-only knobs:

```text
LIX_EXPERIMENT_FASTCDC_MIN_BYTES
LIX_EXPERIMENT_FASTCDC_AVG_BYTES
LIX_EXPERIMENT_FASTCDC_MAX_BYTES
LIX_EXPERIMENT_FASTCDC_SINGLE_BYTES
```

to explicit options, for example:

```rust
pub struct FilesystemBackendOptions {
    pub storage: FilesystemStorageOptions,
    pub chunking: FastCdcProfile,
}

pub enum FilesystemStorageOptions {
    Sqlite,
    RocksDb {
        blob: RocksDbBlobOptions,
    },
}

pub struct FastCdcProfile {
    pub min_chunk_bytes: usize,
    pub avg_chunk_bytes: usize,
    pub max_chunk_bytes: usize,
    pub single_chunk_fast_path_max_bytes: usize,
}
```

Recommended candidate profile:

```text
min_chunk_bytes: 256 KiB
avg_chunk_bytes: 1024 KiB
max_chunk_bytes: 4096 KiB
single_chunk_fast_path_max_bytes: 64 KiB, unless separately benchmarked
blob_min_size: 32 KiB
```

Do not silently change the single-chunk fast path to 1024 KiB unless you benchmark that exact config.

### 2. Add A Stable SDK Open Path

Possible shape:

```rust
FsBackend::open_with_options(path, FilesystemBackendOptions { ... })
```

or a narrower first step:

```rust
FsBackend::open_rocksdb_filesystem(path, options)
```

Keep SQLite as the default until migration/compatibility is decided.

### 3. Decide Migration And Compatibility Story

Open question:

- Is this a new workspace format/backend choice only?
- Or do existing SQLite `.lix` folders need in-place migration?

The experiment does not implement migration. It only compares fresh imports/opening behavior.

### 4. Keep The Useful Profiler, Separate Experiment-Only Bits

Keep:

- backend selection
- JSON output
- disk stats
- CAS stats
- read benchmark
- compaction hook if behind an obvious benchmark-only affordance

Clean up:

- env-based FastCDC overrides
- benchmark-only naming
- any options that should become typed config

### 5. Add Production Tests

Suggested tests:

- BlobDB backend roundtrips file data through `FsBackend`.
- Large file imports produce bounded CAS chunk counts with the selected profile.
- Rewrites do not restage existing CAS chunk payloads.
- Duplicate chunks inside one transaction stage payload once.
- Read benchmark path continues to return exact byte counts.
- SQLite/default path is unaffected.

### 6. Re-run Benchmarks After Config Refactor

Before making it non-draft:

- Re-run SQLite current vs BlobDB candidate.
- Re-run rewrite/delete stress.
- Re-run read benchmark.
- Confirm the measured single-chunk fast-path config matches the new typed default.

## Known Risks And Open Questions

### BlobDB Maintenance

RocksDB integrated BlobDB is part of the RocksDB codebase and exposed through the Rust wrapper options. It appears maintained enough to test, but we did not do a long-term operational review beyond wrapper/API availability and benchmarks.

### Blob File GC/Space Reclamation

BlobDB separates payloads from the LSM, but overwritten/deleted blob values are reclaimed later through BlobDB GC/compaction behavior. Skip-existing chunk writes fixed the major duplicate-write blow-up in this workload, but long-running workspaces still need retention/GC observation.

### Small Point Reads Are Slow

The 16-small-file point-read benchmark is slow for all backends. This appears to be higher-level SQL/read-path overhead, not BlobDB specifically. It is worth profiling separately if small random reads are a critical workflow.

### Corpus Specificity

The corpus was a sanitized sample of one user's Downloads folder. It is intentionally relevant to the motivating workflow, but not necessarily representative of all users.

### SQLite Large Chunking Was Not Re-tested In Final Baseline

We intentionally did not include SQLite with large chunks in the final comparison because earlier discussion and results showed it regresses against SQLite's page-oriented design. The final conclusion is about the combined backend+chunking candidate, not chunking alone.

## Reproduction Commands

Build profiler:

```sh
cd /Users/samuel/git-repos/flashtype2/submodule/lix
DYLD_LIBRARY_PATH=/opt/homebrew/opt/llvm/lib \
LIBCLANG_PATH=/opt/homebrew/opt/llvm/lib \
cargo build --release -p lix_sdk --features sqlite,rocksdb --example profile_fs_open
```

SQLite current/default chunking:

```sh
REPEAT=0 \
../../target/release/examples/profile_fs_open \
  --json \
  --read-bench \
  --backend sqlite \
  target/fs-backend-experiment/downloads-sample/corpus
```

BlobDB candidate:

```sh
REPEAT=0 \
LIX_EXPERIMENT_FASTCDC_MIN_BYTES=262144 \
LIX_EXPERIMENT_FASTCDC_AVG_BYTES=1048576 \
LIX_EXPERIMENT_FASTCDC_MAX_BYTES=4194304 \
../../target/release/examples/profile_fs_open \
  --json \
  --read-bench \
  --backend rocksdb-blob \
  --blob-min 32KiB \
  target/fs-backend-experiment/downloads-sample/corpus
```

Note: these commands do not set `LIX_EXPERIMENT_FASTCDC_SINGLE_BYTES`.

## Validation Performed

Across the experiment, the following checks were run at relevant stages:

```sh
cargo fmt -p lix_engine -p lix_sdk
cargo test -p lix_engine binary_cas --lib
cargo test -p lix_engine existing_chunk_aware_writer_skips_persisted_chunk_payloads --lib
cargo test -p lix_fs_backend --features rocksdb
cargo test -p lix_sdk --features sqlite,rocksdb filesystem::tests:: -- --nocapture
cargo check -p lix_sdk --features sqlite,rocksdb --example profile_fs_open
cargo build --release -p lix_sdk --features sqlite,rocksdb --example profile_fs_open
cargo check -p lix_sdk --features sqlite --example profile_fs_open
```

RocksDB feature checks locally needed:

```sh
DYLD_LIBRARY_PATH=/opt/homebrew/opt/llvm/lib
LIBCLANG_PATH=/opt/homebrew/opt/llvm/lib
```

## Bottom Line

For the goal "open this Downloads folder faster," the experiment supports moving forward with:

```text
RocksDB integrated BlobDB, min_blob_size 32 KiB
FastCDC min/avg/max 256/1024/4096 KiB
skip-existing CAS chunk payload writes
batched CAS chunk existence checks
```

The strongest evidence is the final direct baseline: the candidate beats current SQLite on open/import, warm reopen, full reads, largest-file reads, small point reads, chunk-row count, and disk size on the motivating corpus.

