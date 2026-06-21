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
