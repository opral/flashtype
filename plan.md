Yep. I’d set this up as two separate tests so we do not blur the answer:

1. Does RocksDB/BlobDB help with the current 16/64/256 KiB FastCDC layout?
2. Once SQLite is no longer the constraint, can we safely raise chunk sizes?

The current code makes this pretty approachable: `FsBackend::open` hardwires persistent filesystem storage to SQLite, but `FilesystemSync<B>` is already generic over `Backend`, so the first implementation should be a narrow RocksDB persistent open path, not a filesystem rewrite. See [filesystem.rs](/Users/samuel/git-repos/flashtype2/submodule/lix/packages/rs-sdk/src/filesystem.rs:253) and [filesystem.rs](/Users/samuel/git-repos/flashtype2/submodule/lix/packages/rs-sdk/src/filesystem.rs:445). The RocksDB backend already uses snapshots for reads and atomic `WriteBatch` commits, so I would not introduce `TransactionDB` in the first pass. That would add a variable before we know if BlobDB/chunk sizing is the win. See [rocksdb.rs](/Users/samuel/git-repos/flashtype2/submodule/lix/packages/backends/src/rocksdb.rs:119) and [rocksdb.rs](/Users/samuel/git-repos/flashtype2/submodule/lix/packages/backends/src/rocksdb.rs:310).

**Minimal Experiment**
Add:

```rust
pub enum RocksDbProfile {
    Plain,
    BlobDb {
        min_blob_size: u64,
        blob_file_size: u64,
        enable_gc: bool,
        gc_age_cutoff: f64,
    },
}
```

Then add `RocksDbBackend::open_with_options(...)` and keep `RocksDbBackend::open(...)` as today’s plain default. The options go into [rocksdb.rs](/Users/samuel/git-repos/flashtype2/submodule/lix/packages/backends/src/rocksdb.rs:441).

Then add an rs-sdk `rocksdb` feature and a benchmark-only/public-hidden open path like:

```rust
FsBackend::open_rocksdb_with_options(dir, rocksdb_options)
```

Extend `profile_fs_open` with:

```sh
--backend sqlite
--backend rocksdb
--backend rocksdb-blob --blob-min 16384
```

The PR already uses `profile_fs_open` as the folder-open validation harness, and its PR body reports sub-second `/Users/samuel/Downloads` opens after the descriptor/hash work, so that is the right E2E baseline to preserve. Source: PR #549 summary and validation notes on GitHub.

**Benchmark Matrix**
First pass:

```text
sqlite current
rocksdb plain
rocksdb blob min=16KiB
rocksdb blob min=32KiB
rocksdb blob min=64KiB
rocksdb blob min=128KiB
rocksdb blob min=256KiB
```

Keep current chunking fixed for that pass: [chunking.rs](/Users/samuel/git-repos/flashtype2/submodule/lix/packages/engine/src/binary_cas/chunking.rs:1).

Second pass, only after RocksDB/BlobDB looks promising:

```text
FastCDC 16/64/256 KiB
FastCDC 32/128/512 KiB
FastCDC 64/256/1024 KiB
maybe FastCDC 128/512/2048 KiB
matching single-chunk threshold variants
```

Important subtlety: BlobDB sees the encoded CAS chunk values, not original files. Since current chunks average 64 KiB, `min_blob_size = 64KiB` may only blob a subset of chunks. That is why I’d test 16 and 32 KiB too.

**What To Measure**
For each run:

```text
cold open/import time
warm reopen time
no-op reopen/sync time
large-file read time
small random chunk/file read time
rewrite after tiny edit near beginning/middle/end
delete large file
database directory size
SST size
blob file size
WAL size
chunk count
binary_cas manifest rows
binary_cas manifest_chunk rows
binary_cas chunk rows
commit put_entries / written_bytes
```

Also flush/close/reopen before measuring disk layout. Integrated BlobDB can move values to blob files during flush/compaction, so measuring immediately after writes can lie.

**Decision Rule**
BlobDB is a win if it improves large-file import/rewrite/storage without making many-small-file opens noticeably worse. But if the bottleneck is mostly “too many CAS keys,” BlobDB will not solve that alone; then the real win is probably RocksDB BlobDB plus larger FastCDC chunks.

My recommended first concrete move: add the RocksDB options/open path and extend `profile_fs_open` into a backend-selectable JSON-emitting harness. Then run the matrix against one synthetic corpus and `/Users/samuel/Downloads`.

