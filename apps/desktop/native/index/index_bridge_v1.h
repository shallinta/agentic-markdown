#ifndef INDEX_BRIDGE_V1_H
#define INDEX_BRIDGE_V1_H
#include <stddef.h>
#include <stdint.h>
/* Borrowed inputs/output only during a call. Session is Rust-owned. */
typedef struct IndexSession IndexSession;
enum IndexStatus { IDX_OK=0, IDX_INPUT=1, IDX_LIMIT=2, IDX_IO=3,
  IDX_SCHEMA=4, IDX_CLOSED=5, IDX_POISON=6, IDX_READONLY=7, IDX_PANIC=8 };
enum IndexOp { IDX_APPLY_COMMIT=1, IDX_QUERY=3
#ifdef INDEX_BRIDGE_TEST
  , IDX_LIVE=4, IDX_PRE_PANIC=90, IDX_POST_COMMIT_PANIC=91
#endif
};
/* meta: generation, output length/required, accepted mutation calls, faulted. */
uint32_t index_abi_version(void);
uint32_t index_open(const uint8_t*,size_t,uint32_t,IndexSession**,uint64_t*);
uint32_t index_call(IndexSession*,uint32_t,const uint8_t*,size_t,uint8_t*,size_t,uint64_t[4]);
uint32_t index_close(IndexSession*);
#endif
