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

The PR already uses `profile_fs_open` as the folder-open validation harness, and its PR body reports sub-second `/Users/samuel/Downloads` opens after the descriptor/hash work, so that is the right E2E baseline to preserve. Source: PR #548 summary and validation notes on GitHub. 

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
FastCDC 64/256/1024 KiB
FastCDC 128/512/2048 KiB
maybe single-chunk threshold variants
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