## Log

- 2026-06-21: Replaced the existing catalog MVP plan with the RocksDB/BlobDB filesystem backend testing plan.
- 2026-06-21: Confirmed the first experiment can stay narrow: add RocksDB backend options/open plumbing and reuse the generic `FilesystemSync<B>` path.
- 2026-06-21: Next progress item is to extend `profile_fs_open` with backend selection, BlobDB thresholds, and JSON output for matrix runs.
- 2026-06-21: Created the `lix_fs_backend` crate in `submodule/lix/packages/fs-backend` with a filesystem-specialized RocksDB backend that owns BlobDB options directly and does not depend on `lix_backends`.
- 2026-06-21: Wired `lix_fs_backend` into `lix_sdk` behind a `rocksdb` feature and extended `profile_fs_open` with `--backend sqlite|rocksdb|rocksdb-blob`, `--blob-min`, and `--json`.
- 2026-06-21: Ran the first synthetic import/open matrix against a 32 MiB corpus with 83 files. Results: SQLite cold/warm 387/111 ms; plain RocksDB 263/127 ms; BlobDB min 16 KiB 275/129 ms; 32 KiB 261/132 ms; 64 KiB 278/128 ms; 128 KiB 271/129 ms; 256 KiB 279/128 ms.
- 2026-06-21: Verification passed: `cargo check -p lix_sdk --features sqlite,rocksdb --example profile_fs_open`, `cargo test -p lix_fs_backend --features rocksdb`, and `cargo test -p lix_sdk --features sqlite,rocksdb filesystem::tests:: -- --nocapture`.
- 2026-06-21: Rebasing target changed from PR #548 to PR #549 (`e0c5bfe3 Batch lix_file filesystem upserts`) because #548 was only a prototype. The experiment commits rebased cleanly onto PR #549.
- 2026-06-21: Reran the same 32 MiB / 83 file synthetic matrix on PR #549. Results: SQLite cold/warm 221/108 ms; plain RocksDB 135/129 ms; BlobDB min 16 KiB 135/129 ms; 32 KiB 143/130 ms; 64 KiB 137/134 ms; 128 KiB 138/135 ms; 256 KiB 141/136 ms.
- 2026-06-21: PR #549 verification passed: `cargo check -p lix_sdk --features sqlite,rocksdb --example profile_fs_open`, `cargo test -p lix_fs_backend --features rocksdb`, and `cargo test -p lix_sdk --features sqlite,rocksdb filesystem::tests:: -- --nocapture`.
- 2026-06-21: Extended `profile_fs_open` JSON/text output with corpus size, `.lix` total size, SQLite db/wal/shm bytes, and RocksDB SST/blob/WAL/log/manifest/options bytes. Added `--keep-workspace` to preserve and print the copied temp workspace for inspection.
- 2026-06-21: Smoke-ran stats output on the 32 MiB corpus. SQLite reported `.lix`/db size around 34.6 MiB. RocksDB BlobDB at 64 KiB reported about 33.8 MiB total, split into about 5.5 MiB SST and 28.2 MiB blob files, and the preserved workspace path was verified on disk.
- 2026-06-21: Built a deterministic sanitized Downloads sample at `submodule/lix/target/fs-backend-experiment/downloads-sample/corpus` with 604 files / 1.61 GB. Composition: 250 small text/code files, 80 small misc files, 119 docs/PDFs, 15 spreadsheet/data files, 112 images, 18 archives/installers, 6 medium media files, and 4 large mixed files.
- 2026-06-21: Ran the stats matrix on the Downloads sample. SQLite cold/warm 14136/12730 ms, `.lix` 1.636 GB. Plain RocksDB 7347/6838 ms, SST 1.599 GB, blob 0. BlobDB 16 KiB 6815/5310 ms, SST 4.7 MB, blob 1.596 GB. BlobDB 32 KiB 6636/5100 ms, SST 64.6 MB, blob 1.536 GB. BlobDB 64 KiB 7080/5843 ms, SST 251.5 MB, blob 1.351 GB. BlobDB 128 KiB 7634/5687 ms, SST 1.280 GB, blob 347.7 MB. BlobDB 256 KiB 7323/5879 ms, SST 1.582 GB, blob 19.7 MB.
- 2026-06-21: Added experiment-only FastCDC runtime overrides for chunk sizing: `LIX_EXPERIMENT_FASTCDC_MIN_BYTES`, `LIX_EXPERIMENT_FASTCDC_AVG_BYTES`, `LIX_EXPERIMENT_FASTCDC_MAX_BYTES`, and `LIX_EXPERIMENT_FASTCDC_SINGLE_BYTES`. Defaults remain the current 16/64/256 KiB with 64 KiB single-chunk fast path when the variables are unset.
- 2026-06-21: Ran the combined Downloads sample matrix for BlobDB 16 KiB and 32 KiB against FastCDC 16/64/256, 32/128/512, 64/256/1024, and 128/512/2048 KiB. Single-run results:

| BlobDB min | FastCDC min/avg/max | Single threshold | Cold | Warm | `.lix` total | SST | Blob |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 16 KiB | 16/64/256 KiB | 64 KiB | 6782 ms | 5024 ms | 1,601,155,104 B | 4,756,476 B | 1,596,238,370 B |
| 16 KiB | 32/128/512 KiB | 128 KiB | 5966 ms | 4376 ms | 1,600,010,692 B | 3,322,336 B | 1,596,528,201 B |
| 16 KiB | 64/256/1024 KiB | 256 KiB | 5868 ms | 3990 ms | 1,601,711,500 B | 2,818,165 B | 1,598,733,259 B |
| 16 KiB | 128/512/2048 KiB | 512 KiB | 5679 ms | 3586 ms | 1,603,459,167 B | 2,431,776 B | 1,600,867,343 B |
| 32 KiB | 16/64/256 KiB | 64 KiB | 6248 ms | 4814 ms | 1,600,985,828 B | 64,505,533 B | 1,536,320,354 B |
| 32 KiB | 32/128/512 KiB | 128 KiB | 6457 ms | 5100 ms | 1,599,975,689 B | 4,257,167 B | 1,595,558,358 B |
| 32 KiB | 64/256/1024 KiB | 256 KiB | 6757 ms | 4734 ms | 1,601,684,442 B | 3,498,240 B | 1,598,026,125 B |
| 32 KiB | 128/512/2048 KiB | 512 KiB | 5770 ms | 3725 ms | 1,603,623,627 B | 3,129,014 B | 1,600,334,565 B |

- 2026-06-21: Current best single run is BlobDB 16 KiB plus FastCDC 128/512/2048 KiB at 5679/3586 ms cold/warm on the sanitized Downloads sample. BlobDB 32 KiB plus 128/512/2048 KiB was close at 5770/3725 ms. Repeat runs are needed before treating this as a stable ranking.
- 2026-06-21: Verification passed after adding FastCDC overrides: `cargo check -p lix_sdk --features sqlite,rocksdb --example profile_fs_open`, `cargo build --release -p lix_sdk --features sqlite,rocksdb --example profile_fs_open`, `cargo test -p lix_engine binary_cas --lib`, and `cargo test -p lix_sdk --features sqlite,rocksdb filesystem::tests:: -- --nocapture`.
- 2026-06-21: Added binary CAS storage stats to the engine and `profile_fs_open`: manifest rows, empty/single/chunked blob manifests, manifest-chunk rows, unique chunk rows, total chunk refs, and logical blob bytes. The profiler counts chunk rows with key-only scans so it does not read all blob payloads just to collect counts.
- 2026-06-21: Repeated the strongest Downloads sample candidates with 5 runs each using `REPEAT=0`. Medians:

| BlobDB min | FastCDC min/avg/max | Single threshold | Cold median | Warm median | `.lix` median | SST median | Blob median | CAS chunk rows | CAS chunk refs | Manifest chunk rows | Chunked blobs |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 16 KiB | 128/512/2048 KiB | 512 KiB | 5924 ms | 3917 ms | 1,603,536,751 B | 2,513,333 B | 1,600,867,343 B | 2,957 | 2,958 | 2,489 | 114 |
| 16 KiB | 64/256/1024 KiB | 256 KiB | 6553 ms | 4305 ms | 1,601,659,542 B | 2,766,391 B | 1,598,733,259 B | 5,408 | 5,417 | 4,982 | 148 |
| 32 KiB | 128/512/2048 KiB | 512 KiB | 6753 ms | 4210 ms | 1,603,507,672 B | 3,017,026 B | 1,600,334,565 B | 2,957 | 2,958 | 2,489 | 114 |
| 16 KiB | 16/64/256 KiB | 64 KiB | 11235 ms | 8050 ms | 1,601,179,844 B | 4,781,402 B | 1,596,238,370 B | 20,223 | 20,299 | 19,964 | 248 |

- 2026-06-21: The repeated run keeps BlobDB 16 KiB plus FastCDC 128/512/2048 KiB as the best candidate. It reduces unique CAS chunk rows from 20,223 to 2,957, about an 85% reduction, while improving median cold/warm open from 11235/8050 ms to 5924/3917 ms versus current chunking on the same BlobDB threshold.
- 2026-06-21: Verification passed after adding CAS stats: `cargo test -p lix_engine binary_cas --lib`, `cargo check -p lix_sdk --features sqlite,rocksdb --example profile_fs_open`, `cargo build --release -p lix_sdk --features sqlite,rocksdb --example profile_fs_open`, `cargo check -p lix_sdk --features sqlite --example profile_fs_open`, and `cargo test -p lix_sdk --features sqlite,rocksdb filesystem::tests:: -- --nocapture`.
- 2026-06-21: Ran a follow-up backend comparison and neighborhood sweep using 5 runs each. Plain RocksDB also benefits from larger chunks, but BlobDB still wins warm reopen and keeps SSTs tiny. 128/512/2048 KiB is not the open/import optimum on this Downloads sample; 192/768/3072 and 256/1024/4096 both beat it in this sweep.

| Backend | BlobDB min | FastCDC min/avg/max | Single threshold | Cold median | Warm median | `.lix` median | SST median | Blob median | CAS chunk rows | CAS chunk refs | Manifest chunk rows | Chunked blobs |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| rocksdb-blob | 16 KiB | 256/1024/4096 KiB | 1024 KiB | 5712 ms | 3666 ms | 1,603,150,721 B | 2,383,234 B | 1,600,611,441 B | 1,738 | 1,739 | 1,248 | 92 |
| rocksdb-blob | 16 KiB | 192/768/3072 KiB | 768 KiB | 5779 ms | 3636 ms | 1,603,320,125 B | 2,361,578 B | 1,600,802,497 B | 1,921 | 1,922 | 1,437 | 98 |
| rocksdb-blob | 16 KiB | 96/384/1536 KiB | 384 KiB | 5838 ms | 3747 ms | 1,601,708,114 B | 2,515,112 B | 1,599,036,920 B | 3,391 | 3,397 | 2,943 | 129 |
| rocksdb-blob | 16 KiB | 128/512/2048 KiB | 512 KiB | 5868 ms | 3718 ms | 1,603,534,911 B | 2,511,490 B | 1,600,867,343 B | 2,957 | 2,958 | 2,489 | 114 |
| rocksdb | - | 128/512/2048 KiB | 512 KiB | 6006 ms | 4189 ms | 1,602,842,938 B | 1,602,571,534 B | 0 B | 2,957 | 2,958 | 2,489 | 114 |
| rocksdb | - | 16/64/256 KiB | 64 KiB | 6601 ms | 5540 ms | 1,599,651,528 B | 1,599,375,863 B | 0 B | 20,223 | 20,299 | 19,964 | 248 |

- 2026-06-21: Current open/import recommendation is BlobDB 16 KiB with a larger-than-128/512/2048 FastCDC profile. 256/1024/4096 had the best cold median and fewest CAS chunk rows; 192/768/3072 had the best warm median. The final choice should also be tested against full-file reads, random reads, tiny rewrites, deletes, and dedup behavior before changing defaults.
- 2026-06-21: Added a benchmark-only compaction hook to the RocksDB filesystem backend and `profile_fs_open` via `--compact-before-stats`.
- 2026-06-21: Ran a single rewrite/delete stress test at FastCDC 256/1024/4096 KiB. Workload: import the Downloads sample, patch three 4 KiB regions in each of the four largest files for three rounds, then delete those four files, then force compact. This changes about 661 MB of live corpus bytes by deletion and keeps Lix history/CAS rows, so old versions are still intentionally retained.

| Backend | Stage | Open | Compact | `.lix` total | SST | Blob | CAS chunks | CAS chunk refs | Live corpus |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| rocksdb | initial | 5957 ms | - | 1,602,423,130 B | 1,546,221,571 B | 0 B | 1,738 | 1,739 | 1,610,600,522 B |
| rocksdb | rewrite round 3 | 5707 ms | - | 2,028,181,514 B | 1,891,930,194 B | 0 B | 1,774 | 3,305 | 1,610,600,522 B |
| rocksdb | delete | 3964 ms | - | 2,028,246,451 B | 2,027,448,429 B | 0 B | 1,774 | 3,305 | 949,167,784 B |
| rocksdb | compact after delete | 3377 ms | 891 ms | 1,661,927,185 B | 1,661,088,048 B | 0 B | 1,774 | 3,305 | 949,167,784 B |
| rocksdb-blob 16 KiB | initial | 6259 ms | - | 1,603,008,795 B | 1,126,057 B | 1,545,792,112 B | 1,738 | 1,739 | 1,610,600,522 B |
| rocksdb-blob 16 KiB | rewrite round 3 | 5263 ms | - | 2,942,829,179 B | 2,456,545 B | 2,804,531,432 B | 1,774 | 3,305 | 1,610,600,522 B |
| rocksdb-blob 16 KiB | delete | 3563 ms | - | 2,942,916,776 B | 2,491,141 B | 2,940,021,502 B | 1,774 | 3,305 | 949,167,784 B |
| rocksdb-blob 16 KiB | compact after delete | 2411 ms | 38 ms | 2,575,900,213 B | 2,551,077 B | 2,572,989,064 B | 1,774 | 3,305 | 949,167,784 B |

- 2026-06-21: Rewrite/delete result: BlobDB does what we expected for LSM pressure. Plain RocksDB SST grew from 1.55 GB to 2.03 GB before compaction and remained 1.66 GB after compaction. BlobDB SST stayed around 1-2.6 MB throughout, and forced compaction was much cheaper in this run (38 ms vs 891 ms). The tradeoff is visible too: BlobDB total bytes were larger because blob files held historical/garbage values after rewrites and deletes, only partially reclaimed by forced compaction. Next useful work is blob GC/retention tuning and read/rewrite latency on these larger chunk profiles.
- 2026-06-21: Verification passed after adding the compaction hook: `cargo check -p lix_sdk --features sqlite,rocksdb --example profile_fs_open`, `cargo build --release -p lix_sdk --features sqlite,rocksdb --example profile_fs_open`, `cargo test -p lix_fs_backend --features rocksdb`, `cargo test -p lix_sdk --features sqlite,rocksdb filesystem::tests:: -- --nocapture`, and `cargo check -p lix_sdk --features sqlite --example profile_fs_open`.
- 2026-06-21: Added an experiment that skips staging CAS chunk payload rows when the chunk key already exists in the backing store. The transaction file-data path now checks chunk existence with key-only point reads before writing chunk rows, while still writing new blob manifests and manifest-chunk references.
- 2026-06-21: Reran the same rewrite/delete stress test at FastCDC 256/1024/4096 KiB. This confirmed the BlobDB size problem was largely duplicate blob payload writes for existing CAS chunk keys, not just unavoidable BlobDB garbage.

| Variant | Backend | Stage | Open | Compact | `.lix` total | SST | Blob | CAS chunks | CAS chunk refs |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| before skip | rocksdb | delete | 3964 ms | - | 2,028,246,451 B | 2,027,448,429 B | 0 B | 1,774 | 3,305 |
| before skip | rocksdb | compact after delete | 3377 ms | 891 ms | 1,661,927,185 B | 1,661,088,048 B | 0 B | 1,774 | 3,305 |
| before skip | rocksdb-blob 16 KiB | delete | 3563 ms | - | 2,942,916,776 B | 2,491,141 B | 2,940,021,502 B | 1,774 | 3,305 |
| before skip | rocksdb-blob 16 KiB | compact after delete | 2411 ms | 38 ms | 2,575,900,213 B | 2,551,077 B | 2,572,989,064 B | 1,774 | 3,305 |
| after skip | rocksdb | delete | 5165 ms | - | 1,661,601,317 B | 1,661,140,114 B | 0 B | 1,774 | 3,305 |
| after skip | rocksdb | compact after delete | 2860 ms | 463 ms | 1,661,694,544 B | 1,661,205,151 B | 0 B | 1,774 | 3,305 |
| after skip | rocksdb-blob 16 KiB | delete | 3298 ms | - | 1,661,414,227 B | 2,541,304 B | 1,658,539,236 B | 1,774 | 3,305 |
| after skip | rocksdb-blob 16 KiB | compact after delete | 2353 ms | 118 ms | 1,661,428,901 B | 2,599,687 B | 1,658,539,174 B | 1,774 | 3,305 |

- 2026-06-21: After skipping existing chunk payload writes, BlobDB keeps the desired LSM shape without the earlier disk-size penalty: post-delete total dropped from 2.94 GB to 1.66 GB, and post-compact total dropped from 2.58 GB to 1.66 GB. BlobDB SST still stayed tiny at about 2.5-2.6 MB. The remaining CAS chunk-ref growth is expected because Lix history keeps new file versions referencing mostly existing chunks.
- 2026-06-21: Caveat: this first skip-existing implementation does one key-only point read per candidate CAS chunk. That is good enough to prove the storage-shape hypothesis, but the next implementation pass should batch chunk-existence checks or otherwise avoid adding avoidable read overhead on first import.
- 2026-06-21: Verification passed after skip-existing CAS chunk writes: `cargo check -p lix_sdk --features sqlite,rocksdb --example profile_fs_open`, `cargo test -p lix_engine existing_chunk_aware_writer_skips_persisted_chunk_payloads --lib`, `cargo test -p lix_engine binary_cas --lib`, `cargo test -p lix_sdk --features sqlite,rocksdb filesystem::tests:: -- --nocapture`, `cargo build --release -p lix_sdk --features sqlite,rocksdb --example profile_fs_open`, and `cargo check -p lix_sdk --features sqlite --example profile_fs_open`.
- 2026-06-21: Added profiler instrumentation for CAS chunk-existence lookup cost. The profiler now reports cold/open and warm lookup counts, hit/miss counts, transaction-local duplicate skips, and total time spent in the key-only point lookups used by skip-existing CAS chunk writes.
- 2026-06-21: Compared the current RocksDB Rust wrapper (`rocksdb 0.22.0`, `librocksdb-sys 0.16.0+8.10.0`) with the latest crates.io wrapper (`rocksdb 0.24.0`, `librocksdb-sys 0.17.3+10.4.2`). Note that this is not latest upstream RocksDB 11.5.0; the Rust wrapper currently packages RocksDB 10.4.2. The upgraded sys crate also required `DYLD_LIBRARY_PATH=/opt/homebrew/opt/llvm/lib LIBCLANG_PATH=/opt/homebrew/opt/llvm/lib` locally because its bindgen runtime needs `libclang.dylib` at build time.

| Version | Backend | Cold median | Warm median | Lookup count | Lookup hits | Lookup misses | Lookup time | Lookup share of cold | `.lix` total | SST | Blob |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| rocksdb 0.22 / librocksdb 8.10 | rocksdb | 7066 ms | 4128 ms | 1,757 | 12 | 1,745 | 477 ms | 6.7% | 1.728 GB | 1.728 GB | 0 B |
| rocksdb 0.24 / librocksdb 10.4 | rocksdb | 6996 ms | 4511 ms | 1,757 | 12 | 1,745 | 489 ms | 7.0% | 1.602 GB | 1.602 GB | 0 B |
| rocksdb 0.22 / librocksdb 8.10 | rocksdb-blob 16 KiB | 6781 ms | 4018 ms | 1,757 | 12 | 1,745 | 20 ms | 0.3% | 1.602 GB | 2.3 MB | 1.600 GB |
| rocksdb 0.24 / librocksdb 10.4 | rocksdb-blob 16 KiB | 5979 ms | 4011 ms | 1,757 | 12 | 1,745 | 11 ms | 0.2% | 1.602 GB | 2.3 MB | 1.600 GB |

- 2026-06-21: Interpretation: the CAS chunk lookup cost is negligible for BlobDB in this Downloads sample, but material for plain RocksDB: about 0.5 seconds, or ~7% of cold import/open. Upgrading the Rust RocksDB wrapper did not remove the plain RocksDB lookup cost, but it slightly improved BlobDB cold median in this run and substantially reduced plain RocksDB SST/total bytes. BlobDB remains the better fit for the filesystem-specialized backend because it keeps the LSM/SST set tiny while making lookup overhead nearly invisible.
- 2026-06-21: Verification passed after instrumentation and RocksDB upgrade: `cargo check -p lix_sdk --features sqlite,rocksdb --example profile_fs_open` with the local libclang env, `cargo build --release -p lix_sdk --features sqlite,rocksdb --example profile_fs_open` with the local libclang env, `cargo test -p lix_engine binary_cas --lib`, `cargo test -p lix_sdk --features sqlite,rocksdb filesystem::tests:: -- --nocapture` with the local libclang env, and `cargo test -p lix_fs_backend --features rocksdb` with the local libclang env.
